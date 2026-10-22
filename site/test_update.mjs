import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {update} from './update.mjs';
import {liveData} from './data.mjs';
import {build} from './build.mjs';
import {digest} from '../app/odds.mjs';
import {venueDirectory} from '../tools/prerace/venues.mjs';
import {writeSnapshot} from './snapshot.mjs';

function fixture(t) {
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2030-01-01T01:00:00Z')});
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'boatrace-update-'));
  t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
  const file = path.join(directory,'incoming.json');
  const raw = path.join(directory,'source.html');
  fs.writeFileSync(raw,'実際のHTTP応答を模したテスト用資料');
  const source = url => ({url,retrieved_at:'2030-01-01T00:59:00Z',evidence_file:raw,sha256:digest(fs.readFileSync(raw))});
  const request = {date:'2030-01-01',race_no:3,deadline_at:'2030-01-01T15:00:00+09:00',input_source_url:'https://www.boatrace.jp/owpc/pc/race/racelist?hd=20300101&jcd=01&rno=3',input_fetched_at:'2030-01-01T00:59:00Z',result_not_seen:true,odds:null,
    entries:Array.from({length:6},(_,i)=>({lane:i+1,name:'テスト',class:'B1',national_win_rate:5,local_win_rate:5,motor_2rate:30,boat_2rate:30,avg_st:.15}))};
  const incoming = {date:request.date,venue_code:'01',attempted_at:'2030-01-01T01:00:00Z',meeting_status:'OPEN',index_source:source('https://www.boatrace.jp/owpc/pc/race/index?hd=20300101'),races:[{race_no:3,deadline_at:request.deadline_at,input:request,input_source:source(request.input_source_url),odds:{source_url:'https://www.boatrace.jp/owpc/pc/race/odds3t?hd=20300101&jcd=01&rno=3',fetched_at:'2030-01-01T00:59:00Z',items:[{combo:'1-2-3',odds:10}]},odds_source:source('https://www.boatrace.jp/owpc/pc/race/odds3t?hd=20300101&jcd=01&rno=3')}]};
  const write = () => fs.writeFileSync(file,JSON.stringify(incoming));
  write();
  return {directory,file,incoming,write};
}

test('自動取得入力を元モデルで保存し、次回更新で元予想を変えずオッズだけ追加する',t=>{
  const f=fixture(t);
  assert.equal(update(f.file,f.directory).update.status,'OK');
  const first=liveData(f.directory);
  assert.equal(first.races[0].items.length,10);
  assert.equal(first.races[0].probabilities.length,120);
  assert.equal(first.races[0].odds.items[0].odds,10);
  const bytes=fs.readFileSync(path.join(f.directory,'2030-01-01/predictions/kiryu_20300101_R3/prediction.json'));
  t.mock.timers.tick(1000);
  f.incoming.races[0].odds.items[0].odds=12;
  f.write(); update(f.file,f.directory);
  assert.equal(liveData(f.directory).races[0].odds.items[0].odds,12);
  assert.deepEqual(fs.readFileSync(path.join(f.directory,'2030-01-01/predictions/kiryu_20300101_R3/prediction.json')),bytes);
  const result=build({cacheDirectory:f.directory,outputDirectory:path.join(f.directory,'dist'),requireCurrent:true});
  assert.equal(result.status,'OK');
  const feed=JSON.parse(fs.readFileSync(path.join(f.directory,'dist/data/odds-targets.json')));
  assert.equal(feed.races.length,1);assert.equal(feed.races[0].probabilities.length,120);
  assert.equal(feed.races[0].probabilities.reduce((sum,x)=>sum+x.probability,0).toFixed(8),'1.00000000');
});

test('全体の取得失敗時は以前の予想と成功時刻を保持して失敗状態を公開する',t=>{
  const f=fixture(t);
  update(f.file,f.directory);
  const success=liveData(f.directory).update.last_success_at;
  f.incoming.error='HTTP 503';f.write();
  const state=update(f.file,f.directory);
  assert.equal(state.update.status,'FAILED');
  assert.equal(state.update.last_success_at,success);
  assert.equal(liveData(f.directory).races.length,1);
  assert.throws(()=>build({cacheDirectory:f.directory,outputDirectory:path.join(f.directory,'dist'),requireCurrent:true}),/最新の公式取得/);
});

test('必須入力欠損を予想に昇格しない',t=>{
  const f=fixture(t);
  f.incoming.races[0].input.entries[0].avg_st=null;
  f.write();
  const state=update(f.file,f.directory);
  assert.equal(state.update.status,'PARTIAL');
  assert.equal(liveData(f.directory).races[0].items.length,0);
});

test('締切後に取得時刻を過去へ戻しても事前予想は作れない',t=>{
  const f=fixture(t);
  t.mock.timers.tick(6*3600000);
  f.incoming.attempted_at=new Date().toISOString();
  f.write();
  const state=update(f.file,f.directory);
  assert.equal(state.races[0].has_prediction,false);
  assert.match(state.races[0].issue,/締切/);
  assert.equal(liveData(f.directory).races[0].items.length,0);
});

function chooseVenue(f, code) {
  f.incoming.venue_code = code;
  const item = f.incoming.races[0];
  item.input.venue_code = code;
  for (const [object, key] of [[item.input,'input_source_url'],[item.input_source,'url'],[item.odds,'source_url'],[item.odds_source,'url']]) {
    object[key] = object[key].replace(/jcd=\d{2}/,`jcd=${code}`);
  }
  f.write();
}

test('同日の同じレース番号を場ごとに分離し、他場の失敗が桐生へ波及しない',t=>{
  const f=fixture(t);
  update(f.file,f.directory);
  chooseVenue(f,'24');
  f.incoming.races[0].odds.items[0].odds=24;f.write();
  assert.equal(update(f.file,f.directory).update.status,'OK');
  assert.equal(liveData(f.directory,Date.now(),'24').venue,'大村');
  assert.equal(liveData(f.directory,Date.now(),'24').races[0].odds.items[0].odds,24);
  assert.equal(liveData(f.directory).races[0].odds.items[0].odds,10);
  f.incoming.error='大村の取得に失敗';f.write();update(f.file,f.directory);
  assert.equal(liveData(f.directory,Date.now(),'24').update.status,'FAILED');
  assert.equal(liveData(f.directory).update.status,'OK');
  const out=path.join(f.directory,'dist');build({cacheDirectory:f.directory,outputDirectory:out,requireCurrent:true});
  const catalog=JSON.parse(fs.readFileSync(path.join(out,'data/current.json')));
  assert.equal(catalog.venues.length,24);
  assert.equal(fs.readdirSync(path.join(out,'data/venues')).length,24);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out,'data/venues/24.json'))).venue_code,'24');
});

test('最新出走表を更新しても保存予想の確率は変更しない',t=>{
  const f=fixture(t);chooseVenue(f,'02');update(f.file,f.directory);
  const saved=path.join(venueDirectory(f.directory,'2030-01-01','02'),'predictions/toda_20300101_R3/prediction.json');
  const bytes=fs.readFileSync(saved);
  t.mock.timers.tick(1000);
  f.incoming.races[0].input.entries[0].national_win_rate=6;
  f.incoming.races[0].input.input_fetched_at=new Date().toISOString();
  f.incoming.races[0].input_source.retrieved_at=new Date().toISOString();
  f.write();update(f.file,f.directory);
  const latest=liveData(f.directory,Date.now(),'02').races[0];
  assert.equal(latest.entries[0].national_win_rate,6);
  assert.equal(latest.entries_fetched_at,new Date().toISOString());
  assert.deepEqual(fs.readFileSync(saved),bytes);
});

test('別の場の出走表URLを拒否し、欠損時も取得した6艇の出走表は表示できる',t=>{
  const f=fixture(t);chooseVenue(f,'02');
  f.incoming.races[0].input.input_source_url=f.incoming.races[0].input.input_source_url.replace('jcd=02','jcd=01');
  f.write();assert.equal(update(f.file,f.directory).races[0].has_prediction,false);
  chooseVenue(f,'02');f.incoming.races[0].input.entries[0].avg_st=null;
  f.write();update(f.file,f.directory);
  const race=liveData(f.directory,Date.now(),'02').races[0];
  assert.equal(race.items.length,0);
  assert.equal(race.entries.length,6);
  assert.equal(race.entries[0].avg_st,null);
  assert.equal(race.odds.items[0].odds,10);
  assert.equal(JSON.stringify(race.odds).includes('evidence_file'),false);
});

test('非開催に変わっても他場の予想・保存記録を消さない',t=>{
  const f=fixture(t);update(f.file,f.directory);chooseVenue(f,'02');update(f.file,f.directory);
  f.incoming.meeting_status='NO_MEETING';f.incoming.races=[];f.write();update(f.file,f.directory);
  assert.equal(liveData(f.directory,Date.now(),'02').races.length,0);
  assert.equal(liveData(f.directory).races.length,1);
  assert.ok(fs.existsSync(path.join(venueDirectory(f.directory,'2030-01-01','02'),'predictions/toda_20300101_R3/receipt.json')));
});

test('場別ジョブの出力を統合し、失敗・未到着・別場の混入を区別する',t=>{
  const f=fixture(t);chooseVenue(f,'24');update(f.file,f.directory);
  const stage=path.join(f.directory,'stage'),out=path.join(f.directory,'output');
  const file=path.join(stage,'24.json');
  writeSnapshot('24',file,{cacheDirectory:f.directory});
  build({snapshotDirectory:stage,outputDirectory:out,requireCurrent:true});
  assert.equal(JSON.parse(fs.readFileSync(path.join(out,'data/venues/01.json'))).update.status,'UNAVAILABLE');
  const snapshot=writeSnapshot('24',file,{cacheDirectory:f.directory,failed:true});
  assert.equal(snapshot.update.status,'FAILED');
  assert.equal(snapshot.races[0].items.length,10);
  assert.throws(()=>build({snapshotDirectory:stage,outputDirectory:out,requireCurrent:true}),/最新の公式取得/);
  snapshot.venue_code='02';fs.writeFileSync(file,JSON.stringify(snapshot));
  assert.throws(()=>build({snapshotDirectory:stage,outputDirectory:out}),/場・日付/);
});

test('非開催の確認時刻はファイル処理時刻へ更新しない',t=>{
  const f=fixture(t);f.incoming.meeting_status='NO_MEETING';f.incoming.races=[];f.write();
  assert.equal(update(f.file,f.directory).update.last_success_at,f.incoming.index_source.retrieved_at);
});

test('展示の更新でv2だけを別版保存し、期待値上位を全120通りから公開する',t=>{
  const f=fixture(t);chooseVenue(f,'06');const item=f.incoming.races[0];
  f.incoming.meeting={grade:'G3',meeting_day:2,day_label:'2日目',schedule_type:'デイ'};
  item.input.context={meeting_day:2,phase:'QUALIFYING'};
  item.input.entries.forEach((e,i)=>Object.assign(e,{racer_id:String(4000+i),exhibition_time:6.7+i*.01,exhibition_st:.1+i*.01,exhibition_course:i+1}));
  item.exhibition_source={...item.input_source,url:item.input_source.url.replace('/racelist?','/beforeinfo?')};f.write();
  const state=update(f.file,f.directory);assert.ok(state.races[0].v2_version);assert.equal(state.races[0].model_issue,undefined);
  const cache=venueDirectory(f.directory,'2030-01-01','06'),legacyFile=path.join(cache,'predictions/hamanako_20300101_R3/prediction.json');
  const legacy=fs.readFileSync(legacyFile),record=JSON.parse(legacy);
  item.odds.items=record.items.map((x,i)=>({combo:x.combo,odds:i===119?1000000:10}));
  item.input.entries[0].exhibition_st=.25;t.mock.timers.tick(1000);f.write();
  const changed=update(f.file,f.directory);assert.notEqual(changed.races[0].v2_version,state.races[0].v2_version);
  assert.deepEqual(fs.readFileSync(legacyFile),legacy);
  const data=liveData(f.directory,Date.now(),'06'),race=data.races[0];
  assert.equal(race.items.length,10);assert.equal(race.expected_value_items.length,10);
  assert.equal(race.expected_value_items[0].combo,record.items.at(-1).combo);
  assert.ok(!race.items.some(x=>x.combo===race.expected_value_items[0].combo));
  assert.equal(race.opportunity.combo,race.expected_value_items[0].combo);assert.equal(race.scores.length,6);
  assert.equal(race.entries[0].exhibition_st,.25);assert.equal(data.meeting.grade,'G3');
  assert.equal(JSON.stringify(data).includes('evidence_file'),false);
});
