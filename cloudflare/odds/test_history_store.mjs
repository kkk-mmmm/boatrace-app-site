import {test} from 'node:test';import assert from 'node:assert/strict';
import Worker,{OddsCoordinator} from './worker.mjs';import {saveHistoryRecord,historyRecords,rolloverHistory} from './history-store.mjs';
class Memory{data=new Map();async get(k){return this.data.get(k);}async put(k,v){this.data.set(k,structuredClone(v));}async delete(k){this.data.delete(k);}async list({prefix=''}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)));}}
test('日替わりで現在データだけを除き、予想を上書きせず30日保持する',async()=>{
 const s=new Memory(),r={date:'2030-01-07',venue_code:'24',race_no:1,original:true};
 await saveHistoryRecord(s,'proposal',r);await saveHistoryRecord(s,'proposal',{...r,original:false});
 await saveHistoryRecord(s,'result',{...r,date:'2029-12-01'});await s.put('program:24-1',r);await rolloverHistory(s,'2030-01-08');
 const records=await historyRecords(s,'2029-12-10','2030-01-08');assert.equal(records.length,1);assert.equal(records[0].record.original,true);assert.equal(await s.get('program:24-1'),undefined);
 assert.equal((await s.list({prefix:'history:'})).size,1);
});
test('公開検証APIはGETだけ・7日以内・最大50件で、閲覧による公式取得はしない',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2030-01-08T01:00:00Z')});
 t.mock.method(globalThis,'fetch',()=>{throw Error('No network expected');});
 const coordinator=new OddsCoordinator({storage:new Memory()},{}),env={SITE_ORIGIN:'https://funeyomi.win',ODDS:{idFromName:()=>'',get:()=>({fetch:url=>coordinator.fetch(new Request(url))})}};
 const response=await Worker.fetch(new Request('https://api.test/v1/verification'),env);assert.equal(response.status,200);assert.equal((await response.json()).days.length,7);
 for(const query of ['?date=2029-12-31','?date=2030-01-09','?limit=51','?offset=-1','?extra=1','?date=2030-01-08&date=2030-01-08'])assert.equal((await Worker.fetch(new Request('https://api.test/v1/verification'+query),env)).status,400,query);
 assert.equal((await Worker.fetch(new Request('https://api.test/v1/verification',{method:'POST'}),env)).status,405);
 assert.equal((await Worker.fetch(new Request('https://api.test/v1/verification',{headers:{Origin:'https://bad.test'}}),env)).status,403);
});
