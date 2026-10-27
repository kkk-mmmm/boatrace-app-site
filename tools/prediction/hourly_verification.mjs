import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {validateRecord} from './prospective.mjs';
import {storeLiveResults} from './live_results.mjs';
import {verifiedResults} from '../../site/public-verification.mjs';
import {validateLiveOdds} from '../../site/public/odds-live.mjs';
import {finalizeExperiments} from './experiments.mjs';
import {oddsProvider} from '../../site/odds-provider.mjs';
const day=now=>new Date(now+9*3600000).toISOString().slice(0,10),key=r=>`${r.date}/${r.venue_code}/${r.race_no}`;
const walk=dir=>!fs.existsSync(dir)?[]:fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.name.endsWith('.json')?[path.join(dir,e.name)]:[]);
export function pendingToday(directory,{now=Date.now()}={}){
 const today=day(now),known=verifiedResults(directory,{from:today,through:today,now}),targets=new Map();
 for(const file of walk(path.join(directory,'snapshots',today))){const record=validateRecord(JSON.parse(fs.readFileSync(file)),now),p=record.proposal;
  if(p.date!==today||known.has(key(p))||Date.parse(p.deadline_at)+300000>now)continue;
  const old=targets.get(key(p));if(!old||Date.parse(old.proposal_saved_at)<Date.parse(p.proposal_saved_at))targets.set(key(p),p);
 }
 return [...targets.values()];
}
export async function hourlyVerification(directory,{apiUrl=oddsProvider(),fetcher=fetch,now=Date.now(),definitions=[],clock=()=>now}={}){
 const targets=pendingToday(directory,{now}),report={pending:targets.length,requests:0,saved:0,existing:0,skipped:0};
 if(targets.length){
  const url=new URL(apiUrl);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/v1/odds'||url.search||url.hash)throw Error('Invalid shared result API URL');url.searchParams.set('date',day(now));
  const response=await fetcher(url,{cache:'no-store',signal:AbortSignal.timeout(30000)});report.requests=1;if(!response.ok)throw Error('Shared result API HTTP '+response.status);
  const data=await response.json(),receivedAt=clock();if(!Number.isFinite(receivedAt)||receivedAt<now)throw Error('Invalid receipt clock');validateLiveOdds(data,day(receivedAt),receivedAt);
  if(!Number.isFinite(Date.parse(data.served_at))||receivedAt-Date.parse(data.served_at)>120000||Date.parse(data.served_at)>receivedAt+60000)throw Error('Shared result API response is stale');
  Object.assign(report,storeLiveResults(directory,data.results,targets,{now:receivedAt}));
 }
 finalizeExperiments(directory,definitions,{now});return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [directory,config]=process.argv.slice(2);if(!directory||!config)throw Error('保存先と検証定義を指定してください');const definitions=JSON.parse(fs.readFileSync(config)).experiments;console.log('::notice title=Hourly result reconciliation::'+JSON.stringify(await hourlyVerification(directory,{definitions,clock:Date.now})));}
 catch(error){console.error(error);process.exitCode=1;}
}
