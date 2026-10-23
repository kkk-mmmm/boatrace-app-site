import {test} from 'node:test';import assert from 'node:assert/strict';
import {emptyAnnualProfiles,observeAnnual,annualFeatures,annualLaneStats,annualTriples,ANNUAL_FEATURES} from './public/annual-model.mjs';
const race={date:'2026-01-01',kimarite:'差し',context:{meeting_day:2,phase:'QUALIFYING'},entries:Array.from({length:6},(_,i)=>({lane:i+1,racer_id:String(4000+i),finish:i+1,finish_status:'NORMAL',actual_course:6-i,actual_st:.1+i*.01,actual_st_status:'NORMAL',start_rank:i+1,exhibition_time:6.7+i*.01}))};
test('枠番で選手履歴を集計し、進入コースと混同せず勝率・ST・ST順位を表示する',()=>{
 const p=emptyAnnualProfiles();observeAnnual(p,race);const s=annualLaneStats({profiles:p},'4000',1);
 assert.equal(s.samples,1);assert.equal(s.win_rate,1);assert.equal(s.mean_points,10);assert.equal(s.mean_st,.1);assert.equal(s.mean_start_rank,1);assert.equal(s.kimarite['差し'],1);
 assert.equal(annualLaneStats({profiles:p},'4000',6).samples,0);
 assert.ok(annualFeatures(race,p).flat().every(Number.isFinite));assert.equal(annualFeatures(race,p)[0].length,ANNUAL_FEATURES.length);
});
test('ST異常や欠場を通常のST・順位へ混ぜず、欠場の1着率の分母を増やさない',()=>{
 const p=emptyAnnualProfiles();observeAnnual(p,{...race,entries:race.entries.map((e,i)=>i===0?{...e,finish:null,actual_st_status:'F',start_rank:null}:i===1?{...e,finish_status:'K0'}:e)});
 assert.equal(annualLaneStats({profiles:p},'4000',1).st_samples,0);assert.equal(annualLaneStats({profiles:p},'4000',1).start_rank_samples,0);assert.equal(annualLaneStats({profiles:p},'4001',2).samples,0);
});
test('120通りが重複せず、全確率の合計1を保ち、未知選手も母集団から有限値を作る',()=>{
 const rows=annualTriples([2,1,.4,.3,.2,-1]);assert.equal(rows.length,120);assert.equal(new Set(rows.map(r=>r.combo)).size,120);assert.ok(Math.abs(rows.reduce((s,r)=>s+r.probability,0)-1)<1e-10);
 assert.ok(annualFeatures(race,emptyAnnualProfiles()).flat().every(Number.isFinite));
});

test('展示ST差は正常な照合ペアの平均・RMSE・件数を表示し、当日・未来の資料は使用しない',async()=>{
 const {pairedExhibitionGap}=await import('./public/annual-model.mjs');
 const model={exhibition_st_profiles:{schema_version:1,kind:'EXHIBITION_ST_PAIRED_HISTORY',window_from:'2025-10-23',through:'2026-10-22',players:{'1234':{n:2,sum:.2,sum_squares:.025,from:'2026-10-01',through:'2026-10-20'}}}};
 const gap=pairedExhibitionGap(model,'1234','2026-10-23');assert.equal(gap.n,2);assert.equal(gap.mean,.1);assert.ok(Math.abs(gap.rmse-Math.sqrt(.0125))<1e-12);
 assert.equal(pairedExhibitionGap(model,'9999','2026-10-23'),null);assert.equal(pairedExhibitionGap(model,'1234','2026-10-22'),null);
});
