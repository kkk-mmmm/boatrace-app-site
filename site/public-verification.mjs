import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {validateRecord} from '../tools/prediction/prospective.mjs';
import {liveResultRecords,settlementSignature} from '../tools/prediction/live_results.mjs';
import {verificationRow} from './public/verification-data.mjs';
export function publicVerificationArchive(directory,{now=Date.now()}={}){
 const today=new Date(now+9*3600000).toISOString().slice(0,10),from=new Date(Date.parse(today)-6*86400000).toISOString().slice(0,10),rows=[],results=new Map();
 for(const [key,value] of verifiedResults(directory,{from,through:today,now}))results.set(key,value);
 const walk=dir=>!fs.existsSync(dir)?[]:fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.name.endsWith('.json')?[path.join(dir,e.name)]:[]);
 const root=path.join(directory,'snapshots'),records=fs.existsSync(root)?fs.readdirSync(root).filter(d=>d>=from&&d<=today&&/^\d{4}-\d{2}-\d{2}$/.test(d)).flatMap(d=>walk(path.join(root,d))):[];
 const selected=new Map();
 for(const file of records){const r=validateRecord(JSON.parse(fs.readFileSync(file)),now),p=r.proposal,k=`${p.date}/${p.venue_code}/${p.race_no}/${r.kind}`;const old=selected.get(k);if(!old||Date.parse(p.proposal_saved_at)>Date.parse(old.proposal.proposal_saved_at))selected.set(k,r);}
 for(const record of selected.values()){
  const p=record.proposal,r=results.get(`${p.date}/${p.venue_code}/${p.race_no}`);let result=null;
  if(r)result=archiveResult(r,p);
  rows.push(verificationRow(p,result,now,record.kind==='COLLECTOR_PRERACE'?'RECEIPT_BEFORE_CUTOFF':'WORKER_REPORTED_ONLY'));
 }
 return {schema_version:1,kind:'PUBLIC_VERIFICATION_ARCHIVE',generated_at:new Date(now).toISOString(),from,through:today,public_days:7,records:rows.filter(Boolean)};
}
export function verifiedResults(directory,{from,through,now=Date.now()}){
 const results=new Map();
 const resultDirectory=path.join(directory,'results');
 if(fs.existsSync(resultDirectory))for(const file of fs.readdirSync(resultDirectory).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)&&f.slice(0,10)>=from&&f.slice(0,10)<=through)){
  const source=path.join(resultDirectory,file),bytes=fs.readFileSync(source),digest=source.replace(/\.json$/,'.sha256');
  if(!fs.existsSync(digest)||crypto.createHash('sha256').update(bytes).digest('hex')!==fs.readFileSync(digest,'utf8').trim())throw Error('Saved result integrity mismatch');
  for(const r of JSON.parse(bytes))results.set(`${r.date}/${r.venue_code}/${r.race_no}`,r);
 }
 for(const [key,record] of liveResultRecords(directory,{from,through,now})){
  const live={...record.result,kind:'WORKER_OFFICIAL_RESULT',result_received_at:record.received_at},archived=results.get(key);
  if(!archived)results.set(key,live);
  else if(settlementSignature(archived)!==settlementSignature(live))results.set(key,{...live,source_conflict:true,archive_source_url:archived.source?.url});
 }
 return results;
}
export function archiveResult(r,p){if(r.kind==='WORKER_OFFICIAL_RESULT')return r;return {...r,status:'CONFIRMED',kind:'OFFICIAL_ARCHIVE',deadline_at:p.deadline_at,source_url:r.source?.url,source_sha256:r.source?.sha256,entries:r.entries.map(e=>({...e,st:e.actual_st,st_status:e.actual_st_status})),payouts:r.payout?.source_url===r.source?.url&&r.payout?.source_sha256===r.source?.sha256?[{combo:r.payout.combo,payout_yen_per_100:r.payout.yen}]:[]};}
