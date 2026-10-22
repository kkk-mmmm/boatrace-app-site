import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ODDS_INTERVAL_MS,rankExpectedValue,validateLiveOdds,applyLiveOdds} from './public/odds-live.mjs';
import {raceStatus} from './public/view.mjs';
import {build} from './build.mjs';

const now=Date.parse('2030-01-01T01:00:00Z'),date='2030-01-01';
const race={date,venue_code:'06',race_no:1,deadline_at:'2030-01-01T02:00:00Z',items:[{rank:1,combo:'1-2-3',probability:.2}],
  probabilities:[{rank:1,combo:'1-2-3',probability:.2},{rank:11,combo:'6-5-4',probability:.01}],odds:null};
const quote={date,venue_code:'06',race_no:1,deadline_at:race.deadline_at,status:'OK',attempted_at:new Date(now-1000).toISOString(),fetched_at:new Date(now).toISOString(),
  source_url:'https://www.boatrace.jp/owpc/pc/race/odds3t?hd=20300101&jcd=06&rno=1',items:[{combo:'1-2-3',odds:2},{combo:'6-5-4',odds:200}]};
const data={schema_version:1,date,interval_seconds:300,update:{status:'COMPLETE'},races:[quote],opportunities:[]};
test('新オッズで確率上位10点の外から期待値1位へ入り、表示元の予想を変更しない',()=>{
  assert.equal(ODDS_INTERVAL_MS,300000);assert.equal(rankExpectedValue(race.probabilities,quote.items)[0].combo,'6-5-4');
  const snapshot={date,update:{status:'OK'},races:[race]},before=JSON.stringify(snapshot);
  const applied=applyLiveOdds(snapshot,validateLiveOdds(data,date),now);
  assert.equal(applied.races[0].expected_value_items[0].combo,'6-5-4');assert.equal(applied.races[0].opportunity.value,2);
  assert.equal(raceStatus(applied.races[0],applied,now).currentOdds,true);assert.equal(JSON.stringify(snapshot),before);
  assert.equal(raceStatus(applied.races[0],applied,now+600001).currentOdds,false);
});
test('APIの失敗・別日・別場・古い応答・締切の不一致を最新として扱わない',()=>{
  assert.throws(()=>validateLiveOdds({...data,date:'2029-12-31'},date));
  assert.throws(()=>validateLiveOdds({...data,races:[{...quote,venue_code:'25'}]},date));
  assert.throws(()=>validateLiveOdds({...data,races:[quote,quote]},date));
  const snapshot={date,update:{status:'OK'},races:[race]};
  for(const d of [{...data,update:{status:'FAILED'}},{...data,races:[{...quote,status:'FAILED'}]},{...data,races:[{...quote,deadline_at:'2030-01-01T03:00:00Z'}]}]) {
    const applied=applyLiveOdds(snapshot,d,now);assert.equal(raceStatus(applied.races[0],applied,now).currentOdds,false);
  }
  const applied=applyLiveOdds(snapshot,data,now);
  const newer={...applied,races:[{...applied.races[0],odds:{...applied.races[0].odds,fetched_at:new Date(now+1000).toISOString()}}]};
  assert.equal(applyLiveOdds(newer,data,now).races[0].odds.fetched_at,newer.races[0].odds.fetched_at);
});
test('接続先未設定では外部通信を有効にせず、設定時はそのオリジンだけをCSPへ追加する',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boatrace-odds-build-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const opts={cacheDirectory:path.join(dir,'cache'),outputDirectory:path.join(dir,'dist'),now};
  build(opts);const read=name=>fs.readFileSync(path.join(opts.outputDirectory,name),'utf8');
  assert.equal(JSON.parse(read('data/odds-config.json')).api_url,null);
  assert.equal(JSON.parse(read('data/odds-targets.json')).races.length,0);
  build({...opts,oddsApiUrl:'https://odds.example.test/v1/odds'});
  assert.ok(read('index.html').includes("connect-src 'self' https://odds.example.test"));
  assert.equal(JSON.parse(read('data/odds-config.json')).interval_seconds,300);
  assert.throws(()=>build({...opts,oddsApiUrl:'http://odds.example.test/v1/odds'}),/HTTPS/);
});
