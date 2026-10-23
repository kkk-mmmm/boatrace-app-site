import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {captureProspective,evaluateProspective,validateRecord} from './prospective.mjs';
const now=Date.parse('2030-01-01T01:00:00Z'),later=now+86400000;
function example(){
 const date='2030-01-01',probabilities=[];for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)if(new Set([a,b,c]).size===3)probabilities.push({combo:`${a}-${b}-${c}`,probability:a===1?.025:.005,rank:probabilities.length+1});
 const entries=Array.from({length:6},(_,i)=>({lane:i+1,racer_id:String(4000+i),name:'選手',exhibition_st:.1}));
 const race={date,venue_code:'01',race_no:1,deadline_at:new Date(now+8*60000).toISOString(),model_id:'annual-v3-'+'a'.repeat(64),model_coefficient_id:'annual-coeff-'+'b'.repeat(64),prediction_saved_at:new Date(now-1000).toISOString(),input_fetched_at:new Date(now-60000).toISOString(),entries,probabilities,
 odds:{items:probabilities.map(p=>({combo:p.combo,odds:p.combo==='6-5-4'?1000:20})),source_url:'https://www.boatrace.jp/owpc/pc/race/odds3t?hd=20300101&jcd=01&rno=1',fetched_at:new Date(now-1).toISOString()},odds_update:{status:'OK'},history:{lanes:[{lane:1,exhibition_st_gap:{n:20,mean:.05}}]}};
 return {date,venue_code:'01',races:[race],update:{status:'OK',last_success_at:new Date(now-1000).toISOString()}};
}
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boatrace-prospective-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function load(dir){return fs.readdirSync(path.join(dir,'snapshots/2030-01-01/01/R1')).map(f=>JSON.parse(fs.readFileSync(path.join(dir,'snapshots/2030-01-01/01/R1',f))));}
function result(){return {date:'2030-01-01',venue_code:'01',race_no:1,source:{url:'https://www1.mbrace.or.jp/od2/K/203001/k300101.lzh',sha256:'a'.repeat(64)},entries:example().races[0].entries.map((e,i)=>({...e,finish:i+1,finish_status:'NORMAL',actual_st_status:'NORMAL',actual_st:.15})),payout:{combo:'1-2-3',yen:2400,source_url:'https://www1.mbrace.or.jp/od2/K/203001/k300101.lzh',source_sha256:'a'.repeat(64)}};}
test('締切前受信を上書きせず保存し、確率と受信時刻の改変を検出する',t=>{
 const dir=temp(t),snapshot=example();assert.equal(captureProspective([snapshot],dir,{now}).saved,1);const before=load(dir)[0];
 assert.equal(captureProspective([snapshot],dir,{now}).existing,1);assert.deepEqual(load(dir)[0],before);validateRecord(before,now);
 const changed=structuredClone(before);changed.proposal.probabilities[0].probability=.9;assert.throws(()=>validateRecord(changed,now),/変更/);
 changed.proposal=before.proposal;changed.received_at=new Date(now-2000).toISOString();assert.throws(()=>validateRecord(changed,now),/変更/);
});
test('締切後・遠い未来・欠場・古いオッズを事前受信として保存しない',t=>{
 const dir=temp(t);for(const mutate of [r=>r.deadline_at=new Date(now+1000).toISOString(),r=>r.deadline_at=new Date(now+3600000).toISOString(),r=>r.entries[0].participation_status='WITHDRAWN',r=>r.odds.fetched_at=new Date(now-11*60000).toISOString()]){const s=example();mutate(s.races[0]);assert.equal(captureProspective([s],dir,{now}).saved,0);}
});
test('上位10点、公式払戻の回収率、確率のずれとST補正誤差を保存記録から計算する',t=>{
 const dir=temp(t);captureProspective([example()],dir,{now});const review=evaluateProspective(load(dir),[result()],{now:later}),s=review.cohorts.RECEIPT_BEFORE_CUTOFF;
 assert.equal(s.races,1);assert.equal(s.probability_top10.hit_rate,1);assert.equal(s.probability_top10.return_rate,2.4);assert.equal(s.probability_top10.profit_yen,1400);assert.equal(s.value_top10.hit_rate,1);
 assert.ok(Math.abs(s.log_loss+Math.log(.025))<1e-10);assert.equal(s.calibration.reduce((n,b)=>n+b.observations,0),120);assert.equal(s.calibration.reduce((n,b)=>n+b.hits,0),1);
 assert.ok(Math.abs(s.exhibition_st_raw_gap.bias-.05)<1e-10);assert.ok(s.exhibition_st_corrected_error.rmse<1e-10);assert.equal(s.exhibition_st_corrected_error.n,1);assert.equal(s.exhibition_st_paired_raw_gap.n,1);assert.ok(Math.abs(s.exhibition_st_paired_raw_gap.bias-.05)<1e-10);assert.equal(s.by_coefficient['annual-coeff-'+'b'.repeat(64)].races,1);
});
test('未照合、当日結果、異常レース、選手変更を不的中にしない。払戻未取得をオッズで代用しない',t=>{
 const dir=temp(t);captureProspective([example()],dir,{now});const records=load(dir);
 assert.equal(evaluateProspective(records,[],{now:later}).pending.length,1);
 assert.equal(evaluateProspective(records,[result()],{now}).cohorts.RECEIPT_BEFORE_CUTOFF.races,0);
 for(const change of [r=>r.entries[0].finish_status='F1',r=>r.entries[0].racer_id='9999']){const r=result();change(r);const v=evaluateProspective(records,[r],{now:later});assert.equal(v.excluded.length,1);assert.equal(v.cohorts.RECEIPT_BEFORE_CUTOFF.races,0);}
 const r=result();delete r.payout;const s=evaluateProspective(records,[r],{now:later}).cohorts.RECEIPT_BEFORE_CUTOFF;assert.equal(s.races,1);assert.equal(s.probability_top10.return_rate,null);
});
test('Workerの事後受信は別集計とし、同じレースの事前受信を二重に数えない',t=>{
 const dir=temp(t),snapshot=example();captureProspective([snapshot],dir,{now});const first=load(dir)[0];
 const cutoff=Date.parse(first.proposal.cutoff_at);snapshot.races[0].proposal_snapshot={...first.proposal,frozen_at:new Date(cutoff).toISOString()};captureProspective([snapshot],dir,{now:cutoff+1000});
 captureProspective([example()],dir,{now:now+1000});const review=evaluateProspective(load(dir),[result()],{now:later});assert.equal(review.cohorts.RECEIPT_BEFORE_CUTOFF.races,1);assert.equal(review.cohorts.WORKER_REPORTED_ONLY.races,1);
 const malformed=structuredClone(first);malformed.proposal.model_id='changed';assert.equal(evaluateProspective([malformed],[result()],{now:later}).invalid.length,1);
 assert.throws(()=>evaluateProspective([first],[result(),result()],{now:later}),/重複/);
});
test('日次のプロフィールIDが変わっても同じ係数版の評価をまとめ、係数不明を分離する',t=>{
 const dir=temp(t),snapshot=example(),second=structuredClone(snapshot.races[0]),third=structuredClone(second);
 second.race_no=2;second.model_id='annual-v3-'+'c'.repeat(64);second.odds.source_url=second.odds.source_url.replace('rno=1','rno=2');
 third.race_no=3;delete third.model_coefficient_id;third.odds.source_url=third.odds.source_url.replace('rno=1','rno=3');snapshot.races.push(second,third);
 captureProspective([snapshot],dir,{now});const records=[...load(dir),...['R2','R3'].flatMap(r=>fs.readdirSync(path.join(dir,'snapshots/2030-01-01/01',r)).map(f=>JSON.parse(fs.readFileSync(path.join(dir,'snapshots/2030-01-01/01',r,f)))) )];
 const summary=evaluateProspective(records,[result(),{...result(),race_no:2},{...result(),race_no:3}],{now:later}).cohorts.RECEIPT_BEFORE_CUTOFF;
 assert.equal(Object.keys(summary.by_model).length,2);assert.equal(summary.by_coefficient['annual-coeff-'+'b'.repeat(64)].races,2);assert.equal(summary.by_coefficient.UNKNOWN.races,1);
});
