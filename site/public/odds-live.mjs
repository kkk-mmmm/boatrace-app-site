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

export function validProgram(p,date,now=Date.now()) {
  return p && p.date===date && /^(0[1-9]|1\d|2[0-4])$/.test(p.venue_code) && Number.isInteger(p.race_no) && p.race_no>=1 && p.race_no<=12
    && Number.isFinite(Date.parse(p.deadline_at)) && new Date(Date.parse(p.deadline_at)+9*3600000).toISOString().slice(0,10)===date
    && Array.isArray(p.entries) && p.entries.length===6 && new Set(p.entries.map(e=>e.lane)).size===6
    && p.entries.every(e=>Number.isInteger(e.lane)&&e.lane>=1&&e.lane<=6&&/^\d{4}$/.test(e.racer_id)&&typeof e.name==='string')
    && Number.isFinite(Date.parse(p.entries_fetched_at)) && Date.parse(p.entries_fetched_at)<=now+60000
    && (!p.probabilities?.length || validDistribution(p.probabilities)
      && /^annual-v3-[a-f0-9]{64}$/.test(p.model_id||'') && p.prediction_key===`${p.model_id}:${p.prediction_saved_at}`
      && Date.parse(p.input_fetched_at)<=Date.parse(p.prediction_saved_at) && Date.parse(p.prediction_saved_at)<=now+60000
      && Date.parse(p.prediction_saved_at)<Date.parse(p.deadline_at)-PROPOSAL_LEAD_MS);
}
export function applyLivePrograms(snapshot,data,now=Date.now()) {
  const programs=(data.programs||[]).filter(p=>p.venue_code===snapshot.venue_code&&validProgram(p,data.date,now));
  const calendar=data.calendar?.date===data.date?data.calendar.venues?.find(v=>v.code===snapshot.venue_code):null;
  if(!programs.length && !calendar)return snapshot;
  const races=new Map((snapshot.date===data.date?snapshot.races:[]).map(r=>[r.race_no,r]));
  for(const p of programs){
    const old=races.get(p.race_no)||{date:p.date,venue_code:p.venue_code,venue:snapshot.venue,race_no:p.race_no,items:[],probabilities:[],odds:null};
    const next={...old,...p,venue:snapshot.venue,source_kind:'CLOUDFLARE_SCHEDULED_PROGRAM'};
    // The saved proposal is immutable. Entries may be checked later independently.
    if(!p.probabilities?.length){for(const k of ['items','probabilities','scores','model_id','model_name','model_status','model_validation','prediction_saved_at','input_fetched_at'])next[k]=old[k];}
    next.items=next.items||[];races.set(p.race_no,next);
  }
  const healthy=data.update?.status!=='FAILED'&&Number.isFinite(Date.parse(data.served_at))&&now-Date.parse(data.served_at)<=ODDS_MAX_AGE_MS&&Date.parse(data.served_at)<=now+60000;
  const waiting=(calendar?.meeting_status||snapshot.meeting_status)==='OPEN'&&!races.size;
  return {...snapshot,date:data.date,source_kind:'CLOUDFLARE_SCHEDULED_PROGRAM',meeting_status:calendar?.meeting_status||snapshot.meeting_status,
    meeting:calendar?.meeting||snapshot.meeting,races:[...races.values()].sort((a,b)=>a.race_no-b.race_no),
    update:{status:healthy?(waiting?'PARTIAL':'OK'):'FAILED',reason:healthy&&waiting?'INITIAL_COLLECTION_PENDING':null,attempted_at:data.served_at,last_success_at:healthy?data.served_at:snapshot.update?.last_success_at,
      message:healthy?(waiting?'本日の出走表・予想は取得待ちです。初回取得は朝7時以降です。':null):'Cloudflareの配信状態を確認できません',source_kind:'CLOUDFLARE_DELIVERY'}};
}

export function validateLiveOdds(data, date, now=Date.now()) {
  if (data?.schema_version !== 1 || data.date !== date || ![60,300].includes(data.interval_seconds) || !Array.isArray(data.races)
    || data.races.length > 288 || new Set(data.races.map(oddsKey)).size !== data.races.length
    || data.races.some(r => r.date !== date || !/^(0[1-9]|1\d|2[0-4])$/.test(r.venue_code)
      || !Number.isInteger(r.race_no) || r.race_no < 1 || r.race_no > 12
      || !['OK','FAILED','UNAVAILABLE','CLOSED'].includes(r.status) || !validQuotes(r.items)
      || !Number.isFinite(Date.parse(r.attempted_at)))) throw Error('オッズAPIの対象・形式が一致しません');
  if (data.proposals && (!Array.isArray(data.proposals) || data.proposals.length>288 || new Set(data.proposals.map(oddsKey)).size!==data.proposals.length || data.proposals.some(p=>!validProposal(p,date)))) throw Error('保存提案の形式・時刻が不正です');
  if(data.programs && (!Array.isArray(data.programs)||data.programs.length>288||new Set(data.programs.map(oddsKey)).size!==data.programs.length||data.programs.some(p=>!validProgram(p,date,now))))throw Error('出走表・履歴予想の形式または時刻が不正です');
  if(data.calendar && (data.calendar.date!==date||!Array.isArray(data.calendar.venues)||data.calendar.venues.length!==24||new Set(data.calendar.venues.map(v=>v.code)).size!==24||data.calendar.venues.some(v=>!/^(0[1-9]|1\d|2[0-4])$/.test(v.code)||!['OPEN','NO_MEETING','UNKNOWN'].includes(v.meeting_status))))throw Error('開催一覧の形式が不正です');
  return data;
}

export function applyLiveOdds(snapshot, data, now=Date.now()) {
  snapshot=applyLivePrograms(snapshot,data,now);
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
  return (data.opportunities || []).filter(x => x.date===data.date && Date.parse(x.deadline_at)>now && Date.parse(x.deadline_at)<=now+3600000
    && Number.isFinite(x.value) && x.value>1 && Number.isFinite(x.probability) && x.probability>0
    && Number.isFinite(x.odds) && x.odds>=1 && Math.abs(x.value-x.probability*x.odds)<1e-8
    && ['OK','PARTIAL'].includes(x.update_status)
    && [x.fetched_at,x.recorded_at,x.last_success_at].every(t=>Number.isFinite(Date.parse(t))
      && Date.parse(t)<=now+60000 && now-Date.parse(t)<=ODDS_MAX_AGE_MS))
    .sort((a,b)=>b.value-a.value || a.deadline_at.localeCompare(b.deadline_at)).slice(0,6);
}
