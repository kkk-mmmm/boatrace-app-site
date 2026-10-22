import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {liveData,japanDate} from './data.mjs';
import {venues} from '../tools/prerace/venues.mjs';
import {validateLiveOdds,applyLiveOdds} from './public/odds-live.mjs';

export function cloudflareSnapshots(data,now=Date.now(),previous=[]) {
  validateLiveOdds(data,japanDate(now),now);
  if(!data.calendar || data.update?.status==='FAILED' || !Number.isFinite(Date.parse(data.served_at))
    || now-Date.parse(data.served_at)>120000 || Date.parse(data.served_at)>now+60000)throw Error('Cloudflareの当日開催一覧・配信状態を確認できません');
  return venues.map(v=>applyLiveOdds(previous.find(s=>s.date===data.date&&s.venue_code===v.code)||liveData('/nonexistent-cloudflare-cache',now,v.code),data,now));
}
export async function collectCloudflare(apiUrl,output='site/staging') {
  const url=new URL(apiUrl);
  if(url.protocol!=='https:'||url.pathname!=='/v1/odds'||url.search||url.hash||url.username||url.password)throw Error('データAPIの設定が不正です');
  url.searchParams.set('date',japanDate(Date.now()));
  const r=await fetch(url,{signal:AbortSignal.timeout(30000),cache:'no-store'});
  if(!r.ok)throw Error('Cloudflare API HTTP '+r.status);
  const data=await r.json();validateLiveOdds(data,japanDate(Date.now()));
  // During migration or a partial cold start, preserve genuine same-day saved
  // forecasts from our own Pages cache; this never fetches the official site.
  const previous=[],queue=venues.filter(v=>data.calendar?.venues.find(c=>c.code===v.code)?.meeting_status==='OPEN'
    && (data.programs||[]).filter(p=>p.venue_code===v.code&&p.probabilities?.length===120).length<12);
  await Promise.all(Array.from({length:4},async()=>{while(queue.length){const v=queue.shift();try{
    const old=await fetch(`https://kkk-mmmm.github.io/boatrace-app-site/data/venues/${v.code}.json`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!old.ok)continue;const saved=await old.json();
    if(saved.schema_version===1&&saved.date===data.date&&saved.venue_code===v.code&&saved.venue===v.name&&Array.isArray(saved.races)
      && saved.races.every(p=>p.date===data.date&&p.venue_code===v.code))previous.push(saved);
  }catch{ /* New-day or unavailable cache remains explicitly empty. */ }}}));
  const snapshots=cloudflareSnapshots(data,Date.now(),previous);
  if(snapshots.some(s=>s.meeting_status==='OPEN')&&!snapshots.some(s=>s.races.some(r=>r.probabilities?.length===120)))throw Error('Cloudflare側の予想初期取得を確認できません');
  fs.mkdirSync(output,{recursive:true});
  for(const s of snapshots)fs.writeFileSync(path.join(output,s.venue_code+'.json'),JSON.stringify(s)+'\n');
  console.log(JSON.stringify({date:snapshots[0].date,venues:snapshots.length,races:snapshots.reduce((n,s)=>n+s.races.length,0),source:'CLOUDFLARE_SHARED_CACHE'}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{await collectCloudflare(process.env.BOATRACE_ODDS_API_URL);}catch(e){console.error(e.message);process.exitCode=1;}
}
