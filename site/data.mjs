import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verify} from '../tools/prerace/save_venue_prediction.mjs';
import {venues, venueFor, raceId, venueDirectory} from '../tools/prerace/venues.mjs';
import {readOdds, digest, validateOdds, validateSourceTarget} from '../app/odds.mjs';
import {loadModel,publicAnalysis,readForecast} from '../tools/prediction/forecast.mjs';
import {scoreDetails} from '../tools/prediction/score_details.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const japanDate = now => new Date(now + 9 * 3600000).toISOString().slice(0, 10);
export const modelHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'tools/prerace/model/original_artifact.html'))).digest('hex');
const requireValue = (value, message) => { if (!value) throw Error(message); };

export function publicPrediction(directory, date, raceNo, venueCode = '01') {
  const venue = venueFor(venueCode);
  verify(directory);
  const record = read(path.join(directory, 'prediction.json'));
  requireValue(record.race_id === raceId(venueCode, date, raceNo) && record.input.date === date
    && record.input.venue === venue.name && (record.venue_code || '01') === venueCode && record.input.races.length === 1
    && record.input.races[0].race_no === raceNo && record.code_sha256 === modelHash,
  '公開対象の予想と開催日・レース番号・モデルが一致しません');
  requireValue(Date.parse(record.input_fetched_at) <= Date.parse(record.saved_at)
    && Date.parse(record.saved_at) < Date.parse(record.deadline_at), '予想の取得・保存時刻が不正です');
  return {race_no: raceNo, date, venue_code:venueCode, venue:venue.name, deadline_at: record.deadline_at, prediction_saved_at: record.saved_at,
    input_fetched_at: record.input_fetched_at,
    input_source_url: record.input_source_url,
    entries: record.input.races[0].entries.map(e => ({lane: e.lane, name: e.name, class: e.class,
      national_win_rate: e.national_win_rate, local_win_rate: e.local_win_rate,
      motor_2rate: e.motor_2rate, boat_2rate:e.boat_2rate, avg_st: e.avg_st})),
    items: record.items.slice(0, 10).map(x => ({rank: x.rank, combo: x.combo, probability: x.probability})),
    scores:scoreDetails(record.input.races[0].entries),classification: record.classification};
}

export function archiveData() {
  const projectedArchive = path.join(root, 'site/archive.json');
  if (!fs.existsSync(path.join(root, 'verification'))) {
    const archive = read(projectedArchive);
    requireValue(archive.kind === 'ARCHIVE' && Array.isArray(archive.days), '公開用検証データの形式が違います');
    return archive;
  }
  const dates = fs.readdirSync(path.join(root, 'verification')).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort().reverse();
  return {kind: 'ARCHIVE', days: dates.map(date => {
    const report = read(path.join(root, 'verification', date, '照合結果.json'));
    return {date, venue_code:'01', venue:'桐生', selected_races: report.selected_races, evaluated_races: report.evaluated_races,
      no_prediction_races: report.no_prediction_races, summary: report.summary,
      races: report.records.filter(x => x.evaluation).map(x => ({
        ...publicPrediction(path.join(root, 'verification', date, 'prerace_snapshot/saved', `kiryu_${date.replaceAll('-', '')}_R${x.race_no}`), date, x.race_no),
        official_result: {combo: x.official_result.combo, payout_yen_per_100: x.official_result.payout_yen_per_100,
          refund_status: x.official_result.refund_status}, evaluation: x.evaluation,
      }))};
  })};
}

export function liveData(cacheDirectory, now = Date.now(), venueCode = '01') {
  const venue = venueFor(venueCode);
  const date = japanDate(now);
  const data = {schema_version: 1, date, venue: venue.name, venue_code: venue.code, generated_at: new Date(now).toISOString(),
    model: {id: modelHash, name: '固定スコアモデル v1',
      description: '全国勝率・当地勝率・モーター2連率・平均ST・枠番から120通りの確率を算出。全24場で同じ式を使い、場ごとの補正は行いません。学習済みAI・生成AIは使用していません。'},
    update: {status: 'UNAVAILABLE', attempted_at: null, last_success_at: null,
      message: '当日の自動取得データはまだ確認できていません。'},
    meeting_status: 'UNKNOWN', meeting:{grade:null,day_label:null,meeting_day:null,schedule_type:null,title:null}, races: []};
  const directoryRoot = venueDirectory(cacheDirectory, date, venueCode);
  const stateFile = path.join(directoryRoot, 'state.json');
  if (!fs.existsSync(stateFile)) return data;
  const state = read(stateFile);
  requireValue(state.date === date && state.venue_code === venueCode, '更新記録の開催日・会場が不正です');
  requireValue(['OK', 'FAILED', 'PARTIAL'].includes(state.update.status), '更新状態が不正です');
  data.update = state.update;
  data.meeting_status = state.meeting_status;
  if (state.meeting) data.meeting = state.meeting;
  const allItems=new Map();
  for (const race of state.races) {
    requireValue(Number.isInteger(race.race_no) && race.race_no >= 1 && race.race_no <= 12, 'レース番号が不正です');
    const directory = path.join(directoryRoot, 'predictions', raceId(venueCode, date, race.race_no));
    if (!race.has_prediction) {
      const quote = race.market_odds;
      if (quote) {
        validateOdds(quote.odds);
        validateSourceTarget(quote.odds.source_url,date,race.race_no,venueCode);
        requireValue(quote.source.url === quote.odds.source_url && quote.source.retrieved_at === quote.odds.fetched_at
          && digest(fs.readFileSync(quote.source.evidence_file)) === quote.source.sha256,
          'オッズの取得資料が変更されています');
      }
      data.races.push({race_no: race.race_no, date, deadline_at: race.deadline_at || null,
        venue:venue.name, venue_code:venueCode, entries:race.entries || [], entries_fetched_at:race.entries_fetched_at || null,
        input_source_url:race.entries_source_url || null,
        issue: race.issue || '予想の必須データが未取得です', items: [], odds: quote ? {
          source_url:quote.odds.source_url,fetched_at:quote.odds.fetched_at,items:quote.odds.items.map(x=>({combo:x.combo,odds:x.odds})),
          recorded_at:quote.recorded_at,classification:quote.classification} : null});
      continue;
    }
    const prediction = publicPrediction(directory, date, race.race_no, venueCode);
    allItems.set(race.race_no,read(path.join(directory,'prediction.json')).items);
    const oddsRecords = readOdds(path.join(directoryRoot, 'odds', `R${race.race_no}`), directory);
    const latest = oddsRecords.at(-1);
    data.races.push({...prediction, entries:race.entries || prediction.entries,
      entries_fetched_at:race.entries_fetched_at || prediction.input_fetched_at, odds: latest ? {fetched_at: latest.odds.fetched_at, recorded_at: latest.recorded_at,
      source_url: latest.odds.source_url, classification: latest.classification,
      items: latest.odds.items.map(x => ({combo: x.combo, odds: x.odds}))} : null,
    issue: race.issue || null});
  }
  data.races.sort((a, b) => a.race_no - b.race_no);
  const bundle=loadModel();
  if(bundle && bundle.model.trained_through<date) data.v2_model={id:bundle.id,name:bundle.model.name,status:bundle.model.status,
    trained_through:bundle.model.trained_through,validation:bundle.model.validation,learning_policy:bundle.model.learning_policy};
  for(const race of data.races){
    const stateRace=state.races.find(r=>r.race_no===race.race_no);
    race.context=stateRace.context || null;
    race.exhibition_fetched_at=stateRace.exhibition_fetched_at || null;
    race.exhibition_issue=stateRace.exhibition_issue || null;
    race.history=publicAnalysis({...race,venue_code:venueCode},bundle);
    if(stateRace.model_issue)race.model_issue=stateRace.model_issue;
    if(stateRace.v2_version){
      const candidate=readForecast(path.join(directoryRoot,'predictions-v2'),date,venueCode,race.race_no,stateRace.v2_version);
      race.reference_items=race.items;
      race.items=candidate.items.slice(0,10);
      allItems.set(race.race_no,candidate.items);
      race.scores=scoreDetails(candidate.pre_race_input.entries,candidate.features);
      race.prediction_saved_at=candidate.saved_at;
      race.input_fetched_at=candidate.input_fetched_at;
      race.input_source_url=candidate.input_source_url;
      race.model_name=candidate.model_name;race.model_status=candidate.model_status;race.model_id=candidate.model_id;
      race.model_trained_through=candidate.model_trained_through;race.model_validation=candidate.validation;
    }
    if(!race.scores)race.scores=scoreDetails(race.entries);
    const prices=new Map((race.odds?.items || []).map(x=>[x.combo,x.odds]));
    const opportunities=(allItems.get(race.race_no) || []).filter(x=>prices.has(x.combo)).map(x=>({...x,odds:prices.get(x.combo),value:x.probability*prices.get(x.combo)})).sort((a,b)=>b.value-a.value);
    race.expected_value_items=opportunities.slice(0,10).map(({rank,combo,probability})=>({rank,combo,probability}));
    race.opportunity=opportunities[0] || null;
  }
  requireValue(new Set(data.races.map(x => x.race_no)).size === data.races.length, 'レースが重複しています');
  return data;
}

export function allLiveData(cacheDirectory, now = Date.now()) {
  return venues.map(venue => liveData(cacheDirectory, now, venue.code));
}
