import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {monthlyCandidate} from './monthly_candidate.mjs';
import {ANNUAL_ENGINE,ANNUAL_FEATURES,emptyAnnualProfiles} from '../../site/public/annual-model.mjs';
test('日次の履歴更新は停止期間があっても復旧し、承認済み係数・標準化・検証結果を保持する',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'history-update-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const model={schema_version:3,engine_version:ANNUAL_ENGINE,id:'annual-v3-'+'a'.repeat(64),trained_from:'2025-01-01',trained_through:'2025-12-31',coverage:{days:365,failures:0,from:'2025-01-01',through:'2025-12-31'},profiles:emptyAnnualProfiles(),coefficients:ANNUAL_FEATURES.map(()=>.1),means:ANNUAL_FEATURES.map(()=>0),scales:ANNUAL_FEATURES.map(()=>1),temperature:1,validation:{heldout:{log_loss:4}}};
 const manifest={from:'2025-01-11',through:'2026-01-10',days:365,failures:[],races:1};
 const race={date:'2026-01-10',venue_code:'01',race_no:1,entries:[{lane:1,racer_id:'1234',finish:1,actual_course:2,actual_st_status:'NORMAL',actual_st:.1}]};
 for(const [file,data] of [['manifest.json',manifest],['races.json',[race]],['model.json',model]])fs.writeFileSync(path.join(dir,file),JSON.stringify(data));
 execFileSync(process.execPath,['tools/prediction/update_annual.mjs',dir,path.join(dir,'model.json')]);
 const next=JSON.parse(fs.readFileSync(path.join(dir,'model.json')));
 for(const key of ['coefficients','means','scales','temperature','validation'])assert.deepEqual(next[key],model[key]);
 assert.equal(next.coefficients_trained_through,'2025-12-31');assert.equal(next.profiles.players['1234'].r30l1[0],1);assert.equal(next.profiles.players['1234'].c2[0],1);
});
test('月次候補は日本時間の暦月に1回だけ作り、日次再実行では学習せず承認済みモデルへ昇格しない',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-review-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let runs=0;
 const train=(source,file)=>{runs++;fs.writeFileSync(file,JSON.stringify({schema_version:3,id:'annual-v3-'+'a'.repeat(64)}));fs.writeFileSync(path.join(path.dirname(file),'validation.json'),JSON.stringify({heldout:{log_loss:4}}));};
 const now=Date.parse('2026-10-31T14:59:00Z');assert.equal(monthlyCandidate('source',dir,now,train).created,true);
 assert.equal(monthlyCandidate('source',dir,now+30000,train).created,false);assert.equal(runs,1);
 assert.equal(monthlyCandidate('source',dir,now+60000,train).created,true);assert.equal(runs,2);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'2026-10/review.json'))).status,'AWAITING_REVIEW');
 fs.appendFileSync(path.join(dir,'2026-10/current.json'),' ');assert.throws(()=>monthlyCandidate('source',dir,now,train),/一致しません/);
});
test('学習に失敗した月は再試行でき、不完全な候補を完了扱いにしない',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-retry-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 assert.throws(()=>monthlyCandidate('source',dir,Date.parse('2026-10-01'),()=>{throw Error('失敗')}),/失敗/);assert.deepEqual(fs.readdirSync(dir),[]);
});
