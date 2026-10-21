import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url));
const expected='7cbfff54432e7becdd6c9187ffa0f78ccfd17df009da3a4853d71246ecbda6bf';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const must=(ok,msg)=>{if(!ok)throw Error(msg);};
function instant(s){must(typeof s==='string' && /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s)),'日時はタイムゾーン付きで入力してください');return Date.parse(s);}
export function calculate(input,html){
  must(hash(html)===expected,'元HTMLの指紋が違います');
  const scripts=[...html.toString('utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)];
  must(scripts.length===1 && /nav\(\);render\(\);\s*$/.test(scripts[0][1]),'HTML構造が違います');
  const ctx=vm.createContext({source:JSON.stringify(input)});
  vm.runInContext(`const sort=Array.prototype.sort;Array.prototype.sort=function(c){const a=sort.call(this,c);if(this.length===120&&this.every(x=>typeof x.k==='string'&&typeof x.p==='number'))globalThis.all=this.map(x=>({k:x.k,p:x.p,o:x.o}));return a;};`+scripts[0][1].replace(/nav\(\);render\(\);\s*$/,''),ctx,{timeout:2000});
  const v=JSON.parse(vm.runInContext(`const errors=[],warnings=[];const races=build(JSON.parse(source),errors,warnings);JSON.stringify({errors,warnings,result:errors.length?null:fcalc(races[0]),all:globalThis.all||null})`,ctx,{timeout:2000}));
  must(!v.errors.length,'入力エラー: '+JSON.stringify(v.errors));
  must(v.result?.ok,'必須データ不足: '+JSON.stringify(v.result?.miss));
  must(v.all?.length===120 && new Set(v.all.map(x=>x.k)).size===120 && v.all.every(x=>Number.isFinite(x.p)&&x.p>=0&&x.p<=1) && Math.abs(v.all.reduce((s,x)=>s+x.p,0)-1)<1e-9,'確率不正');
  must(JSON.stringify(v.all.slice(0,10))===JSON.stringify(v.result.top),'上位10点不一致');
  return v;
}
export function prepare(request,html,now=Date.now()){
  const r=request;
  must(r.result_not_seen===true,'結果をまだ参照していないことの確認が必要です');
  must(/^\d{4}-\d{2}-\d{2}$/.test(r.date) && new Date(r.date).toISOString().slice(0,10)===r.date,'日付不正');
  must(Number.isInteger(r.race_no)&&r.race_no>=1&&r.race_no<=12,'レース番号不正');
  const deadline=instant(r.deadline_at), fetched=instant(r.input_fetched_at);
  must(new Date(deadline+9*3600000).toISOString().slice(0,10)===r.date,'締切日時と開催日が不一致');
  must(fetched<=now && now<deadline,'取得時刻が未来、または締切を過ぎています');
  must(typeof r.input_source_url==='string' && /^https:\/\//.test(r.input_source_url),'出走表の出典URLが必要です');
  must(Array.isArray(r.entries)&&r.entries.length===6,'6艇分の入力が必要です');
  const keys=['lane','name','class','national_win_rate','local_win_rate','motor_2rate','boat_2rate','avg_st'];
  const entries=r.entries.map(e=>Object.fromEntries(keys.map(k=>[k,e[k]??null])));
  must(new Set(entries.map(e=>e.lane)).size===6 && entries.every(e=>Number.isInteger(e.lane)&&e.lane>=1&&e.lane<=6),'艇番不正');
  for(const e of entries)for(const [k,max] of [['national_win_rate',10],['local_win_rate',10],['motor_2rate',100],['avg_st',1]])must(typeof e[k]==='number'&&Number.isFinite(e[k])&&e[k]>=0&&e[k]<=max,`${e.lane}号艇の${k}が未入力または範囲外です`);
  const input={venue:'桐生',date:r.date,races:[{race_no:r.race_no,time:new Date(deadline+9*3600000).toISOString().slice(11,16),entries,result:null,odds:[]}]};
  const calculated=calculate(input,html);
  let odds=null;
  if(r.odds!==null && r.odds!==undefined){
    const o=r.odds,t=instant(o.fetched_at);
    must(t<=now&&t<deadline,'オッズ取得時刻不正');
    must(/^https:\/\//.test(o.source_url||''),'オッズ出典URLが必要です');
    must(Array.isArray(o.items)&&o.items.length>0,'オッズが空です。取得しない場合はnullにしてください');
    must(new Set(o.items.map(x=>x.combo)).size===o.items.length,'オッズ重複');
    for(const x of o.items)must(/^[1-6]-[1-6]-[1-6]$/.test(x.combo)&&new Set(x.combo.split('-')).size===3&&typeof x.odds==='number'&&Number.isFinite(x.odds)&&x.odds>=1,'オッズの買い目・倍率不正');
    odds={source_url:o.source_url,fetched_at:o.fetched_at,items:o.items.map(x=>({combo:x.combo,odds:x.odds}))};
  }
  const items=calculated.all.map((x,i)=>({rank:i+1,combo:x.k,probability:x.p}));
  return {schema_version:1,race_id:`kiryu_${r.date.replaceAll('-','')}_R${r.race_no}`,deadline_at:r.deadline_at,input_source_url:r.input_source_url,input_fetched_at:r.input_fetched_at,input,items,odds,warnings:calculated.warnings,code_sha256:expected,result_not_seen_self_report:true,classification:'PRERACE_LOCAL_RECORD_UNVERIFIED',evidence_limit:'ローカル時計と手入力の取得時刻・申告。第三者の時刻証明ではなく、事前性は別途確認が必要。',ev_status:odds?'SNAPSHOT_ESTIMATE_ONLY':'UNVERIFIED_NO_ODDS',ev_estimates:odds?odds.items.map(o=>({combo:o.combo,probability_times_odds:items.find(x=>x.combo===o.combo).probability*o.odds})):[]};
}
export function save(request,root,html){
  const record=prepare(request,html);
  const directory=path.join(root,record.race_id);
  fs.mkdirSync(root,{recursive:true});
  // 同一レースの上書き・予想の選び直しを防ぐ。途中失敗時も残して確認する。
  fs.mkdirSync(directory);
  const savedAt=new Date().toISOString();
  must(Date.parse(savedAt)<instant(record.deadline_at),'処理中に締切を過ぎました。保存を中止します');
  record.saved_at=savedAt;
  const payload=JSON.stringify(record,null,2)+'\n';
  fs.writeFileSync(path.join(directory,'prediction.json'),payload,{flag:'wx'});
  fs.writeFileSync(path.join(directory,'original_artifact.html'),html,{flag:'wx'});
  const completedAt=new Date().toISOString();
  must(Date.parse(completedAt)<instant(record.deadline_at),'保存完了時に締切を過ぎました。未完了として扱います');
  fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify({completed_at:completedAt,files:{'prediction.json':hash(payload),'original_artifact.html':hash(html)}},null,2)+'\n',{flag:'wx'});
  return directory;
}
export function verify(directory){
  const receipt=read(path.join(directory,'receipt.json'));
  for(const name of ['prediction.json','original_artifact.html'])must(hash(fs.readFileSync(path.join(directory,name)))===receipt.files[name],name+'が保存時から変更されています');
  const record=read(path.join(directory,'prediction.json'));
  must(instant(record.saved_at)<=instant(receipt.completed_at)&&instant(receipt.completed_at)<instant(record.deadline_at),'保存時刻不正');
  const all=calculate(record.input,fs.readFileSync(path.join(directory,'original_artifact.html'))).all;
  must(JSON.stringify(all.map((x,i)=>({rank:i+1,combo:x.k,probability:x.p})))===JSON.stringify(record.items),'確率の再現不一致');
  return record.race_id;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [command,arg]=process.argv.slice(2);
    if(command==='save')console.log('保存しました: '+save(read(path.resolve(arg)),path.join(base,'saved'),fs.readFileSync(path.join(base,'model/original_artifact.html'))));
    else if(command==='verify')console.log('保存後の変更なし・確率再現一致: '+verify(path.resolve(arg)));
    else throw Error('使用方法: node save_prediction.mjs save 入力.json / verify 保存フォルダ');
  }catch(e){console.error('保存・確認を完了できませんでした: '+e.message);process.exitCode=1;}
}
