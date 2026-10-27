import {test} from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {emptyAnnualProfiles,observeAnnual,annualFeatures,CONTEXT_ANNUAL_FEATURES,VENUE_ANNUAL_FEATURES} from './public/annual-model.mjs';
import {course2Stats,preraceEnvironment} from './public/race-context.mjs';
const entries=()=>Array.from({length:6},(_,i)=>({lane:i+1,racer_id:String(4000+i),name:'選手'+i,actual_course:i+1,actual_st:.15,actual_st_status:'NORMAL',start_rank:3.5,finish:i+1,finish_status:'NORMAL',exhibition_time:6.7}));
const history={date:'2026-10-20',venue_code:'24',race_no:1,kimarite:'逃げ',entries:entries()};
test('実進入2コースの逃がし率を集計し、枠2と混同せずF/Lを除外、少数例を縮小する',()=>{
 const p=emptyAnnualProfiles();observeAnnual(p,history);assert.equal(p.race_context.course2.players['4001'].escape,1);
 const swapped=structuredClone(history);swapped.race_no=2;swapped.entries[1].actual_course=3;swapped.entries[2].actual_course=2;swapped.entries[0].finish=3;swapped.entries[2].finish=1;swapped.kimarite='差し';observeAnnual(p,swapped);assert.equal(p.race_context.course2.players['4002'].second_sashi,1);
 const bad=structuredClone(history);bad.race_no=3;bad.entries[4].actual_st_status='F';observeAnnual(p,bad);assert.equal(p.race_context.course2.n,2);
 const current={...history,date:'2026-10-21'},s=course2Stats(current,p);assert.equal(s.escape_rate,1);assert.ok(s.smoothed_escape_rate<1&&s.smoothed_escape_rate>.5);assert.equal(s.basis,'枠なり想定');
 const base=annualFeatures(current,p,VENUE_ANNUAL_FEATURES),extended=annualFeatures(current,p,CONTEXT_ANNUAL_FEATURES);assert.deepEqual(extended.map(r=>r.slice(0,17)),base);assert.ok(extended[0][17]>0);assert.ok(extended.slice(1).every(r=>r[17]===0));
 const script='import json,sys;sys.path.insert(0,"tools/site");from course2_escape import aggregate;print(json.dumps(aggregate(json.load(sys.stdin),"2026-10-20")))';
 const output=spawnSync('python',['-B','-c',script],{input:JSON.stringify([history,swapped,bad]),encoding:'utf8'});assert.equal(output.status,0,output.stderr);const python=JSON.parse(output.stdout);assert.equal(python.population.n,2);assert.equal(python.players['4001'].smoothed_escape_rate,s.smoothed_escape_rate);
});
test('直前気象は締切3分前以前の取得だけ使用し、結果時点の風で事前成績を作らない',()=>{
 const race={...history,deadline_at:'2026-10-20T12:00:00+09:00',environment:{kind:'PRERACE_OFFICIAL',fetched_at:'2026-10-20T11:50:00+09:00',wind_speed_mps:5,wind_direction_key:'OFFICIAL_ICON:5'}};
 assert.ok(preraceEnvironment(race));assert.equal(preraceEnvironment({...race,environment:{...race.environment,fetched_at:'2026-10-20T11:58:00+09:00'}}),null);
 assert.equal(preraceEnvironment({...race,environment:{...race.environment,kind:'RESULT_REPORTED'}}),null);
 const p=emptyAnnualProfiles();observeAnnual(p,race);const current={...race,date:'2026-10-21',deadline_at:'2026-10-21T12:00:00+09:00',environment:{...race.environment,fetched_at:'2026-10-21T11:50:00+09:00'}};
 const values=annualFeatures(current,p,CONTEXT_ANNUAL_FEATURES);assert.ok(values.every(r=>r.length===23&&r.every(Number.isFinite)));assert.ok(values[0][19]>0);
});
