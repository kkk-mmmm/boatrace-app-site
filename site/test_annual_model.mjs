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

test('直近30・90日と実進入別の履歴を枠と区別し、過去だけから集計する',async()=>{
 const {buildHistoryProfiles}=await import('../tools/prediction/history_profiles.mjs');
 const {annualDataDetails}=await import('./public/annual-model.mjs');
 const dates=['2026-01-01','2026-10-01','2026-10-22'];
 const races=dates.map((date,i)=>({...race,date,venue_code:'01',race_no:1,entries:race.entries.map(e=>({...e,actual_st:.1+i*.03}))}));
 const profiles=buildHistoryProfiles(races,{from:'2025-10-23',through:'2026-10-22'}),model={profiles,trained_through:'2026-10-22'};
 const detail=annualDataDetails({...race,date:'2026-10-23'},model,{...race.entries[0],exhibition_course:6});
 assert.equal(detail.recent[30].all.samples,2);assert.equal(detail.recent[90].lane.samples,2);
 assert.equal(detail.actual_course.samples,3);assert.equal(detail.actual_course.course,6);assert.equal(detail.actual_course.mean_st,.13);
 assert.equal(annualDataDetails({...race,date:'2026-10-23'},model,race.entries[0]).actual_course,null);
 assert.equal(profiles.players['4000'].c1,undefined);assert.equal(profiles.players['4000'].l1[0],3);
 const ordinary=emptyAnnualProfiles();for(const r of races)observeAnnual(ordinary,r);
 assert.deepEqual(annualFeatures(race,profiles),annualFeatures(race,ordinary),'追加集計は承認済み確率の入力を変更しない');
 assert.throws(()=>buildHistoryProfiles([...races,races[0]],{from:'2025-10-23',through:'2026-10-22'}),/重複/);
 assert.throws(()=>buildHistoryProfiles([{...races[0],date:'2026-10-23'}],{from:'2025-10-23',through:'2026-10-22'}),/当日・未来/);
 assert.deepEqual(annualDataDetails(race,model,race.entries[0]).recent,{});
});

test('場別の枠・決まり手は全国と別集計し、同じ選手でも場に応じた特徴量になる',async()=>{
 const {VENUE_ANNUAL_FEATURES,annualVenueSummary}=await import('./public/annual-model.mjs');const p=emptyAnnualProfiles();
 for(let i=0;i<400;i++){
  observeAnnual(p,{...race,venue_code:'24',kimarite:'逃げ',entries:race.entries.map(e=>({...e,finish:e.lane}))});
  observeAnnual(p,{...race,venue_code:'02',kimarite:'まくり',entries:race.entries.map(e=>({...e,finish:e.lane===3?1:e.lane===1?3:e.lane}))});
 }
 const omura=annualFeatures({...race,venue_code:'24'},p,VENUE_ANNUAL_FEATURES),toda=annualFeatures({...race,venue_code:'02'},p,VENUE_ANNUAL_FEATURES);
 assert.equal(omura[0].length,17);assert.ok(omura[0][14]>toda[0][14]);assert.ok(omura[0][15]>toda[0][15]);assert.ok(omura[0][16]>toda[0][16]);
 assert.deepEqual(omura[0].slice(0,14),toda[0].slice(0,14),'既存の選手能力は同じ');
 const missing=annualFeatures({...race,venue_code:'01'},p,VENUE_ANNUAL_FEATURES);for(const row of missing)assert.deepEqual(row.slice(14),[0,0,0]);
 const summary=annualVenueSummary({venue_code:'24'},{profiles:p,trained_from:'2025-10-24',trained_through:'2026-10-23'});assert.equal(summary.lanes[0].win_rate,1);assert.equal(summary.lanes[0].escape_rate,1);assert.equal(summary.lanes[0].starts,400);
});

test('v3.1は実際の予想確率に場別差を使い、旧14項目モデルも互換性を保つ',async()=>{
 const {VENUE_ANNUAL_ENGINE,VENUE_ANNUAL_FEATURES,predictAnnual,validateAnnualModel}=await import('./public/annual-model.mjs');const profiles=emptyAnnualProfiles();
 for(let n=0;n<400;n++)for(const code of ['24','02'])observeAnnual(profiles,{...race,venue_code:code,kimarite:code==='24'?'逃げ':'まくり',entries:race.entries.map(e=>({...e,finish:code==='24'?e.lane:e.lane===1?3:e.lane===3?1:e.lane}))});
 const model={schema_version:3,engine_version:VENUE_ANNUAL_ENGINE,id:'annual-v3-'+'a'.repeat(64),feature_names:VENUE_ANNUAL_FEATURES,trained_from:'2025-10-24',trained_through:'2026-10-23',coverage:{days:365,failures:0,from:'2025-10-24',through:'2026-10-23'},profiles,coefficients:VENUE_ANNUAL_FEATURES.map((_,i)=>i===14?1:0),means:VENUE_ANNUAL_FEATURES.map(()=>0),scales:VENUE_ANNUAL_FEATURES.map(()=>1),temperature:1};
 const get=code=>predictAnnual({...race,date:'2026-10-24',venue_code:code},model),omura=get('24'),toda=get('02');
 const first=rows=>rows.filter(x=>x.combo.startsWith('1-')).reduce((s,x)=>s+x.probability,0);
 assert.ok(first(omura.items)>first(toda.items));assert.equal(omura.scores[0].history_components[14].label,'場・枠別1着傾向');assert.ok(Math.abs(omura.items.reduce((s,x)=>s+x.probability,0)-1)<1e-10);
 assert.throws(()=>validateAnnualModel({...model,feature_names:ANNUAL_FEATURES},'2026-10-24'),/特徴量/);
});
