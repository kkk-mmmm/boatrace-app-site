// Append-only copies of the Worker's already acquired official results.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {validResult} from '../../site/public/odds-live.mjs';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key=r=>`${r.date}/${r.venue_code}/${r.race_no}`;
const walk=dir=>!fs.existsSync(dir)?[]:fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.name.endsWith('.json')?[path.join(dir,e.name)]:[]);
export function validateLiveResultRecord(record,{now=Date.now()}={}){
 const {integrity_sha256,...body}=record||{};
 if(record?.schema_version!==1||record.kind!=='WORKER_OFFICIAL_RESULT_RECORD'||integrity_sha256!==hash(body))throw Error('Stored live result integrity mismatch');
 if(record.result?.status!=='CONFIRMED'||!validResult(record.result,record.result.date,now)||!Number.isFinite(Date.parse(record.received_at))||Date.parse(record.received_at)<Date.parse(record.result.fetched_at)||Date.parse(record.received_at)>now+60000)throw Error('Stored live result identity or time invalid');
 return record;
}
export function liveResultRecords(directory,{from,through,now=Date.now()}={}){
 const root=path.join(directory,'live-results'),rows=new Map();if(!fs.existsSync(root))return rows;
 for(const day of fs.readdirSync(root).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>=from&&d<=through))for(const file of walk(path.join(root,day))){
  const record=validateLiveResultRecord(JSON.parse(fs.readFileSync(file,'utf8')),{now}),r=record.result;
  if(file!==path.join(root,r.date,r.venue_code,`R${r.race_no}.json`)||r.date!==day||rows.has(key(r)))throw Error('Stored live result path or duplicate invalid');
  rows.set(key(r),record);
 }
 return rows;
}
export function settlementSignature(r){
 const archive=!!r.source,entries=[...(r.entries||[])].sort((a,b)=>a.lane-b.lane).map(e=>[e.lane,e.racer_id,e.finish,archive?e.actual_st_status:e.st_status]);
 const payouts=archive?(r.payout&&r.payout.source_url===r.source?.url&&r.payout.source_sha256===r.source?.sha256?[[r.payout.combo,r.payout.yen]]:[]):(r.payouts||[]).map(p=>[p.combo,p.payout_yen_per_100]);
 return JSON.stringify({entries,payouts:payouts.sort(([a],[b])=>a.localeCompare(b))});
}
export function storeLiveResults(directory,results,targets,{now=Date.now()}={}){
 const report={saved:0,existing:0,skipped:0},byKey=new Map(targets.map(t=>[key(t),t]));
 for(const r of results||[]){const p=byKey.get(key(r));
  if(!p||r.status!=='CONFIRMED'||!validResult(r,r.date,now)||r.deadline_at!==p.deadline_at||Date.parse(r.fetched_at)>now||p.entries?.length!==6||p.entries.some(e=>!r.entries.some(x=>x.lane===e.lane&&x.racer_id===e.racer_id))){report.skipped++;continue;}
  const file=path.join(directory,'live-results',r.date,r.venue_code,`R${r.race_no}.json`);
  if(fs.existsSync(file)){const old=validateLiveResultRecord(JSON.parse(fs.readFileSync(file)),{now});if(settlementSignature(old.result)!==settlementSignature(r))throw Error('Confirmed live result changed after first save: '+key(r));report.existing++;continue;}
  const body={schema_version:1,kind:'WORKER_OFFICIAL_RESULT_RECORD',received_at:new Date(now).toISOString(),result:r},record={...body,integrity_sha256:hash(body)};validateLiveResultRecord(record,{now});
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(record)+'\n',{flag:'wx'});report.saved++;
 }
 return report;
}
