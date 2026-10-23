// Operational evaluation only: these files never enter site/dist or model fitting.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {validProposal,proposalCandidate,PROPOSAL_LEAD_MS,rankExpectedValue} from '../../site/public/odds-live.mjs';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key=r=>`${r.date}/${r.venue_code}/${r.race_no}`;
const today=now=>new Date(now+9*3600000).toISOString().slice(0,10);
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
function compactProposal(p){
 const fields=['schema_version','date','venue_code','race_no','deadline_at','cutoff_at','proposal_saved_at','prediction_saved_at','input_fetched_at','prediction_key','model_id','model_coefficient_id','model_name','frozen_at','context','history_window','entries_fetched_at','exhibition_fetched_at'];
 const entryFields=['lane','racer_id','name','class','participation_status','avg_st','exhibition_time','exhibition_st','exhibition_st_status','exhibition_course','annual_lane'];
 return {entries:(p.entries||[]).map(e=>Object.fromEntries(entryFields.filter(k=>e[k]!==undefined).map(k=>[k,e[k]]))),history:{lanes:(p.history?.lanes||[]).map(h=>({lane:h.lane,exhibition_st_gap:h.exhibition_st_gap||null,data_details:h.data_details||null}))},...Object.fromEntries(fields.filter(k=>p[k]!==undefined).map(k=>[k,p[k]])),probabilities:p.probabilities.map(({combo,probability,rank})=>({combo,probability,rank})),odds:p.odds};
}
export function captureProspective(snapshots,directory,{now=Date.now()}={}){
 const report={saved:0,existing:0,skipped:0,receipt_at:new Date(now).toISOString()};
 for(const snapshot of snapshots)for(const race of snapshot.races||[]){
  if(race.date!==today(now)||race.entries?.some(e=>e.participation_status==='WITHDRAWN')){report.skipped++;continue;}
  const frozen=race.proposal_snapshot;
  let proposal=null,kind=null;
  if(validProposal(frozen,race.date,now)){
   proposal=frozen;kind='WORKER_FROZEN';
  }else if(Date.parse(race.deadline_at)-now<=10*60000&&now<=Date.parse(race.deadline_at)-PROPOSAL_LEAD_MS){
   const target={...race,update_status:snapshot.update?.status,last_success_at:snapshot.update?.last_success_at,
    prediction_key:race.prediction_key||`${race.model_id}:${race.prediction_saved_at}`};
   const quote={...race.odds,...target,items:race.odds?.items,status:race.odds_update?.status==='OK'?'OK':'FAILED',fetched_at:race.odds?.fetched_at,source_url:race.odds?.source_url};
   proposal=proposalCandidate(target,quote,now);if(proposal)kind='COLLECTOR_PRERACE';
  }
  if(!proposal){report.skipped++;continue;}
  const payload={kind,proposal:compactProposal(proposal)},id=hash(payload);
  const destination=path.join(directory,'snapshots',race.date,race.venue_code,`R${race.race_no}`,id+'.json');
  const record={schema_version:1,id,received_at:report.receipt_at,...payload};
  record.integrity_sha256=hash(record);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  try{fs.writeFileSync(destination,JSON.stringify(record)+'\n',{flag:'wx'});report.saved++;}
  catch(e){if(e.code!=='EEXIST')throw e;validateRecord(JSON.parse(fs.readFileSync(destination)),now);report.existing++;}
 }
 return report;
}
export function validateRecord(record,now=Date.now()){
 requireValue(record?.schema_version===1&&['COLLECTOR_PRERACE','WORKER_FROZEN'].includes(record.kind),'保存予想の種類が不正です');
 const {integrity_sha256,...content}=record;requireValue(integrity_sha256===hash(content),'保存予想・受信時刻の変更を検出しました');
 requireValue(record.id===hash({kind:record.kind,proposal:record.proposal}),'保存予想の変更を検出しました');
 requireValue(Number.isFinite(Date.parse(record.received_at))&&Date.parse(record.received_at)<=now+60000,'受信時刻が不正です');
 requireValue(validProposal(record.proposal,record.proposal.date,now,record.kind==='WORKER_FROZEN'),'保存予想の対象・時刻が不正です');
 requireValue(Date.parse(record.proposal.proposal_saved_at)<=Date.parse(record.received_at)&&(!record.proposal.frozen_at||Date.parse(record.proposal.frozen_at)<=Date.parse(record.received_at)),'予想保存・固定前の受信時刻は使えません');
 requireValue(record.kind!=='COLLECTOR_PRERACE'||Date.parse(record.received_at)<=Date.parse(record.proposal.cutoff_at),'締切3分前以後の予想は事前受信として扱えません');
 return record;
}
function filesUnder(folder){
 if(!fs.existsSync(folder))return [];
 return fs.readdirSync(folder,{withFileTypes:true}).flatMap(e=>e.isDirectory()?filesUnder(path.join(folder,e.name)):e.isFile()&&e.name.endsWith('.json')?[path.join(folder,e.name)]:[]);
}
const errorSummary=values=>({n:values.length,bias:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,rmse:values.length?Math.sqrt(values.reduce((a,b)=>a+b*b,0)/values.length):null});
function summarize(rows){
 const bins=[0,.005,.01,.02,.05,.1,.2,.5,1];
 const calibration=bins.slice(0,-1).map((from,i)=>({from,to:bins[i+1],observations:0,probability_sum:0,hits:0}));
 let brier=0,loss=0;for(const row of rows){for(const p of row.probabilities){const truth=Number(p.combo===row.actual_combo),index=Math.min(bins.length-2,bins.findIndex((x,i)=>i<bins.length-1&&p.probability>=x&&p.probability<bins[i+1]));const bin=calibration[index<0?calibration.length-1:index];bin.observations++;bin.probability_sum+=p.probability;bin.hits+=truth;brier+=(p.probability-truth)**2;}loss-=Math.log(row.probabilities.find(p=>p.combo===row.actual_combo).probability);}
 const strategy=field=>{const included=rows.filter(r=>r[field].length===10),monetary=included.filter(r=>r.official_payout_yen!==null);const staked=monetary.length*1000,returned=monetary.reduce((s,r)=>s+(r[field].includes(r.actual_combo)?r.official_payout_yen:0),0);return {races:included.length,hits:included.filter(r=>r[field].includes(r.actual_combo)).length,hit_rate:included.length?included.filter(r=>r[field].includes(r.actual_combo)).length/included.length:null,roi_races:monetary.length,stake_yen:staked,return_yen:returned,return_rate:staked?returned/staked:null,profit_yen:staked?returned-staked:null};};
 return {races:rows.length,log_loss:rows.length?loss/rows.length:null,brier:rows.length?brier/rows.length:null,probability_top10:strategy('probability_top10'),value_top10:strategy('value_top10'),calibration:calibration.map(b=>({...b,mean_probability:b.observations?b.probability_sum/b.observations:null,actual_frequency:b.observations?b.hits/b.observations:null})),exhibition_st_raw_gap:errorSummary(rows.flatMap(r=>r.st_errors.map(e=>e.raw_gap))),exhibition_st_paired_raw_gap:errorSummary(rows.flatMap(r=>r.st_errors.filter(e=>Number.isFinite(e.corrected_error)).map(e=>e.raw_gap))),exhibition_st_corrected_error:errorSummary(rows.flatMap(r=>r.st_errors.map(e=>e.corrected_error).filter(Number.isFinite)))};
}
export function evaluateProspective(records,results,{now=Date.now()}={}){
 const byKey=new Map();for(const result of results){requireValue(!byKey.has(key(result)),'確定結果が重複しています');byKey.set(key(result),result);}
 const groups=new Map(),invalid=[];
 for(const record of records){try{validateRecord(record,now);const p=record.proposal;if(p.date>=today(now))continue;
  const cohort=record.kind==='COLLECTOR_PRERACE'?'RECEIPT_BEFORE_CUTOFF':'WORKER_REPORTED_ONLY',group=`${key(p)}/${cohort}`;
  const old=groups.get(group);if(!old||Date.parse(p.proposal_saved_at)>Date.parse(old.proposal.proposal_saved_at))groups.set(group,record);
 }catch(e){invalid.push({id:record?.id||null,error:e.message});}}
 const scored=[],pending=[],excluded=[];
 for(const record of groups.values()){
  const p=record.proposal,r=byKey.get(key(p));if(!r){pending.push({key:key(p),cohort:record.kind});continue;}
  const ordered=[...(r.entries||[])].sort((a,b)=>a.finish-b.finish);
  if(r.entries?.length!==6||new Set(r.entries.map(e=>e.lane)).size!==6||new Set(r.entries.map(e=>e.racer_id)).size!==6||r.entries.some(e=>!Number.isInteger(e.lane)||e.lane<1||e.lane>6||!/^\d{4}$/.test(e.racer_id))||!ordered.every((e,i)=>e.finish===i+1&&e.finish_status==='NORMAL'&&e.actual_st_status==='NORMAL')||r.settlement_status&&r.settlement_status!=='NORMAL'){
   excluded.push({key:key(p),reason:'欠場・F/L・異常着順・返還等は通常レースの評価から除外'});continue;}
  if(p.entries?.length!==6||p.entries.some(e=>!r.entries.some(actual=>actual.lane===e.lane&&actual.racer_id===e.racer_id))){excluded.push({key:key(p),reason:'予想時と確定結果の選手が一致しません'});continue;}
  const actual_combo=ordered.slice(0,3).map(e=>e.lane).join('-'),ranked=[...p.probabilities].sort((a,b)=>b.probability-a.probability||a.combo.localeCompare(b.combo));
  const st_errors=p.entries.flatMap(e=>{const a=r.entries.find(x=>x.lane===e.lane);if(!Number.isFinite(e.exhibition_st)||!Number.isFinite(a.actual_st))return [];const gap=p.history?.lanes?.find(x=>x.lane===e.lane)?.exhibition_st_gap;return [{lane:e.lane,raw_gap:a.actual_st-e.exhibition_st,corrected_error:gap?.n>0&&Number.isFinite(gap.mean)?a.actual_st-(e.exhibition_st+gap.mean):null}];});
  const official_payout_yen=r.payout?.combo===actual_combo&&Number.isInteger(r.payout.yen)&&r.payout.yen>0&&r.payout.source_url===r.source?.url&&/^[a-f0-9]{64}$/.test(r.payout.source_sha256||'')&&r.payout.source_sha256===r.source?.sha256?r.payout.yen:null;
  scored.push({key:key(p),date:p.date,venue_code:p.venue_code,model_id:p.model_id,model_coefficient_id:/^annual-coeff-[a-f0-9]{64}$/.test(p.model_coefficient_id||'')?p.model_coefficient_id:null,cohort:record.kind==='COLLECTOR_PRERACE'?'RECEIPT_BEFORE_CUTOFF':'WORKER_REPORTED_ONLY',snapshot_id:record.id,received_at:record.received_at,proposal_saved_at:p.proposal_saved_at,actual_combo,official_payout_yen,probabilities:ranked,probability_top10:ranked.slice(0,10).map(x=>x.combo),value_top10:rankExpectedValue(ranked,p.odds.items).slice(0,10).map(x=>x.combo),st_errors,result_source:r.source||null});
 }
 const cohorts=Object.fromEntries(['RECEIPT_BEFORE_CUTOFF','WORKER_REPORTED_ONLY'].map(c=>{const rows=scored.filter(r=>r.cohort===c);return [c,{...summarize(rows),by_model:Object.fromEntries([...new Set(rows.map(r=>r.model_id))].map(id=>[id,summarize(rows.filter(r=>r.model_id===id))])),by_coefficient:Object.fromEntries([...new Set(rows.map(r=>r.model_coefficient_id||'UNKNOWN'))].map(id=>[id,summarize(rows.filter(r=>(r.model_coefficient_id||'UNKNOWN')===id))]))}];}));
 return {schema_version:1,kind:'PROSPECTIVE_OPERATIONAL_REVIEW',generated_at:new Date(now).toISOString(),cohorts,pending,excluded,invalid,records:scored.map(({probabilities,...row})=>row),assumptions:['確率上位と期待値上位を各10点・各100円で毎レース購入する仮想評価。実購入の収益ではありません。','回収率は正常な6艇レースで公式払戻額を照合できたものだけ。締切前オッズを確定払戻額として使いません。','RECEIPT_BEFORE_CUTOFFは収集処理が締切3分前までに受信。WORKER_REPORTED_ONLYはWorkerの保存時刻のみで、受信による事前保存の証明とは分けます。','当日・未来の結果は集計しません。選手変更やF/L等は除外し、未照合を不的中として数えません。']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [command,input,output]=process.argv.slice(2);if(command==='capture'){
  requireValue(input&&output,'capture stagingフォルダ 保存先');const rows=filesUnder(input).map(f=>JSON.parse(fs.readFileSync(f)));console.log(JSON.stringify(captureProspective(rows,output)));
 }else if(command==='evaluate'){
  requireValue(input&&output,'evaluate 保存先 確定結果.json');const records=filesUnder(path.join(input,'snapshots')).map(f=>JSON.parse(fs.readFileSync(f))),result=evaluateProspective(records,!fs.existsSync(output)?[]:fs.statSync(output).isDirectory()?filesUnder(output).flatMap(f=>JSON.parse(fs.readFileSync(f))):JSON.parse(fs.readFileSync(output)));fs.mkdirSync(path.join(input,'reports'),{recursive:true});fs.writeFileSync(path.join(input,'reports','current.json'),JSON.stringify(result)+'\n');console.log(JSON.stringify({cohorts:Object.fromEntries(Object.entries(result.cohorts).map(([k,v])=>[k,{races:v.races,probability_top10:v.probability_top10,value_top10:v.value_top10}])),pending:result.pending.length,excluded:result.excluded.length,invalid:result.invalid.length}));
 }else throw Error('capture または evaluate を指定してください');}catch(e){console.error(e.message);process.exitCode=1;}
}
