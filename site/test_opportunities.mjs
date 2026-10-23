import {featuredRaceGroups} from './public/view.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import {opportunityList,featuredRaceList} from './opportunities.mjs';
const now=Date.parse('2030-01-01T01:00:00Z');
const snapshot=(code,value)=>({venue_code:code,venue:code,date:'2030-01-01',update:{status:'OK',last_success_at:new Date(now).toISOString()},
 races:[{date:'2030-01-01',race_no:1,deadline_at:'2030-01-01T02:00:00Z',items:[{combo:'6-5-4',probability:.01}],opportunity:{combo:'6-5-4',probability:.01,odds:value*100,value},
 odds:{classification:'PRERACE_ODDS_LOCAL_RECORD_UNVERIFIED',fetched_at:new Date(now).toISOString(),recorded_at:new Date(now).toISOString()}}]});
test('ねらい目は全場を期待値順に比較し、更新待ち・締切済み・低期待値を除外する',()=>{
 const fresh=snapshot('01',1.5),high=snapshot('24',2.4),low=snapshot('06',.99),stale=snapshot('12',4),closed=snapshot('20',5),failed=snapshot('03',6);
 stale.races[0].odds.fetched_at=new Date(now-11*60000).toISOString();closed.races[0].deadline_at=new Date(now).toISOString();failed.update.status='FAILED';
 const list=opportunityList([fresh,high,low,stale,closed,failed],now);assert.deepEqual(list.map(x=>x.venue_code),['24','01']);assert.equal(list[0].value,2.4);
 fresh.update.last_success_at=new Date(now-11*60000).toISOString();assert.deepEqual(opportunityList([fresh],now),[]);
});

test('締切1時間以内をランキング前に判定し、遠い高期待値で近い候補を押し出さない',()=>{
 const near=snapshot('01',1.1),far=Array.from({length:8},(_,i)=>{const x=snapshot(String(i),100-i);x.races[0].deadline_at=new Date(now+3600001).toISOString();return x;});
 assert.deepEqual(opportunityList([...far,near],now).map(x=>x.venue_code),['01']);
 near.races[0].deadline_at=new Date(now+3600000).toISOString();assert.equal(opportunityList([near],now).length,1);
});

function fullSnapshot(code,value,mass,raceNo=1){
 const s=snapshot(code,value),race=s.races[0];race.race_no=raceNo;
 race.probabilities=[];
 for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)if(new Set([a,b,c]).size===3)race.probabilities.push({combo:`${a}-${b}-${c}`,probability:a===1?mass/20:(1-mass)/100});
 const probability=(1-mass)/100,odds=value/probability;
 race.opportunity={combo:'6-5-4',probability,odds,value};race.odds.items=[{combo:'6-5-4',odds}];return s;
}
test('厳選は高率・低率を先に分類し、低期待値も掲載して分類間と分類内の重複を防ぐ',()=>{
 const snapshots=[fullSnapshot('01',2.5,.5),fullSnapshot('02',.8,.7),fullSnapshot('03',.7,.3),fullSnapshot('04',100,.9),fullSnapshot('05',20,.1)];
 const candidates=featuredRaceList(snapshots,now),groups=featuredRaceGroups(candidates,now);
 assert.equal(candidates.length,5);assert.deepEqual(groups.value.map(r=>r.venue_code),['01']);assert.deepEqual(groups.high.map(r=>r.venue_code),['04','02']);assert.deepEqual(groups.low.map(r=>r.venue_code),['05','03']);
 const all=Object.values(groups).flat(),keys=all.map(r=>`${r.date}/${r.venue_code}/${r.race_no}`);assert.equal(new Set(keys).size,all.length);
 assert.equal(Object.values(featuredRaceGroups([...candidates,...candidates],now)).flat().length,5);
 const old={...candidates.find(r=>r.venue_code==='02'),fetched_at:new Date(now-60000).toISOString(),scenario_probabilities:{in:.5,other:.5}};
 assert.equal(featuredRaceGroups([old,...candidates],now).high.find(r=>r.venue_code==='02').value,.8);
});
test('厳選の確率は全120通りを合計し、不完全・古い・別日・失敗・遠い候補を除外する',()=>{
 const s=fullSnapshot('01',1.5,.8),good=featuredRaceList([s],now)[0];
 assert.ok(Math.abs(good.scenario_probabilities.in-.8)<1e-12);assert.ok(Math.abs(good.scenario_probabilities.other-.2)<1e-12);
 const invalid=[{scenario_probabilities:null},{scenario_probabilities:{in:.8,other:.3}},{scenario_probabilities:{in:NaN,other:.2}},{date:'2029-12-31'},{update_status:'FAILED'},
 {deadline_at:new Date(now).toISOString()},{deadline_at:new Date(now+3600001).toISOString()},{fetched_at:new Date(now-600001).toISOString()},{recorded_at:new Date(now+60001).toISOString()},{value:123}];
 for(const patch of invalid)assert.deepEqual(featuredRaceGroups([{...good,...patch}],now),{value:[],high:[],low:[]});
 s.races[0].probabilities=s.races[0].probabilities.slice(0,10);assert.equal(featuredRaceList([s],now)[0].scenario_probabilities,null);
 assert.deepEqual(featuredRaceGroups(featuredRaceList([s],now),now),{value:[],high:[],low:[]});
 const rows=Array.from({length:9},(_,i)=>({...good,race_no:i+1,scenario_probabilities:{in:.71+i*.01,other:.29-i*.01}}));
 const far=rows.map(r=>({...r,race_no:r.race_no+1,deadline_at:new Date(now+3600001).toISOString(),scenario_probabilities:{in:.99,other:.01}}));
 assert.deepEqual(featuredRaceGroups([...far,...rows],now).high.map(r=>r.race_no),[9,8,7]);
});
