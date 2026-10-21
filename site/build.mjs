import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {allLiveData, archiveData, root, modelHash, japanDate, liveData} from './data.mjs';
import {venues} from '../tools/prerace/venues.mjs';
import {opportunityList} from './opportunities.mjs';

export function build({cacheDirectory = path.join(root, 'site/cache'), outputDirectory = path.join(root, 'site/dist'),
  now = Date.now(), requireCurrent = false, snapshotDirectory = null} = {}) {
  const snapshots = snapshotDirectory ? venues.map(venue => {
    const file = path.join(snapshotDirectory,`${venue.code}.json`);
    if (!fs.existsSync(file)) return liveData(path.join(snapshotDirectory,'missing'),now,venue.code);
    const data = JSON.parse(fs.readFileSync(file,'utf8'));
    if (data.schema_version !== 1 || data.date !== japanDate(now) || data.venue_code !== venue.code || data.venue !== venue.name
      || data.model?.id !== modelHash || !['OK','PARTIAL','FAILED','UNAVAILABLE'].includes(data.update?.status)
      || !['OPEN','NO_MEETING','UNKNOWN'].includes(data.meeting_status) || !Array.isArray(data.races)
      || data.races.some(r => r.venue_code !== venue.code || r.date !== data.date || !Number.isInteger(r.race_no) || r.race_no < 1 || r.race_no > 12)
      || new Set(data.races.map(r => r.race_no)).size !== data.races.length) throw Error('表示データの場・日付・モデルが一致しません: '+venue.code);
    return data;
  }) : allLiveData(cacheDirectory, now);
  const fresh = current => ['OK','PARTIAL'].includes(current.update.status) && ['OPEN','NO_MEETING'].includes(current.meeting_status)
    && Number.isFinite(Date.parse(current.update.last_success_at)) && now - Date.parse(current.update.last_success_at) <= 10 * 60000
    && Date.parse(current.update.last_success_at) <= now + 60000;
  if (requireCurrent && !snapshots.some(fresh)) {
    throw Error('最新の公式取得が確認できないため、公開用ビルドを停止しました');
  }
  const current = {...snapshots[0], opportunities:opportunityList(snapshots,now),venues:snapshots.map(s => ({code:s.venue_code,name:s.venue,
    meeting_status:s.meeting_status,meeting:s.meeting,update:s.update,race_count:s.races.length, data_url:`./data/venues/${s.venue_code}.json`}))};
  fs.mkdirSync(path.join(outputDirectory, 'data/venues'), {recursive: true});
  for (const file of ['index.html', 'style.css', 'app.mjs', 'view.mjs']) {
    fs.copyFileSync(path.join(root, 'site/public', file), path.join(outputDirectory, file));
  }
  fs.writeFileSync(path.join(outputDirectory, '.nojekyll'), '');
  fs.writeFileSync(path.join(outputDirectory, 'data/current.json'), JSON.stringify(current, null, 2) + '\n');
  for (const snapshot of snapshots) {
    fs.writeFileSync(path.join(outputDirectory, `data/venues/${snapshot.venue_code}.json`), JSON.stringify(snapshot, null, 2) + '\n');
  }
  fs.writeFileSync(path.join(outputDirectory, 'data/archive.json'), JSON.stringify(archiveData(), null, 2) + '\n');
  return {date: current.date, status: current.update.status, races: current.races.length, venues:snapshots.length,
    confirmed_venues:snapshots.filter(fresh).length};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const index = process.argv.indexOf('--snapshots');
    if (index >= 0 && !process.argv[index + 1]) throw Error('--snapshotsにはフォルダを指定してください');
    console.log(JSON.stringify(build({requireCurrent: process.argv.includes('--require-current'),snapshotDirectory:index >= 0 ? process.argv[index+1] : null})));
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
