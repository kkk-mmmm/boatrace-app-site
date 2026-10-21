export const MAX_ODDS_AGE_MS = 10 * 60000;
export const japanDate = now => new Date(now + 9 * 3600000).toISOString().slice(0, 10);
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function raceStatus(race, snapshot, now = Date.now()) {
  if (race.date !== japanDate(now)) return {code: 'ARCHIVE', text: '過去の記録', currentOdds: false};
  const deadline = Date.parse(race.deadline_at);
  if (!Number.isFinite(deadline)) return {code: 'INVALID', text: '締切未確認', currentOdds: false};
  if (now >= deadline) return {code: 'CLOSED', text: '締切済み', currentOdds: false};
  if (!race.items?.length) return {code: 'UNAVAILABLE', text: '予想データ未取得', currentOdds: false};
  if (!race.odds) return {code: 'NO_ODDS', text: 'オッズ未取得', currentOdds: false};
  const fetched = Date.parse(race.odds.fetched_at);
  const recorded = Date.parse(race.odds.recorded_at);
  if (!Number.isFinite(fetched) || !Number.isFinite(recorded) || fetched > now + 60000 || recorded > now + 60000) {
    return {code: 'INVALID', text: 'オッズ時刻を確認できません', currentOdds: false};
  }
  if (race.odds.classification !== 'PRERACE_ODDS_LOCAL_RECORD_UNVERIFIED') return {code: 'REFERENCE', text: '参考オッズ', currentOdds: false};
  if (!['OK', 'PARTIAL'].includes(snapshot.update.status) || race.issue) return {code: 'FAILED', text: '更新を確認できません', currentOdds: false};
  if (now - fetched > MAX_ODDS_AGE_MS || now - recorded > MAX_ODDS_AGE_MS) return {code: 'STALE', text: 'オッズの更新待ち', currentOdds: false};
  return {code: 'OPEN', text: '締切前・取得時点オッズ', currentOdds: true};
}

export function safeSource(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'www.boatrace.jp' ? url.href : null; }
  catch { return null; }
}

export function venueTags(venue,date,now=Date.now()) {
  const held=date===japanDate(now)?venue.meeting_status:'UNKNOWN';
  const meeting=held==='OPEN'?venue.meeting || {}:{};
  return {held,grade:meeting.grade || null,day:meeting.meeting_day || null,
    final:meeting.day_label==='最終日',schedule:meeting.schedule_type || null};
}
export function filterVenues(venues,filters,date,now=Date.now()) {
  return venues.filter(venue=>{
    const tags=venueTags(venue,date,now);
    return (!filters.held || tags.held===filters.held)
      && ['grade','schedule'].every(key=>!filters[key] || (tags.held==='OPEN' && (filters[key]==='UNKNOWN'?tags[key]===null:tags[key]===filters[key])))
      && (!filters.day || (tags.held==='OPEN' && (filters.day==='FINAL'?tags.final:filters.day==='UNKNOWN'?tags.day===null:tags.day===Number(filters.day))));
  });
}
export function venueFilterGroups(venues,date,now=Date.now()) {
  const tags=venues.map(v=>venueTags(v,date,now)).filter(t=>t.held==='OPEN');
  const options=(key,order)=>[...new Set(tags.map(t=>t[key]).filter(Boolean))].sort((a,b)=>order.indexOf(a)-order.indexOf(b)).map(value=>({value,label:value}));
  const grades=options('grade',['SG','PG1','G1','G2','G3','一般']);
  const days=[...new Set(tags.map(t=>t.day).filter(Boolean))].sort((a,b)=>a-b).map(n=>({value:String(n),label:n===1?'初日':`${n}日目`}));
  if(tags.some(t=>t.final))days.push({value:'FINAL',label:'最終日'});
  const times=options('schedule',['モーニング','デイ','サマータイム','ナイター','ミッドナイト']);
  for(const [key,list] of [['grade',grades],['day',days],['schedule',times]])if(tags.some(t=>t[key]===null))list.push({value:'UNKNOWN',label:'未確認'});
  return [{key:'held',label:'開催',options:[{value:'OPEN',label:'本日開催'},{value:'NO_MEETING',label:'非開催'},{value:'UNKNOWN',label:'開催未確認'}]},
    {key:'grade',label:'グレード',options:grades},{key:'day',label:'開催日',options:days},{key:'schedule',label:'時間帯',options:times}];
}
