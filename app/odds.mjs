import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {verify} from '../tools/prerace/save_venue_prediction.mjs';
import {instant} from '../tools/prerace/save_selected.mjs';
import {validateSourceTarget} from '../tools/prerace/venues.mjs';
export {validateSourceTarget};

export const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
export function requireValue(ok, message) { if (!ok) throw Error(message); }

export function validateOdds(odds) {
  requireValue(odds && new URL(odds.source_url).protocol === 'https:', 'オッズの出典にはHTTPSのURLが必要です');
  instant(odds.fetched_at);
  requireValue(Array.isArray(odds.items) && odds.items.length > 0, 'オッズが空です');
  requireValue(new Set(odds.items.map(x => x.combo)).size === odds.items.length, '買い目が重複しています');
  for (const item of odds.items) {
    requireValue(/^[1-6]-[1-6]-[1-6]$/.test(item.combo) && new Set(item.combo.split('-')).size === 3
      && typeof item.odds === 'number' && Number.isFinite(item.odds) && item.odds >= 1, '買い目またはオッズ倍率が不正です');
  }
}

export function appendOdds({predictionDirectory, outputDirectory, odds, evidence, resultsViewed}) {
  requireValue(typeof resultsViewed === 'boolean', '結果を参照したか確認してください');
  validateOdds(odds);
  requireValue(typeof evidence === 'string' && evidence.trim().length > 0, 'オッズの取得資料が必要です');
  verify(predictionDirectory);
  const predictionBytes = fs.readFileSync(path.join(predictionDirectory, 'prediction.json'));
  const prediction = JSON.parse(predictionBytes);
  validateSourceTarget(odds.source_url, prediction.input.date, prediction.input.races[0].race_no, prediction.venue_code || '01');
  const recordedAt = new Date().toISOString();
  requireValue(instant(recordedAt) >= instant(prediction.saved_at), '時計が予想保存時刻より前です。記録を点検してください');
  requireValue(instant(odds.fetched_at) <= instant(recordedAt), 'オッズの取得時刻が未来です');
  const beforeDeadline = instant(recordedAt) < instant(prediction.deadline_at)
    && instant(odds.fetched_at) < instant(prediction.deadline_at);
  const id = crypto.randomUUID();
  const evidenceFile = `${id}.txt`;
  const entry = {
    schema_version: 1, id, race_id: prediction.race_id,
    prediction_sha256: digest(predictionBytes), recorded_at: recordedAt,
    odds: {source_url: odds.source_url, fetched_at: odds.fetched_at,
      items: odds.items.map(x => ({combo: x.combo, odds: x.odds}))},
    evidence_file: evidenceFile, evidence_sha256: digest(evidence),
    result_not_seen_self_report: !resultsViewed,
    classification: beforeDeadline && !resultsViewed ? 'PRERACE_ODDS_LOCAL_RECORD_UNVERIFIED' : 'REFERENCE_ONLY',
    reference_reason: resultsViewed ? '結果参照済み・未確認' : !beforeDeadline ? '締切後の記録' : null,
    estimates: odds.items.map(x => ({combo: x.combo, probability_times_odds:
      prediction.items.find(p => p.combo === x.combo).probability * x.odds})),
  };
  fs.mkdirSync(outputDirectory, {recursive: true});
  fs.writeFileSync(path.join(outputDirectory, evidenceFile), evidence, {flag: 'wx'});
  const bytes = JSON.stringify(entry, null, 2) + '\n';
  fs.writeFileSync(path.join(outputDirectory, `${id}.json`), bytes, {flag: 'wx'});
  fs.writeFileSync(path.join(outputDirectory, `${id}.sha256`), digest(bytes) + '\n', {flag: 'wx'});
  return entry;
}

export function readOdds(directory, predictionDirectory) {
  if (!fs.existsSync(directory)) return [];
  verify(predictionDirectory);
  const predictionHash = digest(fs.readFileSync(path.join(predictionDirectory, 'prediction.json')));
  const prediction = readJSON(path.join(predictionDirectory, 'prediction.json'));
  return fs.readdirSync(directory).filter(x => /^[a-f0-9-]+\.json$/.test(x)).map(file => {
    const bytes = fs.readFileSync(path.join(directory, file));
    requireValue(digest(bytes) === fs.readFileSync(path.join(directory, file.replace(/\.json$/, '.sha256')), 'utf8').trim(),
      'オッズの記録が変更・中断されています');
    const entry = JSON.parse(bytes);
    requireValue(entry.prediction_sha256 === predictionHash, 'オッズに対応する予想が変更されています');
    requireValue(/^[a-f0-9-]+\.txt$/.test(entry.evidence_file)
      && digest(fs.readFileSync(path.join(directory, entry.evidence_file))) === entry.evidence_sha256,
    'オッズの取得資料が変更されています');
    validateOdds(entry.odds);
    validateSourceTarget(entry.odds.source_url, prediction.input.date, prediction.input.races[0].race_no, prediction.venue_code || '01');
    return entry;
  }).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at) || a.id.localeCompare(b.id));
}
