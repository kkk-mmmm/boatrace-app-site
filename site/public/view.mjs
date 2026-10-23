export const MAX_ODDS_AGE_MS = 10 * 60000;
export const japanDate = now => new Date(now + 9 * 3600000).toISOString().slice(0, 10);
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function raceStatus(race, snapshot, now = Date.now()) {
  if (race.date !== japanDate(now)) return {code: 'ARCHIVE', text: '過去の記録', currentOdds: false};
  if(race.entries?.some(e=>e.participation_status==='WITHDRAWN'))return {code:'WITHDRAWN',text:'欠場あり・6艇予想は停止',currentOdds:false};
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
  if (race.odds_update && race.odds_update.status!=='OK') return {code:'FAILED',text:'オッズの更新を確認できません',currentOdds:false};
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

// Scenario probabilities always use the original, unconditional distribution.
export const matchesPredictionScenario = (combo, scenario) => scenario === 'in' ? combo.startsWith('1-') : scenario === 'other' ? !combo.startsWith('1-') : true;
export function predictionPool(race) {
  const rows = race.probabilities?.length ? race.probabilities : race.items || [];
  const unique = new Map();
  for (const row of rows) {
    if (!/^[1-6]-[1-6]-[1-6]$/.test(row.combo) || new Set(row.combo.split('-')).size !== 3
      || !Number.isFinite(row.probability) || row.probability < 0 || row.probability > 1) continue;
    if (!unique.has(row.combo)) unique.set(row.combo, {...row});
  }
  return [...unique.values()];
}
export function scenarioProbabilities(rows) {
  const total = rows.reduce((sum, row) => sum + row.probability, 0);
  if (rows.length !== 120 || new Set(rows.map(row => row.combo)).size !== 120 || Math.abs(total - 1) > 1e-6) return null;
  return {in: rows.filter(row => row.combo.startsWith('1-')).reduce((sum, row) => sum + row.probability, 0),
    other: rows.filter(row => !row.combo.startsWith('1-')).reduce((sum, row) => sum + row.probability, 0)};
}
export function predictionRanking(rows, quotes, {scenario = 'all', tab = 'probability', currentOdds = false} = {}) {
  const prices = new Map(quotes.filter(row => Number.isFinite(row.odds) && row.odds > 0).map(row => [row.combo, row.odds]));
  if (tab === 'value' && !currentOdds) return [];
  return rows.filter(row => matchesPredictionScenario(row.combo, scenario))
    .map(row => ({...row, odds: prices.get(row.combo) ?? null, value: currentOdds && prices.has(row.combo) ? row.probability * prices.get(row.combo) : null}))
    .filter(row => tab !== 'value' || row.value !== null)
    .sort((a, b) => (tab === 'value' ? b.value - a.value : b.probability - a.probability) || a.combo.localeCompare(b.combo));
}

// Each selected ticket contributes a relationship; rank the union only once.
export function sujiCandidates(rows, quotes, selectedCombos, {scenario = 'all', currentOdds = false, limit = 10} = {}) {
  const selected = new Set(Array.isArray(selectedCombos) ? selectedCombos : selectedCombos ? [selectedCombos] : []);
  const anchors = predictionPool({probabilities:rows}).filter(row => selected.has(row.combo) && matchesPredictionScenario(row.combo, scenario));
  if (!anchors.length) return [];
  return predictionRanking(predictionPool({probabilities:rows}), quotes, {scenario, tab: 'value', currentOdds})
    .filter(row => !selected.has(row.combo))
    .map(row => {
      const [first, second, third] = row.combo.split('-'), relationships = [];
      for (const anchor of anchors) {
        const [a, b, c] = anchor.combo.split('-');
        if (first !== a) continue;
        const reason = second === c && third === b ? '2・3着入れ替え'
          : second === b ? '2着固定・3着替え' : third === c ? '3着固定・2着替え'
          : third === b ? '2着の相手を3着へ' : second === c ? '3着の相手を2着へ' : null;
        if (reason) relationships.push({combo:anchor.combo, reason});
      }
      return {...row, reason:[...new Set(relationships.map(x=>x.reason))].join(' / '), based_on:relationships.map(x=>x.combo)};
    }).filter(row => row.based_on.length).slice(0, Math.max(0,Math.min(10,limit)));
}

export const FEATURED_IN_HIGH = .7;
export const FEATURED_IN_LOW = .3;
// Classify before limiting so one race can belong to only one group.
export function featuredRaceGroups(candidates, now=Date.now()) {
  const unique=new Map(), groups={value:[],high:[],low:[]};
  for (const row of candidates || []) {
    const mass=row?.scenario_probabilities;
    if (!row || row.date!==japanDate(now) || !/^(0[1-9]|1\d|2[0-4])$/.test(row.venue_code)
      || !Number.isInteger(row.race_no) || row.race_no<1 || row.race_no>12
      || !Number.isFinite(Date.parse(row.deadline_at)) || Date.parse(row.deadline_at)<=now || Date.parse(row.deadline_at)>now+3600000
      || !['OK','PARTIAL'].includes(row.update_status) || row.classification!=='PRERACE_ODDS_LOCAL_RECORD_UNVERIFIED'
      || ![row.fetched_at,row.recorded_at,row.last_success_at].every(t=>Number.isFinite(Date.parse(t)) && Date.parse(t)<=now+60000 && now-Date.parse(t)<=MAX_ODDS_AGE_MS)
      || !mass || ![mass.in,mass.other].every(n=>Number.isFinite(n)&&n>=0&&n<=1) || Math.abs(mass.in+mass.other-1)>1e-6
      || !/^[1-6]-[1-6]-[1-6]$/.test(row.combo) || new Set(row.combo.split('-')).size!==3
      || !Number.isFinite(row.probability) || row.probability<0 || row.probability>1 || !Number.isFinite(row.odds) || row.odds<=0
      || !Number.isFinite(row.value) || Math.abs(row.value-row.probability*row.odds)>1e-6) continue;
    const key=`${row.date}/${row.venue_code}/${row.race_no}`, old=unique.get(key);
    if (!old || Date.parse(row.fetched_at)>Date.parse(old.fetched_at)) unique.set(key,row);
  }
  for (const row of unique.values()) {
    const probability=row.scenario_probabilities.in;
    if(probability>=FEATURED_IN_HIGH-1e-12)groups.high.push(row);
    else if(probability<=FEATURED_IN_LOW+1e-12)groups.low.push(row);
    else if(row.value>1)groups.value.push(row);
  }
  const tie=(a,b)=>a.deadline_at.localeCompare(b.deadline_at)||a.venue_code.localeCompare(b.venue_code)||a.race_no-b.race_no;
  groups.value.sort((a,b)=>b.value-a.value||tie(a,b));
  groups.high.sort((a,b)=>b.scenario_probabilities.in-a.scenario_probabilities.in||b.value-a.value||tie(a,b));
  groups.low.sort((a,b)=>a.scenario_probabilities.in-b.scenario_probabilities.in||b.value-a.value||tie(a,b));
  return Object.fromEntries(Object.entries(groups).map(([key,rows])=>[key,rows.slice(0,3)]));
}

export function raceEntryAlerts(race,now=Date.now()) {
 const entries=race.entries||[],absent=entries.filter(e=>e.participation_status==='WITHDRAWN'),active=entries.filter(e=>e.participation_status!=='WITHDRAWN');
 const known=active.filter(e=>Number.isInteger(e.exhibition_course)&&e.exhibition_course>=1&&e.exhibition_course<=6);
 const unique=new Set(known.map(e=>e.exhibition_course)).size===known.length;
 const changes=unique?known.filter(e=>e.exhibition_course!==e.lane):[];
 const complete=entries.length===6&&active.length>0&&active.every(e=>[e.exhibition_time,e.exhibition_st,e.exhibition_course].every(Number.isFinite));
 const due=Date.parse(race.deadline_at)-600000,left=Date.parse(race.deadline_at)-now;
 const state=complete?'AVAILABLE':race.exhibition_issue?'FAILED':now<due?'SCHEDULED':race.exhibition_fetched_at?'PARTIAL':'WAITING';
 return {absent,changes,courseStatus:changes.length?'CHANGED':unique&&known.length===active.length&&active.length>0?'UNCHANGED':'UNKNOWN',state,due,
  retryAt:left>300000?Date.parse(race.deadline_at)-300000:null};
}
