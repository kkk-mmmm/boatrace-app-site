// Enrich history without changing the approved probability features or weights.
import {emptyAnnualProfiles,observeAnnual} from '../../site/public/annual-model.mjs';
export function buildHistoryProfiles(races,{from,through}) {
 const end=Date.parse(through),start=Date.parse(from);
 if(!Number.isFinite(end)||!Number.isFinite(start)||end-start!==364*86400000)throw Error('直近365日の期間が必要です');
 const profiles=emptyAnnualProfiles(),recent=new Map([30,90].map(days=>[days,emptyAnnualProfiles()])),keys=new Set();
 for(const race of races){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(race.date)||race.date<from||race.date>through)throw Error('当日・未来または集計期間外の履歴です');
  const key=`${race.date}/${race.venue_code}/${race.race_no}`;
  if(keys.has(key))throw Error('履歴レースが重複しています');keys.add(key);observeAnnual(profiles,race);
  for(const [days,part] of recent)if(Date.parse(race.date)>=end-(days-1)*86400000)observeAnnual(part,race);
 }
 for(const [days,part] of recent)for(const [id,player] of Object.entries(part.players))for(const [key,stats] of Object.entries(player))
  if(key==='all'||/^[lc][1-6]$/.test(key))profiles.players[id][`r${days}${key}`]=stats.slice(0,9);
 profiles.windows={through,recent_days:[30,90]};return profiles;
}
