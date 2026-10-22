export const ODDS_INTERVAL_MS = 60 * 1000;
export const FAR_ODDS_INTERVAL_MS = 5 * 60 * 1000;
export const oddsRefreshInterval = (race, now=Date.now()) => Date.parse(race.deadline_at)-now<=30*60000 ? ODDS_INTERVAL_MS : FAR_ODDS_INTERVAL_MS;
export const PROPOSAL_LEAD_MS = 3 * 60 * 1000;
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

const validDistribution = rows => Array.isArray(rows) && rows.length === 120
  && validQuotes(rows.map(row=>({...row,odds:1})))
  && rows.every(row=>Number.isInteger(row.rank) && row.rank>=1 && row.rank<=120 && Number.isFinite(row.probability) && row.probability>0 && row.probability<=1)
  && Math.abs(rows.reduce((sum,row)=>sum+row.probability,0)-1)<1e-6;
export function validProposal(proposal, date, now=Date.now(), frozen=true) {
  if (!proposal || proposal.schema_version!==1 || proposal.date!==date
    || !/^(0[1-9]|1\d|2[0-4])$/.test(proposal.venue_code) || !Number.isInteger(proposal.race_no) || proposal.race_no<1 || proposal.race_no>12
    || !validDistribution(proposal.probabilities) || !validQuotes(proposal.odds?.items) || !proposal.odds.items.length
    || typeof proposal.model_id!=='string' || typeof proposal.prediction_saved_at!=='string'
    || proposal.prediction_key!==`${proposal.model_id}:${proposal.prediction_saved_at}`) return false;
  const cutoff=Date.parse(proposal.deadline_at)-PROPOSAL_LEAD_MS, fetched=Date.parse(proposal.odds.fetched_at), recorded=Date.parse(proposal.proposal_saved_at);
  const saved=Date.parse(proposal.prediction_saved_at), input=Date.parse(proposal.input_fetched_at), frozenAt=Date.parse(proposal.frozen_at);
  const expected=new URL('https://www.boatrace.jp/owpc/pc/race/odds3t');
  expected.search=new URLSearchParams({hd:date.replaceAll('-',''),jcd:proposal.venue_code,rno:String(proposal.race_no)});
  return Number.isFinite(cutoff) && new Date(cutoff+9*3600000).toISOString().slice(0,10)===date
    && Date.parse(proposal.cutoff_at)===cutoff && Number.isFinite(fetched) && fetched<=cutoff && cutoff-fetched<=ODDS_MAX_AGE_MS
    && Number.isFinite(recorded) && fetched<=recorded && recorded<=cutoff && recorded<=now+60000
    && Number.isFinite(saved) && saved<=recorded && Number.isFinite(input) && input<=saved
    && proposal.odds.source_url===expected.href
    && (!frozen || Number.isFinite(frozenAt) && frozenAt>=cutoff && frozenAt<=now+60000);
}
export function proposalCandidate(target, quote, now=Date.now()) {
  const cutoff=Date.parse(target.deadline_at)-PROPOSAL_LEAD_MS;
  if (now>cutoff || quote?.status!=='OK' || quote.prediction_key!==target.prediction_key || quote.deadline_at!==target.deadline_at
    || quote.date!==target.date || quote.venue_code!==target.venue_code || quote.race_no!==target.race_no
    || !['OK','PARTIAL'].includes(target.update_status) || target.issue
    || !Number.isFinite(Date.parse(target.last_success_at)) || Date.parse(target.last_success_at)>now+60000) return null;
  const proposal={...target,schema_version:1,cutoff_at:new Date(cutoff).toISOString(),proposal_saved_at:new Date(now).toISOString(),
    odds:{items:quote.items,fetched_at:quote.fetched_at,recorded_at:quote.fetched_at,source_url:quote.source_url,
      classification:'PRERACE_ODDS_LOCAL_RECORD_UNVERIFIED'}};
  return validProposal(proposal,target.date,now,false)?proposal:null;
}
export function proposalRace(race, now=Date.now()) {
  const proposal=race.proposal_snapshot;
  if (!validProposal(proposal,race.date,now) || proposal.deadline_at!==race.deadline_at || proposal.venue_code!==race.venue_code || proposal.race_no!==race.race_no
    || now<Date.parse(proposal.cutoff_at)) return race;
  return {...race,probabilities:proposal.probabilities,items:[...proposal.probabilities].sort((a,b)=>b.probability-a.probability || a.rank-b.rank).slice(0,10),
    odds:proposal.odds,prediction_saved_at:proposal.prediction_saved_at,input_fetched_at:proposal.input_fetched_at,
    model_id:proposal.model_id,model_name:proposal.model_name,model_status:proposal.model_status,model_validation:proposal.model_validation,
    scores:proposal.scores || [],proposal_snapshot:proposal};
}

export function validateLiveOdds(data, date) {
  if (data?.schema_version !== 1 || data.date !== date || ![60,300].includes(data.interval_seconds) || !Array.isArray(data.races)
    || data.races.length > 288 || new Set(data.races.map(oddsKey)).size !== data.races.length
    || data.races.some(r => r.date !== date || !/^(0[1-9]|1\d|2[0-4])$/.test(r.venue_code)
      || !Number.isInteger(r.race_no) || r.race_no < 1 || r.race_no > 12
      || !['OK','FAILED','UNAVAILABLE','CLOSED'].includes(r.status) || !validQuotes(r.items)
      || !Number.isFinite(Date.parse(r.attempted_at)))) throw Error('オッズAPIの対象・形式が一致しません');
  if (data.proposals && (!Array.isArray(data.proposals) || data.proposals.length>288 || new Set(data.proposals.map(oddsKey)).size!==data.proposals.length || data.proposals.some(p=>!validProposal(p,date)))) throw Error('保存提案の形式・時刻が不正です');
  return data;
}

export function applyLiveOdds(snapshot, data, now=Date.now()) {
  if (snapshot.date !== data.date) return snapshot;
  const records = new Map(data.races.map(r => [oddsKey(r),r]));
  const proposals = new Map((data.proposals || []).map(p=>[oddsKey(p),p]));
  return {...snapshot,races:snapshot.races.map(race => {
    const saved=validProposal(race.proposal_snapshot,race.date,now)?race.proposal_snapshot:proposals.get(oddsKey(race));
    const proposal_snapshot=validProposal(saved,race.date,now) && saved.deadline_at===race.deadline_at && saved.venue_code===race.venue_code && saved.race_no===race.race_no?saved:null;
    const attached={...race,proposal_snapshot};
    const quote=records.get(oddsKey(race));
    if (!quote) return attached;
    const source=new URL('https://www.boatrace.jp/owpc/pc/race/odds3t');
    source.search=new URLSearchParams({hd:race.date.replaceAll('-',''),jcd:race.venue_code,rno:String(race.race_no)});
    const fetched=Date.parse(quote.fetched_at),attempted=Date.parse(quote.attempted_at);
    const valid=data.update?.status!=='FAILED' && quote.status==='OK' && quote.items.length>0 && Number.isFinite(fetched)
      && fetched<=now+60000 && fetched>=attempted && fetched<Date.parse(race.deadline_at)
      && quote.deadline_at===race.deadline_at && quote.source_url===source.href;
    const existing=Date.parse(race.odds?.fetched_at);
    if (valid && Number.isFinite(existing) && existing>fetched) return attached;
    const odds=valid ? {items:quote.items,source_url:quote.source_url,fetched_at:quote.fetched_at,
      recorded_at:quote.fetched_at,classification:'PRERACE_ODDS_LOCAL_RECORD_UNVERIFIED'} : race.odds;
    const ranked=rankExpectedValue(race.probabilities || [],odds?.items || []);
    return {...attached,odds,odds_update:{status:valid?'OK':quote.status==='OK'?'FAILED':quote.status,
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
