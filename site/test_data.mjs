import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {liveData, archiveData} from './data.mjs';
import {build} from './build.mjs';
import {raceStatus, safeSource, venueTags, filterVenues, venueFilterGroups} from './public/view.mjs';

test('取得済みの過去予想15件を公開用の限定した項目へ変換する', () => {
  const archive = archiveData();
  assert.equal(archive.kind, 'ARCHIVE');
  assert.equal(archive.days.reduce((n, day) => n + day.races.length, 0), 15);
  assert.ok(archive.days.every(day => day.races.every(r => r.items.length === 10)));
  assert.equal(JSON.stringify(archive).includes('request_file'), false);
  assert.equal(JSON.stringify(archive).includes('receipt_sha256'), false);
});

test('現在の取得記録がない場合は過去のデータで最新欄を埋めず、公開ビルドを拒否する', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boatrace-site-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const now = Date.parse('2030-01-01T00:00:00Z');
  const data = liveData(dir, now);
  assert.equal(data.date, '2030-01-01');
  assert.equal(data.update.status, 'UNAVAILABLE');
  assert.deepEqual(data.races, []);
  assert.throws(() => build({cacheDirectory: dir, outputDirectory: path.join(dir, 'dist'), now, requireCurrent: true}), /最新の公式取得/);
  assert.equal(fs.existsSync(path.join(dir, 'dist')), false);
});

test('締切・過去の日付・更新失敗・古いオッズを最新として扱わない', () => {
  const now = Date.parse('2030-01-01T02:00:00Z');
  const race = {date: '2030-01-01', items: [{combo: '1-2-3', probability: .1}],
    deadline_at: '2030-01-01T03:00:00Z', odds: {fetched_at: new Date(now - 60000).toISOString(),
      recorded_at: new Date(now - 50000).toISOString(), classification: 'PRERACE_ODDS_LOCAL_RECORD_UNVERIFIED'}};
  const data = {update: {status: 'OK'}};
  assert.equal(raceStatus(race, data, now).currentOdds, true);
  assert.equal(raceStatus(race, data, now + 3600000).code, 'CLOSED');
  assert.equal(raceStatus({...race,items:[]}, data, now + 3600000).code, 'CLOSED');
  assert.equal(raceStatus({...race, date: '2029-12-31'}, data, now).code, 'ARCHIVE');
  assert.equal(raceStatus(race, {update: {status: 'FAILED'}}, now).currentOdds, false);
  assert.equal(raceStatus({...race, odds: {...race.odds, fetched_at: '2030-01-01T01:00:00Z'}}, data, now).code, 'STALE');
  assert.equal(raceStatus({...race, odds: null}, data, now).code, 'NO_ODDS');
  assert.equal(raceStatus({...race, odds: {...race.odds, fetched_at: '2030-01-02T00:00:00Z'}}, data, now).code, 'INVALID');
  assert.equal(raceStatus({...race, odds: {...race.odds, classification: 'REFERENCE_ONLY'}}, data, now).currentOdds, false);
});

test('公開画面の出典リンクは公式HTTPSのみ許可する', () => {
  assert.equal(safeSource('javascript:alert(1)'), null);
  assert.equal(safeSource('https://example.test/private'), null);
  assert.ok(safeSource('https://www.boatrace.jp/owpc/pc/race/racelist?jcd=01'));
});

const tagNow=Date.parse('2030-01-01T01:00:00Z'),tagDate='2030-01-01';
const taggedVenues=[
 {code:'06',meeting_status:'OPEN',meeting:{grade:'G3',meeting_day:2,day_label:'2日目',schedule_type:'デイ'}},
 {code:'12',meeting_status:'OPEN',meeting:{grade:'G3',meeting_day:4,day_label:'4日目',schedule_type:'ナイター'}},
 {code:'18',meeting_status:'OPEN',meeting:{grade:'G1',meeting_day:6,day_label:'最終日',schedule_type:'モーニング'}},
 {code:'01',meeting_status:'NO_MEETING',meeting:{grade:'SG',meeting_day:5}},
 {code:'02',meeting_status:'UNKNOWN'}, {code:'03',meeting_status:'OPEN',meeting:{}}
];
test('開催・グレード・日次・時間帯のタグを組み合わせて場を絞り込む',()=>{
 const codes=filters=>filterVenues(taggedVenues,filters,tagDate,tagNow).map(v=>v.code);
 assert.deepEqual(codes({held:'OPEN'}),['06','12','18','03']);
 assert.deepEqual(codes({held:'OPEN',grade:'G3'}),['06','12']);
 assert.deepEqual(codes({grade:'G3',day:'4',schedule:'ナイター'}),['12']);
 assert.deepEqual(codes({day:'FINAL',schedule:'モーニング'}),['18']);
 assert.deepEqual(codes({day:'6'}),['18']);
 assert.deepEqual(codes({grade:'G1',day:'2'}),[]);
 assert.deepEqual(codes({held:'NO_MEETING'}),['01']);
 assert.equal(codes({}).length,6);
});
test('前日の開催情報や非開催の残存グレードを本日のタグとして扱わない',()=>{
 assert.equal(venueTags(taggedVenues[0],'2029-12-31',tagNow).held,'UNKNOWN');
 assert.equal(venueTags(taggedVenues[0],'2029-12-31',tagNow).grade,null);
 assert.equal(venueTags(taggedVenues[3],tagDate,tagNow).grade,null);
 assert.deepEqual(filterVenues(taggedVenues,{held:'OPEN'},'2029-12-31',tagNow),[]);
 assert.deepEqual(filterVenues(taggedVenues,{grade:'UNKNOWN'},tagDate,tagNow).map(v=>v.code),['03']);
});
test('タグの候補は確認できた開催情報から作り、最終日や未確認も区別する',()=>{
 const groups=venueFilterGroups(taggedVenues,tagDate,tagNow);
 assert.deepEqual(groups.find(g=>g.key==='grade').options.map(x=>x.value),['G1','G3','UNKNOWN']);
 assert.ok(groups.find(g=>g.key==='day').options.some(x=>x.value==='FINAL'));
 assert.deepEqual(groups.find(g=>g.key==='schedule').options.map(x=>x.value),['モーニング','デイ','ナイター','UNKNOWN']);
});
