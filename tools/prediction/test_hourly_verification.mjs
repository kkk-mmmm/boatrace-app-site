import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {captureProspective} from './prospective.mjs';import {proposalCandidate} from '../../site/public/odds-live.mjs';
import {captureExperiments,captureInventory,experimentReport,finalizeExperiments} from './experiments.mjs';
import {hourlyVerification,pendingToday} from './hourly_verification.mjs';import {storeLiveResults,liveResultRecords} from './live_results.mjs';
import {publicVerificationArchive,verifiedResults} from '../../site/public-verification.mjs';
const start=Date.parse('2030-01-01T01:00:00Z'),freeze=start+5*60000,now=start+20*60000,date='2030-01-01';
const definition={id:'hourly-study',title:'試験',from:date,through:'2030-01-31',registered_at:new Date(start-60000).toISOString(),strategy:'EV_TOP10_FREQUENT_FOUR_BOX_V1',stake_per_combo_yen:100,tie_break:['summed_expected_value','lane_ascending'],venue_codes:Array.from({length:24},(_,i)=>String(i+1).padStart(2,'0'))};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boatrace-hourly-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const probabilities=[];for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)if(new Set([a,b,c]).size===3)probabilities.push({combo:`${a}-${b}-${c}`,probability:1/120,rank:probabilities.length+1});
 const target={date,venue_code:'01',race_no:1,deadline_at:new Date(start+8*60000).toISOString(),model_id:'test-model',model_name:'試験',prediction_saved_at:new Date(start-1000).toISOString(),input_fetched_at:new Date(start-10000).toISOString(),prediction_key:'test-model:'+new Date(start-1000).toISOString(),entries:Array.from({length:6},(_,i)=>({lane:i+1,racer_id:String(4000+i),name:'選手'})),probabilities,update_status:'OK',last_success_at:new Date(start-1000).toISOString(),context:{grade:'G1'}};
 const quote={...target,status:'OK',fetched_at:new Date(start-1).toISOString(),items:probabilities.map(p=>({combo:p.combo,odds:20})),source_url:'https://www.boatrace.jp/owpc/pc/race/odds3t?hd=20300101&jcd=01&rno=1'};
 const proposal={...proposalCandidate(target,quote,start),frozen_at:new Date(freeze).toISOString()},snapshot={date,venue_code:'01',meeting_status:'OPEN',races:[{...target,proposal_snapshot:proposal}]};
 captureInventory([snapshot],dir,[definition],{now:start-2000});captureProspective([snapshot],dir,{now:freeze+1000});captureExperiments(dir,[definition],{now:freeze+1000});
 const result={date,venue_code:'01',race_no:1,deadline_at:target.deadline_at,status:'CONFIRMED',source_url:'https://www.boatrace.jp/owpc/pc/race/raceresult?hd=20300101&jcd=01&rno=1',attempted_at:new Date(start+13*60000).toISOString(),fetched_at:new Date(start+14*60000).toISOString(),entries:target.entries.map((e,i)=>({...e,finish:i+1,course:i+1,st:.15,st_status:'NORMAL'})),payouts:[{combo:'1-2-3',payout_yen_per_100:2400}]};
 return {dir,target,result};
}
const payload=result=>({schema_version:1,date,interval_seconds:60,served_at:new Date(now).toISOString(),races:[],results:[result]});
const fetcher=(data,calls)=>async(url,options)=>{calls.push({url:String(url),cache:options.cache});return {ok:true,json:async()=>structuredClone(data)};};
const apiUrl='https://boatrace-odds.example.workers.dev/v1/odds';
function archive(dir,result,payout=2400){const source={url:'https://www1.mbrace.or.jp/od2/K/203001/k300101.lzh',sha256:'a'.repeat(64)},r={date,venue_code:'01',race_no:1,entries:result.entries.map(e=>({...e,actual_st:e.st,actual_st_status:e.st_status})),source,payout:{combo:'1-2-3',yen:payout,source_url:source.url,source_sha256:source.sha256}};fs.mkdirSync(path.join(dir,'results'),{recursive:true});const file=path.join(dir,'results',date+'.json'),bytes=JSON.stringify([r]);fs.writeFileSync(file,bytes);fs.writeFileSync(file.replace('.json','.sha256'),hash(bytes));return bytes;}
test('当日分を共有API1回だけで照合し、4艇BOX・7日実績へ実払戻で反映する',async t=>{
 const {dir,result}=setup(t),calls=[],before=fs.readFileSync(path.join(dir,'experiments/hourly-study/predictions',date,'01/R1.json'),'utf8');
 assert.equal(experimentReport(dir,definition,{now}).summary.pending,1);const report=await hourlyVerification(dir,{apiUrl,fetcher:fetcher(payload(result),calls),now,definitions:[definition]});
 assert.equal(report.saved,1);assert.equal(report.requests,1);assert.equal(calls.length,1);assert.equal(calls[0].cache,'no-store');assert.ok(calls.every(x=>new URL(x.url).hostname==='boatrace-odds.example.workers.dev'));
 const study=experimentReport(dir,definition,{now});assert.equal(study.summary.pending,0);assert.equal(study.summary.settled,1);assert.equal(study.summary.stake_yen,2400);assert.equal(study.summary.return_yen,2400);assert.equal(study.summary.recovery_percent,100);assert.equal(publicVerificationArchive(dir,{now}).records[0].status,'SETTLED');assert.equal(fs.readFileSync(path.join(dir,'experiments/hourly-study/predictions',date,'01/R1.json'),'utf8'),before);
 assert.equal((await hourlyVerification(dir,{apiUrl,fetcher:()=>{throw Error('unnecessary request');},now,definitions:[definition]})).requests,0);
});
test('締切直後・結果待ち・未保存予想は損失にせず、未照合がなければ通信しない',async t=>{
 const {dir,result}=setup(t);assert.equal(pendingToday(dir,{now:start+12*60000}).length,0);
 assert.equal((await hourlyVerification(dir,{apiUrl,fetcher:()=>{throw Error('must not fetch');},now:start+12*60000})).requests,0);
 const pending={...result,status:'PENDING'};const report=await hourlyVerification(dir,{apiUrl,fetcher:fetcher(payload(pending),[]),now});assert.equal(report.saved,0);assert.equal(experimentReport(dir,definition,{now}).summary.pending,1);assert.equal(experimentReport(dir,definition,{now}).summary.stake_yen,0);
 const empty=fs.mkdtempSync(path.join(os.tmpdir(),'boatrace-hourly-empty-'));t.after(()=>fs.rmSync(empty,{recursive:true,force:true}));assert.equal((await hourlyVerification(empty,{now,apiUrl,fetcher:()=>{throw Error('must not fetch');}})).requests,0);
});
test('別日・別選手・古い応答・通信失敗を確定結果にせず、Fは通常評価から除外する',async t=>{
 const {dir,target,result}=setup(t),changed=structuredClone(result);changed.entries[0].racer_id='9999';assert.equal(storeLiveResults(dir,[changed],[target],{now}).saved,0);
 await assert.rejects(hourlyVerification(dir,{apiUrl,now,fetcher:fetcher({...payload(result),date:'2030-01-02'},[])}));
 await assert.rejects(hourlyVerification(dir,{apiUrl,now,fetcher:fetcher({...payload(result),served_at:new Date(now-121000).toISOString()},[])}),/stale/);
 await assert.rejects(hourlyVerification(dir,{apiUrl,now,fetcher:async()=>({ok:false,status:503})}),/503/);
 assert.equal(experimentReport(dir,definition,{now}).summary.pending,1);
 const flying=structuredClone(result);flying.entries[5].st_status='F';flying.entries[5].st=-.01;storeLiveResults(dir,[flying],[target],{now});const study=experimentReport(dir,definition,{now});assert.equal(study.summary.excluded,1);assert.equal(study.summary.stake_yen,0);
});
test('確定記録を上書きせず改変を検出し、翌日アーカイブとの不一致を除外する',async t=>{
 const {dir,target,result}=setup(t);storeLiveResults(dir,[result],[target],{now});const file=path.join(dir,'live-results',date,'01/R1.json'),before=fs.readFileSync(file,'utf8');
 assert.equal(storeLiveResults(dir,[{...result,fetched_at:new Date(now-1000).toISOString()}],[target],{now}).existing,1);assert.equal(fs.readFileSync(file,'utf8'),before);
 const changed=structuredClone(result);changed.payouts[0].payout_yen_per_100=5000;assert.throws(()=>storeLiveResults(dir,[changed],[target],{now}),/changed after first save/);assert.equal(fs.readFileSync(file,'utf8'),before);
 const bytes=archive(dir,result);assert.equal(verifiedResults(dir,{from:date,through:date,now}).get(date+'/01/1').source.url,'https://www1.mbrace.or.jp/od2/K/203001/k300101.lzh');assert.equal(experimentReport(dir,definition,{now}).summary.recovery_percent,100);assert.equal(fs.readFileSync(path.join(dir,'results',date+'.json'),'utf8'),bytes);
 archive(dir,result,5000);const conflict=experimentReport(dir,definition,{now});assert.equal(conflict.summary.excluded,1);assert.equal(conflict.summary.stake_yen,0);assert.match(conflict.records[0].reason,/一致しない/);
 fs.appendFileSync(file,' '); // Whitespace is harmless; changing content must be rejected.
 const altered=JSON.parse(fs.readFileSync(file));altered.result.payouts[0].payout_yen_per_100=1000;fs.writeFileSync(file,JSON.stringify(altered));assert.throws(()=>liveResultRecords(dir,{from:date,through:date,now}),/integrity/);
});

test('期間終了後の記事は公式日次アーカイブで照合してから確定する',t=>{
 const {dir,target,result}=setup(t),after=Date.parse('2030-02-02T01:00:00Z');storeLiveResults(dir,[result],[target],{now});
 assert.equal(experimentReport(dir,definition,{now:after}).status,'AWAITING_ARCHIVE');finalizeExperiments(dir,[definition],{now:after});const file=path.join(dir,'experiments/hourly-study/article.json');assert.equal(fs.existsSync(file),false);
 archive(dir,result);finalizeExperiments(dir,[definition],{now:after});assert.equal(fs.existsSync(file),true);assert.equal(experimentReport(dir,definition,{now:after}).summary.recovery_percent,100);
});
