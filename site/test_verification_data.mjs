import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {annualTriples} from './public/annual-model.mjs';import {proposalCandidate} from './public/odds-live.mjs';import {verificationRow,verificationResponse} from './public/verification-data.mjs';import {publicVerificationArchive} from './public-verification.mjs';
const now=Date.parse('2030-01-08T01:00:00Z'),date='2030-01-07',deadline_at=date+'T12:00:00+09:00',saved=date+'T11:51:00+09:00';
const entries=Array.from({length:6},(_,i)=>({lane:i+1,racer_id:String(4000+i),name:'選手'+i,finish:i+1,course:i+1,st:.15,st_status:'NORMAL'}));
const target={date,venue_code:'24',race_no:1,deadline_at,model_id:'test-model',model_name:'テスト',prediction_saved_at:saved,input_fetched_at:date+'T11:50:00+09:00',prediction_key:'test-model:'+saved,probabilities:annualTriples([5,4,3,2,1,0]),entries,update_status:'OK',last_success_at:date+'T11:54:00+09:00'};
const p={...proposalCandidate(target,{...target,status:'OK',items:target.probabilities.map(r=>({combo:r.combo,odds:12})),fetched_at:date+'T11:55:00+09:00',source_url:'https://www.boatrace.jp/owpc/pc/race/odds3t?hd=20300107&jcd=24&rno=1'},Date.parse(date+'T11:56:00+09:00')),frozen_at:date+'T11:57:00+09:00'};
const result={date,venue_code:'24',race_no:1,deadline_at,status:'CONFIRMED',source_url:'https://www.boatrace.jp/owpc/pc/race/raceresult?hd=20300107&jcd=24&rno=1',attempted_at:date+'T12:05:00+09:00',fetched_at:date+'T12:06:00+09:00',entries,payouts:[{combo:'1-2-3',payout_yen_per_100:2000}]};
test('保存予想だけを使い、実払戻で仮想回収率を計算。欠損・選手違い・Fを不的中にしない',()=>{
 const row=verificationRow(p,result,now);assert.equal(row.status,'SETTLED');assert.equal(row.probability_top10.length,10);assert.equal(row.probability_strategy.stake_yen,1000);assert.equal(row.probability_strategy.hit,true);assert.equal(row.probability_strategy.return_yen,2000);assert.equal(row.probability_strategy.recovery_percent,200);
 assert.equal(verificationRow(p,null,now).status,'MISSING_RESULT');assert.equal(verificationRow(null,result,now).status,'MISSING_PROPOSAL');
 const altered=structuredClone(result);altered.entries[0].racer_id='9999';assert.equal(verificationRow(p,altered,now).status,'EXCLUDED');
 const flying=structuredClone(result);flying.entries[5].st_status='F';flying.entries[5].st=-.01;assert.equal(verificationRow(p,flying,now).status,'EXCLUDED');
 const response=verificationResponse([row,verificationRow({...p,race_no:2},null,now)],{now,date});assert.equal(response.summary.evaluated_races,1);assert.equal(response.summary.pending_or_excluded,1);assert.equal(response.days.length,7);assert.throws(()=>verificationResponse([row],{date:'2030-01-01',now}),/直近7日/);assert.throws(()=>verificationResponse([],{limit:100,now}));
 assert.equal(verificationResponse([row],{now}).date,date);assert.equal(verificationResponse([row,row],{now,date,offset:0,limit:1}).total,1);
});
test('公開用書き出しは7日だけ、受信記録と結果ハッシュを検証し、保存原本を書き換えない',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'verification-public-'));try{
 const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
 const payload={kind:'WORKER_FROZEN',proposal:p},record={schema_version:1,id:hash(payload),received_at:date+'T12:00:00+09:00',...payload};record.integrity_sha256=hash(record);
 const folder=path.join(dir,'snapshots',date,'24');fs.mkdirSync(folder,{recursive:true});const snap=path.join(folder,'one.json');fs.writeFileSync(snap,JSON.stringify(record));
 const archived={date,venue_code:'24',race_no:1,entries:entries.map(e=>({...e,actual_st:e.st,actual_st_status:e.st_status})),source:{url:'https://www1.mbrace.or.jp/od2/K/203001/k300107.lzh',sha256:'a'.repeat(64)},payout:{combo:'1-2-3',yen:2000,source_url:'https://www1.mbrace.or.jp/od2/K/203001/k300107.lzh',source_sha256:'a'.repeat(64)}};
 fs.mkdirSync(path.join(dir,'results'));const file=path.join(dir,'results',date+'.json'),bytes=JSON.stringify([archived]);fs.writeFileSync(file,bytes);fs.writeFileSync(file.replace('.json','.sha256'),hash(bytes));const before=fs.readFileSync(snap,'utf8');
 const output=publicVerificationArchive(dir,{now});assert.equal(output.records.length,1);assert.equal(output.records[0].status,'SETTLED');assert.equal(fs.readFileSync(snap,'utf8'),before);
 fs.appendFileSync(file,' ');assert.throws(()=>publicVerificationArchive(dir,{now}),/integrity/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('期待値が同じ場合も保存順位ではなく画面と同じ買い目順で10点を選ぶ',async()=>{
 const {predictionRanking}=await import('./public/view.mjs');
 const probs=p.probabilities.map((r,i)=>({...r,probability:1/120,rank:120-i}));
 const proposal={...p,probabilities:probs,odds:{...p.odds,items:probs.map(r=>({combo:r.combo,odds:20}))}};
 const row=verificationRow(proposal,result,now);assert.equal(row.status,'SETTLED');
 const expected=predictionRanking(probs,proposal.odds.items,{tab:'value',currentOdds:true}).slice(0,10).map(r=>r.combo);
 assert.deepEqual(row.value_top10.map(r=>r.combo),expected);assert.deepEqual(expected,[...probs].map(r=>r.combo).sort().slice(0,10));
});
