import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OddsCoordinator,validateTargets,opportunityRows} from './worker.mjs';
import {proposalCandidate} from '../../site/public/odds-live.mjs';
import {robotsAllowed,fetchText} from './official.mjs';

const now=Date.parse('2030-01-01T01:00:00Z');
const target={date:'2030-01-01',venue_code:'06',venue:'浜名湖',race_no:1,deadline_at:'2030-01-01T02:00:00Z',
  probabilities:[],prediction_key:'p',update_status:'OK',last_success_at:new Date(now).toISOString()};
const feed={schema_version:1,date:target.date,generated_at:new Date(now).toISOString(),races:[target]};
class Storage {
  data=new Map();alarm=null;
  async get(key){return Array.isArray(key)?new Map(key.filter(k=>this.data.has(k)).map(k=>[k,structuredClone(this.data.get(k))])):structuredClone(this.data.get(key));}
  async put(key,value){for(const [k,v] of typeof key==='string'?[[key,value]]:Object.entries(key))this.data.set(k,structuredClone(v));}
  async deleteAll(){this.data.clear();}
  async setAlarm(value){this.alarm=value;}
  async deleteAlarm(){this.alarm=null;}
  async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)));}
}
test('対象の別日・別場・重複・壊れた確率を拒否し、締切済みを取得しない',()=>{
  assert.equal(validateTargets(feed,now).length,1);
  assert.throws(()=>validateTargets({...feed,date:'2029-12-31'},now));
  assert.throws(()=>validateTargets({...feed,races:[{...target,venue_code:'25'}]},now));
  assert.throws(()=>validateTargets({...feed,races:[target,target]},now));
  assert.throws(()=>validateTargets({...feed,races:[{...target,probabilities:[{combo:'1-2-3',probability:1,rank:1}]}]},now));
  assert.equal(validateTargets({...feed,races:[{...target,deadline_at:new Date(now-1).toISOString()}]},now).length,0);
});
test('robotsの専用グループ・最長一致・空の禁止・ワイルドカードを守る',()=>{
  const url='https://www.boatrace.jp/owpc/pc/race/odds3t?hd=20300101';
  assert.equal(robotsAllowed('User-agent: *\nDisallow: /owpc',url),false);
  assert.equal(robotsAllowed('User-agent: *\nDisallow: /owpc\nAllow: /owpc/pc/race/odds3t',url),true);
  assert.equal(robotsAllowed('User-agent: *\nAllow: /\nUser-agent: boatrace-app\nDisallow: /',url),false);
  assert.equal(robotsAllowed('User-agent: *\nDisallow: /*odds3t*',url),false);
  assert.equal(robotsAllowed('User-agent: *\nDisallow:',url),true);
  assert.equal(robotsAllowed('<html>error</html>',url),false);
});
test('実行時刻が前回より1ms早くても次の1分枠を開始し、同じ枠の再配信を重ねない',async t=>{
  const first=now+42500,current=first+59999;
  t.mock.timers.enable({apis:['Date'],now:current});
  const storage=new Storage(),coordinator=new OddsCoordinator({storage},{TARGETS_URL:'https://site.test/targets'});
  await storage.put('work',{date:target.date,started_ms:first,scheduled_slot:Math.floor(first/60000),running:false});
  let requests=0;
  t.mock.method(globalThis,'fetch',async url=>{requests++;return new Response(url==='https://site.test/targets'?JSON.stringify(feed):'User-agent: *\nAllow: /');});
  const scheduled=now+60000;
  assert.equal((await (await coordinator.start(scheduled)).json()).status,'UPDATING');
  assert.equal(requests,2);
  const work=await storage.get('work');await storage.put('work',{...work,running:false});
  assert.equal((await (await coordinator.start(scheduled)).json()).status,'NOT_DUE');
  assert.equal((await (await coordinator.start(now)).json()).status,'NOT_DUE');assert.equal(requests,2);
});
test('HTTPエラー・過大な応答・対象外の応答を拒否する',async()=>{
  await assert.rejects(fetchText('https://www.boatrace.jp/',async()=>new Response('x',{status:503})),/HTTP/);
  await assert.rejects(fetchText('https://www.boatrace.jp/',async()=>new Response('123456'),5),/大きすぎ/);
});
test('1分に満たないレースは残り時間を待って取得し、同じ更新の再実行では取得を重ねない',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now});
  const storage=new Storage(),coordinator=new OddsCoordinator({storage},{TARGETS_URL:'https://site.test/targets'});
  await storage.put('work',{date:target.date,started_ms:now,keys:['06-1'],cursor:0,running:true});
  const near={...target,deadline_at:new Date(now+20*60000).toISOString()};
  await storage.put('target:06-1',near);
  const previous={...near,attempted_at:new Date(now-10000).toISOString(),fetched_at:new Date(now-59000).toISOString(),status:'OK',items:[{combo:'1-2-3',odds:10}]};
  await storage.put('race:06-1',previous);
  let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;return new Response('fail',{status:503});});
  const pending=coordinator.alarm();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests,0);assert.deepEqual(await storage.get('race:06-1'),previous);
  t.mock.timers.tick(49999);await new Promise(resolve=>setImmediate(resolve));assert.equal(requests,0);
  t.mock.timers.tick(1);await pending;const failed=await storage.get('race:06-1');
  assert.equal(requests,1);assert.equal(failed.status,'FAILED');assert.equal(failed.fetched_at,previous.fetched_at);assert.deepEqual(failed.items,previous.items);
  assert.equal(Date.parse(failed.attempted_at)-Date.parse(previous.attempted_at),60000);
  await storage.put('work',{date:target.date,started_ms:now,keys:['06-1'],cursor:0,running:true});
  await coordinator.alarm();assert.equal(requests,1);
  assert.equal(storage.alarm,null);
});
test('全場集計は古いオッズ、締切、予想版の不一致をねらい目に入れない',()=>{
  const t={...target,probabilities:[{rank:1,combo:'1-2-3',probability:.2}]};
  const quote={...target,status:'OK',fetched_at:new Date(now).toISOString(),items:[{combo:'1-2-3',odds:10}]};
  assert.equal(opportunityRows([t],new Map([['06-1',quote]]),now)[0].value,2);
  for(const change of [{status:'FAILED'},{fetched_at:new Date(now-600001).toISOString()},{prediction_key:'other'},{deadline_at:new Date(now).toISOString()}])
    assert.equal(opportunityRows([t],new Map([['06-1',{...quote,...change}]]),now).length,0);
});
test('複数場の取得開始は全体で250ms・同じ場で1秒以上空け、失敗を場ごとに記録する',async t=>{
  const storage=new Storage(),coordinator=new OddsCoordinator({storage},{}),clock=Date.now();
  const keys=[],starts=[];
  for(const [venue,race] of [['06',1],['24',1],['06',2],['24',2]]) {
    const key=`${venue}-${race}`;keys.push(key);
    await storage.put('target:'+key,{...target,date:new Date(clock+9*3600000).toISOString().slice(0,10),venue_code:venue,race_no:race,deadline_at:new Date(clock+3600000).toISOString()});
  }
  await storage.put('work',{date:new Date(clock+9*3600000).toISOString().slice(0,10),started_ms:clock,keys,cursor:0,running:true});
  t.mock.method(globalThis,'fetch',async url=>{starts.push({venue:new URL(url).searchParams.get('jcd'),time:Date.now()});return new Response('failed',{status:503});});
  await coordinator.alarm();assert.equal(starts.length,4);
  // Observe at fetch(), after the gate's microtask; allow clock quantisation.
  for(let i=1;i<starts.length;i++)assert.ok(starts[i].time-starts[i-1].time>=240);
  for(const venue of ['06','24']){const times=starts.filter(x=>x.venue===venue);assert.ok(times[1].time-times[0].time>=990);}
  for(const key of keys)assert.equal((await storage.get('race:'+key)).status,'FAILED');
});

test('締切後も3分前以前の保存提案をAPIで返し、確定後は更新で上書きしない',async t=>{
  t.mock.timers.enable({apis:['Date'],now});
  const storage=new Storage(),coordinator=new OddsCoordinator({storage},{}),probabilities=[];
  for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)if(new Set([a,b,c]).size===3)probabilities.push({rank:probabilities.length+1,combo:`${a}-${b}-${c}`,probability:1/120});
  const deadline=now+10*60000,cutoff=deadline-180000;
  const t1={...target,deadline_at:new Date(deadline).toISOString(),probabilities,model_id:'test',prediction_saved_at:new Date(now-1000).toISOString(),input_fetched_at:new Date(now-2000).toISOString()};
  t1.prediction_key=`test:${t1.prediction_saved_at}`;
  const q={...t1,status:'OK',fetched_at:new Date(now).toISOString(),source_url:'https://www.boatrace.jp/owpc/pc/race/odds3t?hd=20300101&jcd=06&rno=1',items:[{combo:'1-2-3',odds:10}]};
  const candidate=proposalCandidate(t1,q,now);assert.ok(candidate);
  await storage.put('proposal-candidate:06-1',candidate);
  await storage.put('work',{date:target.date,keys:[],status:'IDLE'});
  await coordinator.freezeDue(cutoff-1);assert.equal(await storage.get('proposal:06-1'),undefined);
  t.mock.timers.tick(deadline-now+1000);await coordinator.freezeDue(Date.now());
  const frozen=await storage.get('proposal:06-1');assert.ok(frozen);assert.equal(frozen.odds.items[0].odds,10);
  await storage.put('proposal-candidate:06-1',{...candidate,odds:{...candidate.odds,items:[{combo:'1-2-3',odds:999}]}});
  await coordinator.freezeDue(Date.now());assert.deepEqual(await storage.get('proposal:06-1'),frozen);
  const snapshot=await(await coordinator.snapshot(new URL('https://internal/snapshot?date=2030-01-01'))).json();
  assert.equal(snapshot.races.length,0);assert.equal(snapshot.proposals.length,1);assert.equal(snapshot.proposals[0].odds.items[0].odds,10);
  const other=await(await coordinator.snapshot(new URL('https://internal/snapshot?date=2030-01-01&venue=24'))).json();assert.equal(other.proposals.length,0);
});
test('締切が遠いレースは5分待ちの間に取得せず、近いレースの1分更新を塞がない',async t=>{
  t.mock.timers.enable({apis:['Date'],now});
  const storage=new Storage(),coordinator=new OddsCoordinator({storage},{});
  await storage.put('work',{date:target.date,started_ms:now,keys:['06-1'],cursor:0,running:true});await storage.put('target:06-1',target);
  await storage.put('race:06-1',{...target,attempted_at:new Date(now-60000).toISOString(),status:'OK'});
  let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;return new Response('',{status:503});});
  await coordinator.alarm();assert.equal(requests,0);assert.equal((await storage.get('work')).running,false);
});

test('取得対象が同じ配信版なら毎分の全件書き込みを省き、robotsも5分間共有する',async t=>{
  t.mock.timers.enable({apis:['Date'],now});
  const storage=new Storage(),coordinator=new OddsCoordinator({storage},{TARGETS_URL:'https://site.test/targets'});
  let requests=0,targetWrites=0;
  const originalPut=storage.put.bind(storage);
  t.mock.method(storage,'put',async(key,value)=>{if(typeof key==='object' && Object.keys(key).some(k=>k.startsWith('target:')))targetWrites++;return originalPut(key,value);});
  t.mock.method(globalThis,'fetch',async url=>{requests++;return new Response(url==='https://site.test/targets'?JSON.stringify(feed):'User-agent: *\nAllow: /');});
  await coordinator.start(now);const work=await storage.get('work');await storage.put('work',{...work,running:false});
  t.mock.timers.tick(60000);await coordinator.start(now+60000);
  assert.equal(requests,3);assert.equal(targetWrites,1);assert.deepEqual(await storage.get('target:06-1'),target);
});

test('選択した場のAPIでも厳選候補を全場へ配信し、低期待値の高率・低率を落とさず公式へ追加取得しない',async t=>{
 t.mock.timers.enable({apis:['Date'],now});
 t.mock.method(globalThis,'fetch',async()=>{throw Error('閲覧で公式へ取得してはいけません');});
 const storage=new Storage(),coordinator=new OddsCoordinator({storage},{}),keys=[];
 for(const [venue_code,inRate,value] of [['01',.8,.8],['02',.2,.9],['03',.5,2]]){
  const probabilities=[];
  for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)if(new Set([a,b,c]).size===3)probabilities.push({combo:`${a}-${b}-${c}`,probability:a===1?inRate/20:(1-inRate)/100,rank:probabilities.length+1});
  const p={...target,venue_code,probabilities},key=`${venue_code}-1`;keys.push(key);await storage.put('target:'+key,p);
  await storage.put('race:'+key,{...p,status:'OK',attempted_at:new Date(now).toISOString(),fetched_at:new Date(now).toISOString(),items:[{combo:'6-5-4',odds:value/((1-inRate)/100)}]});
 }
 await storage.put('work',{date:target.date,status:'COMPLETE',keys});
 const data=await (await coordinator.snapshot(new URL('https://internal/snapshot?date=2030-01-01&venue=01'))).json();
 assert.deepEqual(data.races.map(r=>r.venue_code),['01']);assert.deepEqual(data.featured_races.map(r=>r.venue_code),['03','02','01']);
 for(const r of data.featured_races)assert.ok(Math.abs(r.scenario_probabilities.in+r.scenario_probabilities.other-1)<1e-6);
 assert.deepEqual(data.opportunities.map(r=>r.venue_code),['03']);
 await storage.put('work',{date:target.date,status:'FAILED',keys});
 assert.deepEqual((await (await coordinator.snapshot(new URL('https://internal/snapshot?date=2030-01-01&venue=01'))).json()).featured_races,[]);
});

test('展示の通信失敗は10分前の完了にせず、次の1分枠で再試行する',async t=>{
 t.mock.timers.enable({apis:['Date'],now});const storage=new Storage(),coordinator=new OddsCoordinator({storage},{});
 await storage.put('robots',{text:'User-agent: *\nAllow: /'});await storage.put('program:06-1',{...target,deadline_at:new Date(now+540000).toISOString(),entries:[{lane:1}],entries_30m_done:true});
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('failure',{status:503});});
 const near={...target,deadline_at:new Date(now+540000).toISOString()};await coordinator.refreshProgram(near,async()=>{});
 assert.equal(calls,1);assert.equal((await storage.get('program:06-1')).exhibition_10m_done,undefined);
 await coordinator.refreshProgram(near,async()=>{});assert.equal(calls,1);
 t.mock.timers.tick(60000);await coordinator.refreshProgram(near,async()=>{});assert.equal(calls,2);
});

test('締切後の結果キューでもオッズを再取得せず、保存予想を変えない',async t=>{
 t.mock.timers.enable({apis:['Date'],now});
 const storage=new Storage(),coordinator=new OddsCoordinator({storage},{PLAYER_MODEL_URL:'https://site.test/model'}),closed={...target,deadline_at:new Date(now-600000).toISOString()};
 await storage.put('work',{date:target.date,running:true,started_ms:now,keys:['06-1'],cursor:0});await storage.put('target:06-1',closed);await storage.put('proposal:06-1',{keep:true});
 let calls=0;t.mock.method(coordinator,'refreshResult',async actual=>{calls++;assert.deepEqual(actual,closed);});t.mock.method(globalThis,'fetch',async()=>{throw Error('結果キューからのオッズ取得は禁止');});
 await coordinator.processBatch();assert.equal(calls,1);assert.deepEqual(await storage.get('proposal:06-1'),{keep:true});assert.equal((await storage.get('work')).status,'COMPLETE');
});

test('選択場やオッズ・予想の有無によらず全場の締切を共有し、閲覧による公式取得を行わない',async t=>{
 t.mock.timers.enable({apis:['Date'],now});const storage=new Storage(),coordinator=new OddsCoordinator({storage},{});
 await storage.put('agenda:06',[target]);await storage.put('agenda:24',[{...target,venue_code:'24',race_no:2}]);await storage.put('agenda:01',[{...target,date:'2029-12-31',venue_code:'01'}]);await storage.put('target:06-1',target);
 t.mock.method(globalThis,'fetch',async()=>{throw Error('一覧の閲覧で公式を取得しない');});
 const data=await (await coordinator.snapshot(new URL('https://internal/snapshot?date=2030-01-01&venue=06&race=1'))).json();
 assert.equal(data.upcoming_races.length,2);assert.deepEqual(data.upcoming_races.map(r=>r.venue_code),['06','24']);assert.equal(data.upcoming_races[1].race_no,2);assert.equal('probabilities' in data.upcoming_races[0],false);
});
