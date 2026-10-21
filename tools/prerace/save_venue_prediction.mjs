import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {prepare, calculate, save as saveKiryu, verify as verifyKiryu} from './save_prediction.mjs';
import {venueFor, raceId, validateSourceTarget} from './venues.mjs';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const must = (ok, message) => {if (!ok) throw Error(message);};

export function prepareVenue(request, html, now = Date.now()) {
  const venue = venueFor(request.venue_code || '01');
  must(request.venue == null || request.venue === venue.name, '場名と場コードが一致しません');
  const record = prepare(request, html, now);
  validateSourceTarget(request.input_source_url, request.date, request.race_no, venue.code);
  if (request.odds) validateSourceTarget(request.odds.source_url, request.date, request.race_no, venue.code);
  if (venue.code === '01') return record;
  // The legacy loader accepts only the Kiryu label. Its fcalc has no venue
  // input or venue coefficients. Reuse that exact calculation, then preserve
  // the real venue in the stored input. Never modify the original HTML.
  record.venue_code = venue.code;
  record.race_id = raceId(venue.code, request.date, request.race_no);
  record.input.venue = venue.name;
  record.model_adaptation = 'venue-neutral-v1';
  return record;
}

export function save(request, root, html) {
  const venue = venueFor(request.venue_code || '01');
  must(request.venue == null || request.venue === venue.name, '場名と場コードが一致しません');
  if ((request.venue_code || '01') === '01') return saveKiryu(request, root, html);
  const record = prepareVenue(request, html);
  const directory = path.join(root, record.race_id);
  fs.mkdirSync(root, {recursive:true});
  fs.mkdirSync(directory);
  record.saved_at = new Date().toISOString();
  must(Date.parse(record.saved_at) < Date.parse(record.deadline_at), '処理中に締切を過ぎました');
  const bytes = JSON.stringify(record, null, 2) + '\n';
  fs.writeFileSync(path.join(directory, 'prediction.json'), bytes, {flag:'wx'});
  fs.writeFileSync(path.join(directory, 'original_artifact.html'), html, {flag:'wx'});
  const completed_at = new Date().toISOString();
  must(Date.parse(completed_at) < Date.parse(record.deadline_at), '保存完了時に締切を過ぎました');
  fs.writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify({completed_at, files:{
    'prediction.json':digest(bytes), 'original_artifact.html':digest(html),
  }}, null, 2) + '\n', {flag:'wx'});
  return directory;
}

export function verify(directory) {
  const record = read(path.join(directory, 'prediction.json'));
  if (!record.venue_code || record.venue_code === '01') return verifyKiryu(directory);
  const venue = venueFor(record.venue_code);
  const receipt = read(path.join(directory, 'receipt.json'));
  for (const file of ['prediction.json', 'original_artifact.html']) {
    must(digest(fs.readFileSync(path.join(directory, file))) === receipt.files[file], `${file}が保存時から変更されています`);
  }
  const race = record.input.races[0];
  must(record.model_adaptation === 'venue-neutral-v1' && record.input.venue === venue.name
    && record.input.races.length === 1 && record.race_id === raceId(venue.code, record.input.date, race.race_no),
  '予想の場・レース番号が一致しません');
  validateSourceTarget(record.input_source_url,record.input.date,race.race_no,venue.code);
  must(Date.parse(record.input_fetched_at) <= Date.parse(record.saved_at)
    && Date.parse(record.saved_at) <= Date.parse(receipt.completed_at)
    && Date.parse(receipt.completed_at) < Date.parse(record.deadline_at), '保存時刻不正');
  const html = fs.readFileSync(path.join(directory, 'original_artifact.html'));
  must(record.code_sha256 === digest(html), '元モデルの指紋が一致しません');
  const all = calculate({...record.input, venue:'桐生'}, html).all;
  must(JSON.stringify(all.map((x,i) => ({rank:i+1,combo:x.k,probability:x.p}))) === JSON.stringify(record.items), '確率の再現不一致');
  return record.race_id;
}
