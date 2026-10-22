import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ODDS_INTERVAL_MS,rankExpectedValue,validateLiveOdds,applyLiveOdds,proposalCandidate,validProposal,proposalRace,oddsRefreshInterval} from './public/odds-live.mjs';
import {raceStatus} from './public/view.mjs';
import {build} from './build.mjs';
import {oddsProvider} from './odds-provider.mjs';

const now=Date.parse('2030-01-01T01:00:00Z'),date='2030-01-01';
const race={date,venue_code:'06',race_no:1,deadline_at:'2030-01-01T02:00:00Z',items:[{rank:1,combo:'1-2-3',probability:.2}],
  probabilities:[{rank:1,combo:'1-2-3',probability:.2},{rank:11,combo:'6-5-4',probability:.01}],odds:null};
const quote={date,venue_code:'06',race_no:1,deadline_at:race.deadline_at,status:'OK',attempted_at:new Date(now-1000).toISOString(),fetched_at:new Date(now).toISOString(),
  source_url:'https://www.boatrace.jp/owpc/pc/race/odds3t?hd=20300101&jcd=06&rno=1',items:[{combo:'1-2-3',odds:2},{combo:'6-5-4',odds:200}]};
const data={schema_version:1,date,interval_seconds:300,update:{status:'COMPLETE'},races:[quote],opportunities:[]};
test('新オッズで確率上位10点の外から期待値1位へ入り、表示元の予想を変更しない',()=>{
  assert.equal(ODDS_INTERVAL_MS,60000);assert.equal(rankExpectedValue(race.probabilities,quote.items)[0].combo,'6-5-4');
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
  assert.equal(JSON.parse(read('data/odds-config.json')).interval_seconds,60);
  assert.throws(()=>build({...opts,oddsApiUrl:'http://odds.example.test/v1/odds'}),/HTTPS/);
});
test('リポジトリの接続設定を読み、環境変数を優先し、不正なURLを拒否する',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boatrace-provider-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'provider.json');fs.writeFileSync(file,JSON.stringify({api_url:null}));
  assert.equal(oddsProvider({file,environment:{}}),'');
  fs.writeFileSync(file,JSON.stringify({api_url:'https://odds.example.test/v1/odds'}));
  assert.equal(oddsProvider({file,environment:{}}),'https://odds.example.test/v1/odds');
  assert.equal(oddsProvider({file,environment:{BOATRACE_ODDS_API_URL:'https://other.example.test/v1/odds'}}),'https://other.example.test/v1/odds');
  assert.throws(()=>oddsProvider({file,environment:{BOATRACE_ODDS_API_URL:'http://bad.example.test/v1/odds'}}),/HTTPS/);
});

const distribution=[];
for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)if(new Set([a,b,c]).size===3)distribution.push({rank:distribution.length+1,combo:`${a}-${b}-${c}`,probability:1/120});
const proposalTarget={...race,deadline_at:new Date(now+10*60000).toISOString(),probabilities:distribution,
  model_id:'test-model',model_name:'固定式テスト',prediction_saved_at:new Date(now-60000).toISOString(),input_fetched_at:new Date(now-120000).toISOString(),
  prediction_key:`test-model:${new Date(now-60000).toISOString()}`,update_status:'OK',last_success_at:new Date(now).toISOString(),scores:[]};
const proposalQuote={...quote,deadline_at:proposalTarget.deadline_at,prediction_key:proposalTarget.prediction_key};
test('締切30分以内だけ1分、それより先は5分を選び、境界で頻度を切り替える',()=>{
  assert.equal(oddsRefreshInterval({deadline_at:new Date(now+1800001).toISOString()},now),300000);
  assert.equal(oddsRefreshInterval({deadline_at:new Date(now+1800000).toISOString()},now),60000);
});
test('締切3分前以前の確率・予想版・オッズを保存し、後から得た値で当時の提案を作らない',()=>{
  const candidate=proposalCandidate(proposalTarget,proposalQuote,now);assert.ok(candidate);
  // A saved prediction may be older than the odds; keep the latest valid
  // quote instead of treating a delayed static publication as a new model.
  assert.ok(proposalCandidate({...proposalTarget,last_success_at:new Date(now-11*60000).toISOString()},proposalQuote,now));
  const cutoff=Date.parse(candidate.cutoff_at),frozen={...candidate,frozen_at:new Date(cutoff+1000).toISOString()};
  assert.equal(validProposal(frozen,date,cutoff+1000),true);
  assert.equal(validProposal(candidate,date,cutoff+1000),false);
  assert.equal(proposalCandidate(proposalTarget,{...proposalQuote,fetched_at:new Date(cutoff+1).toISOString()},cutoff+1),null);
  for(const change of [{prediction_key:'other'},{status:'FAILED'},{venue_code:'24'}])assert.equal(proposalCandidate(proposalTarget,{...proposalQuote,...change},now),null);
  assert.equal(proposalCandidate({...proposalTarget,input_fetched_at:new Date(cutoff+1).toISOString()},proposalQuote,now),null);
  assert.equal(validProposal({...frozen,odds:{...frozen.odds,fetched_at:new Date(cutoff+1).toISOString()}},date,cutoff+1000),false);
  assert.equal(validProposal({...frozen,probabilities:distribution.slice(0,10)},date,cutoff+1000),false);
  assert.equal(validProposal({...frozen,cutoff_at:new Date(cutoff-1).toISOString()},date,cutoff+1000),false);
});
test('締切後・API失敗でも保存提案を表示でき、最新予想と混ぜず古い時刻のまま保持する',()=>{
  const candidate=proposalCandidate(proposalTarget,proposalQuote,now),later=Date.parse(proposalTarget.deadline_at)+3600000;
  const frozen={...candidate,frozen_at:candidate.cutoff_at};
  const snapshot={date,update:{status:'FAILED'},races:[{...proposalTarget,items:race.items,probabilities:[{combo:'6-5-4',probability:.9}],odds:null}]};
  const applied=applyLiveOdds(snapshot,{...data,races:[],proposals:[frozen],update:{status:'FAILED'}},later);
  const displayed=proposalRace(applied.races[0],later);
  assert.equal(displayed.items.length,10);assert.deepEqual(displayed.probabilities,distribution);assert.deepEqual(displayed.odds,frozen.odds);
  assert.equal(displayed.prediction_saved_at,frozen.prediction_saved_at);
  assert.equal(raceStatus(displayed,applied,later).currentOdds,false);
  assert.equal(proposalRace({...snapshot.races[0],proposal_snapshot:{...frozen,venue_code:'24'}},later).odds,null);
  assert.equal(proposalRace({...snapshot.races[0],proposal_snapshot:frozen},Date.parse(frozen.cutoff_at)-1).odds,null);
  assert.throws(()=>validateLiveOdds({...data,proposals:[{...frozen,odds:{...frozen.odds,fetched_at:new Date(later).toISOString()}}]},date));
  assert.deepEqual(snapshot.races[0].probabilities,[{combo:'6-5-4',probability:.9}]);
});
