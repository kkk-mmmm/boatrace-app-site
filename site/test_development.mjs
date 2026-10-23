import {test} from 'node:test';import assert from 'node:assert/strict';
import {developmentScenarios,developmentPaths,renderDevelopment} from './public/development.mjs';
function example(masses=[.45,.2,.199999,.1,.03,.020001]){
 const probabilities=[];for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)if(new Set([a,b,c]).size===3)probabilities.push({combo:`${a}-${b}-${c}`,probability:masses[a-1]/20});
 return {probabilities,entries:Array.from({length:6},(_,i)=>({lane:i+1,name:'選手'+i,avg_st:.15,exhibition_time:6.7+i*.03,exhibition_st:.1+i*.02,annual_lane:{win_rate:.2,mean_st:.16,mean_start_rank:3,kimarite:{'逃げ':2,'差し':4,'まくり':3,'まくり差し':1}}}))};
}
test('全120通りから1着確率を集計し、他艇は20%以上だけを採用、各ケースで最高確率の買い目を1点選ぶ',()=>{
 const race=example(),before=JSON.stringify(race),cases=developmentScenarios(race);assert.deepEqual(cases.map(s=>s.lane),[1,2]);assert.equal(JSON.stringify(race),before);
 assert.ok(Math.abs(cases[1].probability-.2)<1e-12);assert.equal(cases[0].style,'逃げ');assert.equal(cases[1].style,'差し');assert.equal(cases[1].combo,'2-1-3');
 race.probabilities.find(r=>r.combo==='2-6-5').probability+=.01;race.probabilities.find(r=>r.combo==='2-1-3').probability-=.01;
 assert.equal(developmentScenarios(race)[1].combo,'2-6-5');assert.equal(before,JSON.stringify(example()));
 assert.deepEqual(developmentScenarios({...race,probabilities:race.probabilities.slice(0,10)}),[]);
 assert.deepEqual(developmentScenarios({...race,entries:race.entries.slice(0,5)}),[]);
 assert.deepEqual(developmentScenarios(example([0,.2,.2,.2,.2,.2])).map(s=>s.lane),[2,3,4,5,6]);
});
test('6艇の経路は入力に再現可能に依存し、描画の着順はケースの買い目と一致、欠損でNaNを描かない',()=>{
 const race=example(),s=developmentScenarios(race)[1],paths=developmentPaths(s);assert.equal(paths.length,6);assert.deepEqual(paths,developmentPaths(s));
 assert.deepEqual(paths.sort((a,b)=>a.finish-b.finish).slice(0,3).map(p=>p.lane),s.combo.split('-').map(Number));
 for(const field of ['win_rate','mean_st','mean_start_rank']){const changed=example();changed.entries[3].annual_lane[field]=field==='win_rate'?.8:field==='mean_st'?.3:5;assert.notDeepEqual(developmentPaths(developmentScenarios(changed)[1]),developmentPaths(s));}
 for(const field of ['exhibition_time','exhibition_st']){const changed=example();changed.entries[3][field]=field==='exhibition_time'?7.2:.3;assert.notDeepEqual(developmentPaths(developmentScenarios(changed)[1]),developmentPaths(s));}
 const missing=example();missing.entries=missing.entries.map(e=>({lane:e.lane,name:e.name}));const text=renderDevelopment(missing,2);assert.match(text,/未取得/);assert.match(text,/決まり手未判定/);assert.doesNotMatch(text,/NaN|undefined/);
 for(const style of ['差し','まくり','まくり差し']){const c={...s,style};assert.ok(developmentPaths(c).every(p=>!p.path.includes('NaN')));}
 assert.notDeepEqual(developmentPaths({...s,style:'差し'}),developmentPaths({...s,style:'まくり'}));
});
test('外部入力をエスケープし、不完全な分布は展開を作らない',()=>{
 const race=example();race.entries[0].name='<img src=x onerror=alert(1)>';assert.doesNotMatch(renderDevelopment(race),/<img/);assert.match(renderDevelopment(race),/&lt;img/);
 assert.match(renderDevelopment({...race,probabilities:[]}),/確認できてから/);
});

test('展示の予定・未提供・失敗と進入変更・欠場を区別して表示する',async()=>{
 const {raceEntryAlerts,raceStatus}=await import('./public/view.mjs'),now=Date.parse('2030-01-01T00:00:00Z'),race=example();race.date='2030-01-01';race.deadline_at=new Date(now+1800000).toISOString();
 assert.equal(raceEntryAlerts(race,now).state,'SCHEDULED');race.entries.forEach((e,i)=>e.exhibition_course=i+1);
 assert.equal(raceEntryAlerts(race,now).courseStatus,'UNCHANGED');
 [race.entries[1].exhibition_course,race.entries[2].exhibition_course]=[3,2];assert.equal(raceEntryAlerts(race,now).courseStatus,'CHANGED');
 race.entries[0].participation_status='WITHDRAWN';assert.equal(raceEntryAlerts(race,now).absent.length,1);assert.equal(raceStatus(race,{update:{status:'OK'}},now).currentOdds,false);
 race.entries[1].exhibition_st=null;race.exhibition_fetched_at=new Date(now).toISOString();assert.equal(raceEntryAlerts(race,now+1500000).state,'PARTIAL');
 race.exhibition_issue='HTTP 503';assert.equal(raceEntryAlerts(race,now+1500000).state,'FAILED');
});
test('展示ST補正は過去に照合できた平均差だけを描画へ反映する',()=>{
 const race=example(),before=developmentPaths(developmentScenarios(race)[1]);race.history={lanes:[{lane:4,exhibition_st_gap:{n:10,mean:.08}}]};
 assert.notDeepEqual(developmentPaths(developmentScenarios(race)[1]),before);assert.match(renderDevelopment(race),/\+0.080秒/);
});
