import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {save, verify} from '../tools/prerace/save_venue_prediction.mjs';
import {appendOdds, digest, validateSourceTarget, validateOdds} from '../app/odds.mjs';
import {root, japanDate} from './data.mjs';
import {venueFor, raceId, venueDirectory} from '../tools/prerace/venues.mjs';
import {saveForecast} from '../tools/prediction/forecast.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const requireValue = (ok, message) => { if (!ok) throw Error(message); };
const html = fs.readFileSync(path.join(root, 'tools/prerace/model/original_artifact.html'));

function sourceEvidence(source, expectedUrl) {
  requireValue(source?.url === expectedUrl, '取得資料のURLが一致しません');
  const bytes = fs.readFileSync(source.evidence_file);
  requireValue(digest(bytes) === source.sha256, '取得資料の指紋が違います');
  return bytes.toString('utf8');
}

export function update(incomingFile, cacheDirectory) {
  const incoming = read(incomingFile);
  const now = Date.now();
  const venue = venueFor(incoming.venue_code);
  requireValue(incoming.date === japanDate(now) && incoming.venue_code === venue.code, '当日の対象場データではありません');
  requireValue(Number.isFinite(Date.parse(incoming.attempted_at)) && Date.parse(incoming.attempted_at) <= now + 60000
    && now - Date.parse(incoming.attempted_at) < 10 * 60000, '自動取得の試行時刻が不正・古すぎます');
  const directory = venueDirectory(cacheDirectory, incoming.date, venue.code);
  fs.mkdirSync(directory, {recursive: true});
  const stateFile = path.join(directory, 'state.json');
  const previous = fs.existsSync(stateFile) ? read(stateFile) : null;
  requireValue(!previous || previous.date === incoming.date && previous.venue_code === venue.code, '保存先と対象場が一致しません');
  const state = previous || {date: incoming.date, venue_code: venue.code, meeting_status: 'UNKNOWN', races: []};
  state.update = {status: 'FAILED', attempted_at: incoming.attempted_at,
    last_success_at: previous?.update.last_success_at || null, message: incoming.error || null};
  if (!incoming.error) {
    const indexUrl = `https://www.boatrace.jp/owpc/pc/race/index?hd=${incoming.date.replaceAll('-', '')}`;
    sourceEvidence(incoming.index_source, indexUrl);
    requireValue(['OPEN', 'NO_MEETING'].includes(incoming.meeting_status), '開催状態が不正です');
    state.meeting_status = incoming.meeting_status;
    const meetingFields = ['grade','day_label','meeting_day','schedule_type','title','meeting_id','series_start'];
    state.meeting = Object.fromEntries(meetingFields.map(key=>[key,incoming.meeting?.[key] ?? null]));
    state.meeting.fetched_at = incoming.index_source.retrieved_at;
    if (incoming.meeting_status === 'NO_MEETING') state.races = [];
    const seen = new Set();
    for (const item of incoming.races) {
      requireValue(Number.isInteger(item.race_no) && item.race_no >= 1 && item.race_no <= 12 && !seen.has(item.race_no), 'レース番号が不正・重複しています');
      seen.add(item.race_no);
      const race = {race_no: item.race_no, deadline_at: item.deadline_at, has_prediction: false,
        issue: item.issue || null};
      const oldRace = state.races.find(r => r.race_no === item.race_no);
      if (oldRace?.entries) {race.entries = oldRace.entries;race.entries_fetched_at = oldRace.entries_fetched_at;race.entries_source_url = oldRace.entries_source_url;}
      if (oldRace?.market_odds) race.market_odds = oldRace.market_odds;
      if (oldRace?.v2_version) race.v2_version = oldRace.v2_version;
      for (const key of ['context','exhibition_fetched_at','exhibition_issue']) if(oldRace?.[key]!=null)race[key]=oldRace[key];
      const predictionRoot = path.join(directory, 'predictions');
      const predictionDirectory = path.join(predictionRoot, raceId(venue.code, incoming.date, item.race_no));
      try {
        const exists = fs.existsSync(predictionDirectory);
        if (exists) {
          verify(predictionDirectory);
          race.has_prediction = true;
          requireValue(read(path.join(predictionDirectory, 'prediction.json')).deadline_at === item.deadline_at,
            '公式締切が予想保存時から変更されています');
        } else if (item.input) {
          requireValue(now < Date.parse(item.deadline_at), '締切を過ぎているため予想を作成できません');
        }
        if (item.input) {
          requireValue(item.input.date === incoming.date && item.input.race_no === item.race_no
            && (item.input.venue_code || '01') === venue.code
            && item.input.deadline_at === item.deadline_at && item.input.odds == null, '取得入力の対象が一致しません');
          validateSourceTarget(item.input.input_source_url, incoming.date, item.race_no, venue.code);
          sourceEvidence(item.input_source, item.input.input_source_url);
          requireValue(Date.parse(item.input_source.retrieved_at) === Date.parse(item.input.input_fetched_at), '入力の取得時刻が一致しません');
          requireValue(Array.isArray(item.input.entries) && item.input.entries.length === 6
            && new Set(item.input.entries.map(e => e.lane)).size === 6
            && item.input.entries.every(e => Number.isInteger(e.lane) && e.lane >= 1 && e.lane <= 6), '出走表の艇番が不正です');
          requireValue(Date.parse(item.input.input_fetched_at) <= now && now - Date.parse(item.input.input_fetched_at) < 10 * 60000,
            '出走表の取得時刻が不正・古すぎます');
          if (item.exhibition_source) {
            const url = new URL(item.input.input_source_url);url.pathname='/owpc/pc/race/beforeinfo';
            sourceEvidence(item.exhibition_source,url.href);
            requireValue(Date.parse(item.exhibition_source.retrieved_at)<=now,'展示の取得時刻が未来です');
          }
          const fields = ['lane','racer_id','name','class','national_win_rate','local_win_rate','motor_2rate','boat_2rate','avg_st','exhibition_time','exhibition_st','exhibition_course','exhibition_st_status','qualification_pressure'];
          race.entries = item.input.entries.map(e => Object.fromEntries(fields.map(k => [k, e[k] ?? null])));
          race.entries_fetched_at = item.input.input_fetched_at;
          race.entries_source_url = item.input.input_source_url;
          race.context = item.input.context || null;
          race.exhibition_fetched_at = item.exhibition_source?.retrieved_at || null;
          race.exhibition_issue = item.exhibition_issue || null;
        }
        if (!exists && item.input) {
          try {
            save({...item.input, venue_code:venue.code}, predictionRoot, html);
            race.has_prediction = true;
          } catch (error) {race.issue = error.message;}
        }
        if (item.input && race.has_prediction && now < Date.parse(item.deadline_at)) {
          try {
            const candidate=saveForecast({...item.input,venue_code:venue.code},path.join(directory,'predictions-v2'),html,{exhibitionSource:item.exhibition_source});
            if(candidate)race.v2_version=candidate.version;
          }catch(error){race.model_issue=error.message;}
        }
        if (item.odds) {
          validateOdds(item.odds);
          validateSourceTarget(item.odds.source_url, incoming.date, item.race_no, venue.code);
          const evidence = sourceEvidence(item.odds_source, item.odds.source_url);
          requireValue(Date.parse(item.odds_source.retrieved_at) === Date.parse(item.odds.fetched_at), 'オッズの取得時刻が一致しません');
          requireValue(Date.parse(item.odds.fetched_at) <= now && now - Date.parse(item.odds.fetched_at) < 10 * 60000, 'オッズの取得時刻が不正・古すぎます');
          race.market_odds = {odds:item.odds,source:item.odds_source,recorded_at:new Date().toISOString(),
            classification:Date.now() < Date.parse(item.deadline_at) ? 'PRERACE_ODDS_LOCAL_RECORD_UNVERIFIED' : 'REFERENCE_ONLY'};
          if (race.has_prediction) appendOdds({predictionDirectory, outputDirectory: path.join(directory, 'odds', `R${item.race_no}`),
            odds: item.odds, evidence, resultsViewed: false});
        }
      } catch (error) {
        race.issue = error.message;
      }
      state.races = state.races.filter(r => r.race_no !== item.race_no);
      state.races.push(race);
    }
    const failed = state.races.some(r => r.issue && Date.parse(r.deadline_at) > now && !String(r.issue).includes('未提供'));
    state.update.status = failed ? 'PARTIAL' : 'OK';
    const confirmedAt = incoming.meeting_status === 'NO_MEETING' ? incoming.index_source.retrieved_at
      : incoming.completed_at || new Date(now).toISOString();
    requireValue(Number.isFinite(Date.parse(confirmedAt)) && Date.parse(confirmedAt) <= now + 60000, '公式取得の完了時刻が不正です');
    state.update.last_success_at = confirmedAt;
    state.update.message = failed ? '一部レースの取得に失敗しています。各レースの状態を確認してください。' : null;
  }
  state.races.sort((a, b) => a.race_no - b.race_no);
  const temp = stateFile + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', {flag: 'wx'});
  fs.renameSync(temp, stateFile);
  return state;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const state = update(process.argv[2] || path.join(root, 'site/cache/incoming.json'), process.argv[3] || path.join(root, 'site/cache'));
    console.log(JSON.stringify({date: state.date, update: state.update, meeting_status: state.meeting_status, races: state.races.length}));
    if (state.update.status === 'FAILED') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
