// Prospective experiments: definitions and selections are immutable, outcomes are separate.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateRecord} from './prospective.mjs';
import {rankExpectedValue} from '../../site/public/odds-live.mjs';
import {verificationRow} from '../../site/public/verification-data.mjs';
import {verifiedResults,archiveResult} from '../../site/public-verification.mjs';
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const jst=now=>new Date(now+9*3600000).toISOString().slice(0,10);
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const walk=dir=>!fs.existsSync(dir)?[]:fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.name.endsWith('.json')?[path.join(dir,e.name)]:[]);
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const seal=body=>({...body,integrity_sha256:digest(body)});
function activation(root,d,now){const file=path.join(root,'activation.json');if(!fs.existsSync(file))immutable(file,{activated_at:new Date(now).toISOString(),definition_sha256:digest(d)});const a=read(file);assert(a.definition_sha256===digest(d)&&Date.parse(a.activated_at)>=Date.parse(d.registered_at),'検証開始記録が不正');return a.activated_at;}
function immutable(file,body){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 if(fs.existsSync(file)){assert(JSON.stringify(read(file))===JSON.stringify(body),'検証記録の上書きを拒否: '+file);return false;}
 fs.writeFileSync(file,JSON.stringify(body)+'\n',{flag:'wx'});return true;
}
export function validateDefinition(d){
 assert(/^[a-z0-9-]+$/.test(d?.id||'')&&d.strategy==='EV_TOP10_FREQUENT_FOUR_BOX_V1'&&d.stake_per_combo_yen===100,'未対応の検証定義');
 assert(/^\d{4}-\d{2}-\d{2}$/.test(d.from)&&/^\d{4}-\d{2}-\d{2}$/.test(d.through)&&d.from<=d.through&&Number.isFinite(Date.parse(d.registered_at)),'検証期間が不正');
 assert(JSON.stringify(d.tie_break)===JSON.stringify(['summed_expected_value','lane_ascending'])&&JSON.stringify(d.venue_codes)===JSON.stringify(Array.from({length:24},(_,i)=>String(i+1).padStart(2,'0'))),'選定ルール・対象場が不正');
 return d;
}
export function experimentSelection(source,definition,{now=Date.now(),activatedAt=definition.registered_at}={}){
 const d=validateDefinition(definition),record=validateRecord(source,now),p=record.proposal;
 assert(record.kind==='WORKER_FROZEN','締切3分前の固定予想だけを使用します');
 assert(p.date>=d.from&&p.date<=d.through&&d.venue_codes.includes(p.venue_code),'検証期間・対象場の範囲外');
 assert(Date.parse(p.proposal_saved_at)>=Date.parse(activatedAt)&&Date.parse(p.cutoff_at)>=Date.parse(activatedAt),'ルール登録前の予想は使いません');
 assert(p.odds.items.length===120,'全120通りのオッズが必要です');
 assert(p.entries?.length===6&&new Set(p.entries.map(e=>e.lane)).size===6&&new Set(p.entries.map(e=>e.racer_id)).size===6&&p.entries.every(e=>Number.isInteger(e.lane)&&e.lane>=1&&e.lane<=6&&/^\d{4}$/.test(e.racer_id)&&e.participation_status!=='WITHDRAWN'),'通常の6艇予想だけを使用します');
 const ranked=rankExpectedValue(p.probabilities,p.odds.items),top=ranked.slice(0,10);
 const frequency=Array.from({length:6},(_,i)=>({lane:i+1,count:0,expected_value_sum:0}));
 for(const x of top)for(const n of x.combo.split('-').map(Number)){frequency[n-1].count++;frequency[n-1].expected_value_sum+=x.value;}
 frequency.sort((a,b)=>b.count-a.count||b.expected_value_sum-a.expected_value_sum||a.lane-b.lane);
 const selected=frequency.slice(0,4).map(e=>e.lane).sort((a,b)=>a-b),box=ranked.filter(e=>e.combo.split('-').every(n=>selected.includes(Number(n)))).sort((a,b)=>a.combo.localeCompare(b.combo));
 assert(box.length===24,'4艇BOXは24通りである必要があります');
 const first=Array.from({length:6},(_,i)=>({lane:i+1,probability:p.probabilities.filter(x=>Number(x.combo[0])===i+1).reduce((s,x)=>s+x.probability,0)}));
 const projected=rows=>({points:rows.length,stake_yen:rows.length*100,hit_probability:rows.reduce((s,x)=>s+x.probability,0),expected_return_yen:rows.reduce((s,x)=>s+x.value*100,0),expected_recovery_percent:rows.reduce((s,x)=>s+x.value,0)/rows.length*100});
 const rows=a=>a.map(({combo,probability,odds,value})=>({combo,probability,odds,value}));
 return seal({schema_version:1,experiment_id:d.id,activated_at:activatedAt,definition_sha256:digest(d),key:`${p.date}/${p.venue_code}/${p.race_no}`,date:p.date,venue_code:p.venue_code,race_no:p.race_no,deadline_at:p.deadline_at,cutoff_at:p.cutoff_at,proposal_saved_at:p.proposal_saved_at,frozen_at:p.frozen_at,received_at:record.received_at,source_snapshot_id:record.id,source_integrity_sha256:record.integrity_sha256,model_id:p.model_id,model_coefficient_id:p.model_coefficient_id||null,grade:p.context?.grade||'未確認',selected_lanes:selected,frequency,first_probabilities:first,in_probability:first[0].probability,other_probability:1-first[0].probability,value_top10:rows(top),box:rows(box),projected_box:projected(box),projected_top10:projected(top)});
}
export function captureExperiments(directory,definitions,{now=Date.now()}={}){
 const report={saved:0,existing:0,skipped:0};
 for(const definition of definitions){
  const d=validateDefinition(definition),root=path.join(directory,'experiments',d.id);
  immutable(path.join(root,'definition.json'),d);
  if(fs.existsSync(path.join(root,'article.json')))continue;
  const activatedAt=activation(root,d,now),snapshots=path.join(directory,'snapshots');
  const files=fs.existsSync(snapshots)?fs.readdirSync(snapshots).filter(day=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&day>=d.from&&day<=d.through).flatMap(day=>walk(path.join(snapshots,day))):[];
  for(const file of files){
   const source=read(file),p=source?.proposal;
   if(!p||p.date<d.from||p.date>d.through||source.kind!=='WORKER_FROZEN')continue;
   validateRecord(source,now);
   const target=path.join(root,'predictions',p.date,p.venue_code,`R${p.race_no}.json`);
   if(fs.existsSync(target)){report.existing++;continue;}
   try{const selection=experimentSelection(source,d,{now,activatedAt});immutable(target,selection);report.saved++;}
   catch(error){report.skipped++;if(!/登録前|全120|通常の6艇/.test(error.message))throw error;}
  }
 }
 return report;
}
export function captureInventory(snapshots,directory,definitions,{now=Date.now()}={}){
 for(const definition of definitions){const d=validateDefinition(definition);if(jst(now)<d.from||jst(now)>d.through)continue;
  const root=path.join(directory,'experiments',d.id);immutable(path.join(root,'definition.json'),d);
  const activatedAt=activation(root,d,now);
  for(const s of snapshots){if(s.date!==jst(now)||!d.venue_codes.includes(s.venue_code))continue;
   if(['OPEN','NO_MEETING'].includes(s.meeting_status)){
    const file=path.join(root,'venues',s.date,s.venue_code+'.json');if(!fs.existsSync(file))immutable(file,{date:s.date,venue_code:s.venue_code,status:s.meeting_status,observed_at:new Date(now).toISOString()});
   }
   for(const r of s.races||[]){if(!Number.isInteger(r.race_no)||r.race_no<1||r.race_no>12||!Number.isFinite(Date.parse(r.deadline_at))||Date.parse(r.deadline_at)-180000<Date.parse(activatedAt))continue;
    const file=path.join(root,'inventory',s.date,s.venue_code,`R${r.race_no}.json`);
    if(!fs.existsSync(file))immutable(file,{date:s.date,venue_code:s.venue_code,race_no:r.race_no,deadline_at:r.deadline_at,grade:r.context?.grade||s.meeting?.grade||'未確認',observed_at:new Date(now).toISOString()});
   }
  }
 }
}
export function summarizeExperiment(rows){
 const settled=rows.filter(r=>r.status==='SETTLED'),stake=settled.length*2400,returned=settled.reduce((s,r)=>s+r.box_result.return_yen,0),expected=settled.reduce((s,r)=>s+r.projected_box.expected_return_yen,0),topStake=settled.length*1000,topReturn=settled.reduce((s,r)=>s+r.top10_result.return_yen,0);
 return {records:rows.length,settled:settled.length,pending:rows.filter(r=>r.status==='MISSING_RESULT').length,excluded:rows.filter(r=>r.status==='EXCLUDED').length,missing_prediction:rows.filter(r=>r.status==='MISSING_PROPOSAL').length,hits:settled.filter(r=>r.box_result.hit).length,stake_yen:stake,return_yen:returned,profit_yen:returned-stake,recovery_percent:stake?returned/stake*100:null,expected_recovery_percent:stake?expected/stake*100:null,recovery_gap_points:stake?(returned-expected)/stake*100:null,top10_recovery_percent:topStake?topReturn/topStake*100:null,box_vs_top10_gap_points:stake?returned/stake*100-topReturn/topStake*100:null,expected_hit_percent:settled.length?settled.reduce((s,r)=>s+r.projected_box.hit_probability,0)/settled.length*100:null,actual_hit_percent:settled.length?settled.filter(r=>r.box_result.hit).length/settled.length*100:null};
}
function groups(rows,field){const out=new Map();for(const r of rows){const k=String(field(r));if(!out.has(k))out.set(k,[]);out.get(k).push(r);}return [...out].sort(([a],[b])=>a.localeCompare(b,'ja')).map(([label,list])=>({label,...summarizeExperiment(list)}));}
const band=p=>!Number.isFinite(p)?'未確認':p<.3?'30%未満':p<.5?'30〜50%未満':p<.7?'50〜70%未満':'70%以上';
export function experimentReport(directory,definition,{now=Date.now()}={}){
 const d=validateDefinition(definition),root=path.join(directory,'experiments',d.id),definitionFile=path.join(root,'definition.json');
 if(fs.existsSync(definitionFile))assert(digest(read(definitionFile))===digest(d),'登録済みの検証ルールを変更できません');
 const article=path.join(root,'article.json');if(fs.existsSync(article)){const a=read(article),{integrity_sha256,...body}=a;assert(integrity_sha256===digest(body)&&a.definition_sha256===digest(d),'記事原本の変更を検出');return a;}
 const activationFile=path.join(root,'activation.json'),activatedAt=fs.existsSync(activationFile)?read(activationFile).activated_at:null;
 const results=verifiedResults(directory,{from:d.from,through:d.through}),rows=[];
 for(const file of walk(path.join(root,'predictions'))){
  const row=read(file),{integrity_sha256,...body}=row;assert(integrity_sha256===digest(body)&&row.definition_sha256===digest(d),'検証選定記録の変更を検出');
  const sourceFile=path.join(directory,'snapshots',row.date,row.venue_code,`R${row.race_no}`,row.source_snapshot_id+'.json');
  const source=read(sourceFile);assert(JSON.stringify(experimentSelection(source,d,{now,activatedAt}))===JSON.stringify(row),'検証選定と原本が一致しません');
  const result=results.get(row.key),evaluated=verificationRow(source.proposal,result?archiveResult(result,source.proposal):null,now);
  const strategy=items=>{const hit=items.some(x=>x.combo===evaluated.actual_combo);return {hit,stake_yen:items.length*100,return_yen:hit?evaluated.payout_yen_per_100:0};};
  rows.push({...row,status:evaluated.status,reason:evaluated.reason,actual_combo:evaluated.actual_combo||null,result_source_url:evaluated.result_source_url||null,payout_yen_per_100:evaluated.payout_yen_per_100||null,box_result:evaluated.status==='SETTLED'?strategy(row.box):null,top10_result:evaluated.status==='SETTLED'?strategy(row.value_top10):null});
 }
 const seen=new Set(rows.map(r=>r.key));for(const file of walk(path.join(root,'inventory'))){const p=read(file),key=`${p.date}/${p.venue_code}/${p.race_no}`;if(!seen.has(key)&&Date.parse(p.deadline_at)<=now)rows.push({...p,key,status:'MISSING_PROPOSAL',reason:'有効な締切前の4艇BOX記録がありません'});}
 rows.sort((a,b)=>b.date.localeCompare(a.date)||a.venue_code.localeCompare(b.venue_code)||a.race_no-b.race_no);
 const summary=summarizeExperiment(rows),ended=jst(now)>d.through,status=!activatedAt?'PENDING_ACTIVATION':jst(now)<d.from?'SCHEDULED':!ended?'RECORDING':summary.pending?'AWAITING_RESULTS':'COMPLETED';
 const report={schema_version:1,kind:'PROSPECTIVE_STRATEGY_EXPERIMENT',definition:d,activated_at:activatedAt,definition_sha256:digest(d),generated_at:new Date(now).toISOString(),status,summary,by_date:groups(rows,r=>r.date),by_venue:groups(rows,r=>r.venue_code),by_grade:groups(rows,r=>r.grade||'未確認'),by_in_probability:groups(rows,r=>band(r.in_probability)),by_favorite_probability:groups(rows,r=>band(r.first_probabilities?.length?Math.max(...r.first_probabilities.map(x=>x.probability)):null)),by_model:groups(rows,r=>r.model_coefficient_id||r.model_id||'未確認'),coverage:{known_venues:walk(path.join(root,'venues')).map(read),inventory_races:walk(path.join(root,'inventory')).length,notes:'全24場を対象。取得できなかった開催・レースは全数を保証できず、既知の出走予定に対する記録欠損を別表示します。'},records:rows};
 return report;
}
export function finalizeExperiments(directory,definitions,{now=Date.now()}={}){
 for(const d of definitions){if(fs.existsSync(path.join(directory,'experiments',d.id,'article.json')))continue;const report=experimentReport(directory,d,{now});if(report.status==='COMPLETED'&&report.summary.settled>0)immutable(path.join(directory,'experiments',d.id,'article.json'),seal({...report,article_archived_at:new Date(now).toISOString()}));}
}
export function publicExperiments(directory,definitions,{now=Date.now()}={}){return {schema_version:1,kind:'STRATEGY_EXPERIMENT_ARCHIVE',generated_at:new Date(now).toISOString(),experiments:definitions.map(d=>experimentReport(directory,d,{now}))};}
export function writePublicExperiments(directory,definitions,outputDirectory,{now=Date.now()}={}){
 const data=publicExperiments(directory,definitions,{now});
 for(const report of data.experiments){
  report.record_days=[];const days=[...new Set(report.records.map(r=>r.date))].sort().reverse();
  for(const date of days){const url=`./data/experiments/${report.definition.id}/${date}.json`,file=path.join(outputDirectory,url);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({kind:'EXPERIMENT_DAY_RECORDS',experiment_id:report.definition.id,date,records:report.records.filter(r=>r.date===date)}));report.record_days.push({date,url});}
  report.records=[];
 }
 fs.mkdirSync(path.join(outputDirectory,'data'),{recursive:true});fs.writeFileSync(path.join(outputDirectory,'data/experiments.json'),JSON.stringify(data));return data;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [command,directory,config,snapshotDirectory]=process.argv.slice(2),definitions=read(config).experiments;
  if(command==='capture'){if(snapshotDirectory)captureInventory(walk(snapshotDirectory).map(read),directory,definitions);console.log(JSON.stringify(captureExperiments(directory,definitions)));}
  else if(command==='finalize'){finalizeExperiments(directory,definitions);console.log('Experiment articles checked');}
  else throw Error('capture / finalize が必要です');
 }catch(error){console.error(error);process.exitCode=1;}
}
