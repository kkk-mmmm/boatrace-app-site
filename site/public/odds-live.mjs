export const ODDS_INTERVAL_MS = 5 * 60 * 1000;
export const ODDS_MAX_AGE_MS = 10 * 60 * 1000;
export const oddsKey = race => `${race.venue_code}-${race.race_no}`;
export const predictionKey = (race, snapshot) => race.items?.length
  ? `${race.model_id || snapshot.model?.id}:${race.prediction_saved_at}` : null;

export function rankExpectedValue(probabilities, quotes) {
  const prices = new Map(quotes.map(x => [x.combo, x.odds]));
  return probabilities.filter(x => prices.has(x.combo)).map(x => ({...x, odds:prices.get(x.combo),
    value:x.probability * prices.get(x.combo)})).sort((a,b) => b.value-a.value || a.rank-b.rank);
}

export function validQuotes(items) {
  return Array.isArray(items) && items.length <= 120 && new Set(items.map(x => x.combo)).size === items.length
    && items.every(x => /^[1-6]-[1-6]-[1-6]$/.test(x.combo) && new Set(x.combo.split('-')).size === 3
      && Number.isFinite(x.odds) && x.odds >= 1);
}

export function validateLiveOdds(data, date) {
  if (data?.schema_version !== 1 || data.date !== date || data.interval_seconds !== 300 || !Array.isArray(data.races)
    || data.races.length > 288 || new Set(data.races.map(oddsKey)).size !== data.races.length
    || data.races.some(r => r.date !== date || !/^(0[1-9]|1\d|2[0-4])$/.test(r.venue_code)
      || !Number.isInteger(r.race_no) || r.race_no < 1 || r.race_no > 12
      || !['OK','FAILED','UNAVAILABLE','CLOSED'].includes(r.status) || !validQuotes(r.items)
      || !Number.isFinite(Date.parse(r.attempted_at)))) throw Error('オッズAPIの対象・形式が一致しません');
  return data;
}

export function applyLiveOdds(snapshot, data, now=Date.now()) {
  if (snapshot.date !== data.date) return snapshot;
  const records = new Map(data.races.map(r => [oddsKey(r),r]));
  return {...snapshot,races:snapshot.races.map(race => {
    const quote=records.get(oddsKey(race));
    if (!quote) return race;
    const source=new URL('https://www.boatrace.jp/owpc/pc/race/odds3t');
    source.search=new URLSearchParams({hd:race.date.replaceAll('-',''),jcd:race.venue_code,rno:String(race.race_no)});
    const fetched=Date.parse(quote.fetched_at),attempted=Date.parse(quote.attempted_at);
    const valid=data.update?.status!=='FAILED' && quote.status==='OK' && quote.items.length>0 && Number.isFinite(fetched)
      && fetched<=now+60000 && fetched>=attempted && fetched<Date.parse(race.deadline_at)
      && quote.deadline_at===race.deadline_at && quote.source_url===source.href;
    const existing=Date.parse(race.odds?.fetched_at);
    if (valid && Number.isFinite(existing) && existing>fetched) return race;
    const odds=valid ? {items:quote.items,source_url:quote.source_url,fetched_at:quote.fetched_at,
      recorded_at:quote.fetched_at,classification:'PRERACE_ODDS_LOCAL_RECORD_UNVERIFIED'} : race.odds;
    const ranked=rankExpectedValue(race.probabilities || [],odds?.items || []);
    return {...race,odds,odds_update:{status:valid?'OK':quote.status==='OK'?'FAILED':quote.status,
      attempted_at:quote.attempted_at,message:quote.message || (valid?null:'オッズの最新取得を確認できません')},
      expected_value_items:ranked.slice(0,10),opportunity:ranked[0] || null};
  })};
}

export function liveOpportunities(data, now=Date.now()) {
  return (data.opportunities || []).filter(x => x.date===data.date && Date.parse(x.deadline_at)>now
    && Number.isFinite(x.value) && x.value>1 && Number.isFinite(x.probability) && x.probability>0
    && Number.isFinite(x.odds) && x.odds>=1 && Math.abs(x.value-x.probability*x.odds)<1e-8
    && ['OK','PARTIAL'].includes(x.update_status)
    && [x.fetched_at,x.recorded_at,x.last_success_at].every(t=>Number.isFinite(Date.parse(t))
      && Date.parse(t)<=now+60000 && now-Date.parse(t)<=ODDS_MAX_AGE_MS))
    .sort((a,b)=>b.value-a.value || a.deadline_at.localeCompare(b.deadline_at)).slice(0,6);
}
