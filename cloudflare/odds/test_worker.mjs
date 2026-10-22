import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OddsCoordinator,validateTargets,opportunityRows} from './worker.mjs';
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
test('HTTPエラー・過大な応答・対象外の応答を拒否する',async()=>{
  await assert.rejects(fetchText('https://www.boatrace.jp/',async()=>new Response('x',{status:503})),/HTTP/);
  await assert.rejects(fetchText('https://www.boatrace.jp/',async()=>new Response('123456'),5),/大きすぎ/);
});
test('中断後の再実行でも5分未満は再取得せず、失敗時は前回値と取得時刻を保持する',async t=>{
  t.mock.timers.enable({apis:['Date'],now});
  const storage=new Storage(),coordinator=new OddsCoordinator({storage},{TARGETS_URL:'https://site.test/targets'});
  await storage.put('work',{date:target.date,started_ms:now,keys:['06-1'],cursor:0,running:true});
  await storage.put('target:06-1',target);
  const previous={...target,attempted_at:new Date(now-60000).toISOString(),fetched_at:new Date(now-59000).toISOString(),status:'OK',items:[{combo:'1-2-3',odds:10}]};
  await storage.put('race:06-1',previous);
  let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;return new Response('fail',{status:503});});
  await coordinator.alarm();assert.equal(requests,0);assert.deepEqual(await storage.get('race:06-1'),previous);
  t.mock.timers.tick(300000);
  await storage.put('work',{date:target.date,started_ms:now+300000,keys:['06-1'],cursor:0,running:true});
  await coordinator.alarm();const failed=await storage.get('race:06-1');
  assert.equal(requests,1);assert.equal(failed.status,'FAILED');assert.equal(failed.fetched_at,previous.fetched_at);assert.deepEqual(failed.items,previous.items);
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
