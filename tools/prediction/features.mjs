export const ENGINE_VERSION = 'history-v2.1';
export const FEATURE_NAMES = ['player_st_gain','player_st_stability','day_st_gain','day_st_stability','phase_st_gain','phase_st_stability','pressure_st_gain','pressure_st_stability','exhibition_st_gain','exhibition_st_stability','exhibition_rank_gain','exhibition_rank_stability','start_safety'];
export const PRIOR_SAMPLES = 20;
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const moment = () => ({n:0,mean:0,m2:0,abs:0});
function add(m,value) {if(!numeric(value))return;m.n++;const delta=value-m.mean;m.mean+=delta/m.n;m.m2+=delta*(value-m.mean);m.abs+=Math.abs(value);}
const stats = () => ({st:moment(),st_gap:moment(),rank_gap:moment(),starts:0,flying:0,late:0});
export const emptyProfiles = () => ({cutoff_date:null,population:{},players:{}});
const summary = m => m?.n ? {n:m.n,mean:m.mean,sd:m.n>1?Math.sqrt(Math.max(0,m.m2/(m.n-1))):null,mae:m.abs/m.n,rmse:Math.sqrt(Math.max(0,m.m2/m.n+m.mean*m.mean))} : {n:0,mean:null,sd:null,mae:null,rmse:null};
const shrink = (value,n,prior) => n ? (value*n+prior*PRIOR_SAMPLES)/(n+PRIOR_SAMPLES) : prior;
function contextKeys(race,entry) {
  const course = entry.exhibition_course || entry.lane;
  return {course:`course:${course}`,day:race.context?.meeting_day ? `course:${course}/day:${race.context.meeting_day}` : null,
    phase:race.context?.phase && race.context.phase!=='UNKNOWN' ? `course:${course}/phase:${race.context.phase}` : null};
}
export function pressureFor(race,entry) {
  const fact=entry.qualification_pressure;
  if(!fact)return {status:'UNKNOWN',required_finish:null};
  if(race.context?.phase!=='QUALIFYING' || typeof fact.must_qualify!=='boolean' || !Number.isInteger(fact.required_finish)
    || fact.required_finish<1 || fact.required_finish>6 || !numeric(fact.required_points) || fact.required_points<0
    || !/^https:\/\//.test(fact.source_url || '') || !Number.isFinite(Date.parse(fact.confirmed_at))
    || Date.parse(fact.confirmed_at)>=Date.parse(race.deadline_at)
    || fact.date!==race.date || fact.venue_code!==race.venue_code || fact.race_no!==race.race_no || fact.racer_id!==entry.racer_id) {
    throw Error('勝負掛けの通過条件・出典・確認時刻・対象が一致しません');
  }
  return {status:fact.must_qualify?'CONFIRMED':'NOT_REQUIRED',required_finish:fact.required_finish,required_points:fact.required_points,
    source_url:fact.source_url,confirmed_at:fact.confirmed_at};
}
export function exhibitionRanks(entries) {
  if(entries.length!==6 || entries.some(e=>!numeric(e.exhibition_time)))return new Map();
  return new Map(entries.map(e=>[e.lane,1+entries.filter(x=>x.exhibition_time<e.exhibition_time).length+(entries.filter(x=>x.exhibition_time===e.exhibition_time).length-1)/2]));
}
export function baseLogWorth(entry) {
  const lane = [1.4,.6,.3,.1,-.2,-.5];
  if(!Number.isInteger(entry.lane) || entry.lane<1 || entry.lane>6 || !['national_win_rate','local_win_rate','motor_2rate','avg_st'].every(k=>numeric(entry[k])))throw Error('予想の基礎入力が不足しています');
  // These are the exact coefficients in legacy fcalc, kept as an offset.
  return (entry.national_win_rate*.6+entry.local_win_rate*.25+entry.motor_2rate/15*.3-(entry.avg_st-.15)*15+lane[entry.lane-1])*.5;
}
export function featuresFor(race,profiles) {
  if(profiles.cutoff_date && profiles.cutoff_date>=race.date)throw Error('当日・未来の結果を履歴特徴量へ使用できません');
  const ranks=exhibitionRanks(race.entries);
  return race.entries.map(entry=>{
    const id=entry.racer_id;
    const keys=contextKeys(race,entry);
    const player=/^\d{4}$/.test(id || '')?profiles.players[id] || {}:{};
    const overall=player[keys.course] || player.all || stats();
    const pool=profiles.population[keys.course] || profiles.population.all || stats();
    const fallback=numeric(entry.avg_st)?entry.avg_st:.15;
    const popMean=pool.st.n?pool.st.mean:fallback;
    const popSd=summary(pool.st).sd ?? 0;
    const pMean=shrink(overall.st.mean,overall.st.n,popMean);
    const pSd=shrink(summary(overall.st).sd ?? popSd,overall.st.n>1?overall.st.n:0,popSd);
    const conditional=key=>{
      const group=key?player[key]:null;
      return {n:group?.st.n || 0,mean:shrink(group?.st.mean || 0,group?.st.n || 0,pMean),
        sd:shrink(summary(group?.st).sd ?? pSd,(group?.st.n || 0)>1?group.st.n:0,pSd)};
    };
    const day=conditional(keys.day),phase=conditional(keys.phase),pressure=pressureFor(race,entry);
    const pressured=conditional(pressure.status==='CONFIRMED'?`${keys.course}/pressure`:null);
    const stGap=summary((player.all || stats()).st_gap),rankGap=summary((player.all || stats()).rank_gap);
    const popGap=summary((profiles.population.all || stats()).st_gap),popRank=summary((profiles.population.all || stats()).rank_gap);
    const gap=shrink(stGap.mean || 0,stGap.n,popGap.mean ?? 0);
    const rankBias=shrink(rankGap.mean || 0,rankGap.n,popRank.mean ?? 0);
    const exRank=ranks.get(entry.lane);
    const pRisk=overall.starts?(overall.flying+overall.late)/overall.starts:0;
    const poolRisk=pool.starts?(pool.flying+pool.late)/pool.starts:0;
    const raw=[overall.st.n?fallback-pMean:0,overall.st.n>1?popSd-pSd:0,
      day.n?pMean-day.mean:0,day.n>1?pSd-day.sd:0,phase.n?pMean-phase.mean:0,phase.n>1?pSd-phase.sd:0,
      pressured.n?pMean-pressured.mean:0,pressured.n>1?pSd-pressured.sd:0,
      numeric(entry.exhibition_st)?fallback-(entry.exhibition_st+gap):0,
      stGap.n?(popGap.rmse ?? 0)-shrink(stGap.rmse,stGap.n,popGap.rmse ?? 0):0,
      numeric(exRank)?3.5-(exRank+rankBias):0,
      rankGap.n?(popRank.rmse ?? 0)-shrink(rankGap.rmse,rankGap.n,popRank.rmse ?? 0):0,
      overall.starts?poolRisk-shrink(pRisk,overall.starts,poolRisk):0];
    return {lane:entry.lane,racer_id:id || null,raw,history:{samples:(player.all || stats()).starts,
      day:{samples:day.n,st_mean:day.n?day.mean:null,st_sd:day.n>1?day.sd:null},
      phase:{samples:phase.n,st_mean:phase.n?phase.mean:null,st_sd:phase.n>1?phase.sd:null},
      pressure:{...pressure,samples:pressured.n,st_mean:pressured.n?pressured.mean:null,st_sd:pressured.n>1?pressured.sd:null},
      exhibition_rank:exRank ?? null,exhibition_st_gap:stGap,exhibition_rank_gap:rankGap,
      low_sample:Math.min(stGap.n,rankGap.n)<PRIOR_SAMPLES}};
  });
}
function addStats(group,entry,rank) {
  if(['NORMAL','F','L'].includes(entry.actual_st_status)){
    group.starts++;if(entry.actual_st_status==='F')group.flying++;if(entry.actual_st_status==='L')group.late++;
  }
  if(entry.actual_st_status==='NORMAL' && numeric(entry.actual_st)){
    add(group.st,entry.actual_st);
    if(numeric(entry.exhibition_st))add(group.st_gap,entry.actual_st-entry.exhibition_st);
  }
  if(numeric(rank) && Number.isInteger(entry.finish) && entry.finish>=1 && entry.finish<=6)add(group.rank_gap,entry.finish-rank);
}
export function observeRace(profiles,race) {
  const ranks=exhibitionRanks(race.entries);
  for(const entry of race.entries){
    if(!/^\d{4}$/.test(entry.racer_id || ''))throw Error('履歴の登録番号がありません');
    const course=entry.actual_course;
    const keys=['all'];
    if(Number.isInteger(course) && course>=1 && course<=6){
      keys.push(`course:${course}`);
      if(race.context?.meeting_day)keys.push(`course:${course}/day:${race.context.meeting_day}`);
      if(race.context?.phase && race.context.phase!=='UNKNOWN')keys.push(`course:${course}/phase:${race.context.phase}`);
      if(pressureFor(race,entry).status==='CONFIRMED')keys.push(`course:${course}/pressure`);
    }
    const player=profiles.players[entry.racer_id] ||= {};
    for(const key of keys){addStats(player[key] ||= stats(),entry,ranks.get(entry.lane));addStats(profiles.population[key] ||= stats(),entry,ranks.get(entry.lane));}
  }
}
export function chronologicalExamples(races) {
  const profiles=emptyProfiles(),examples=[];
  const sorted=[...races].sort((a,b)=>a.date.localeCompare(b.date)||a.venue_code.localeCompare(b.venue_code)||a.race_no-b.race_no);
  for(const date of [...new Set(sorted.map(r=>r.date))]){
    const day=sorted.filter(r=>r.date===date);
    for(const race of day){
      try{
        const vectors=featuresFor(race,profiles),base=race.entries.map(baseLogWorth);
        const order=race.entries.map((e,i)=>({finish:e.finish,i})).sort((a,b)=>a.finish-b.finish);
        if(order.every((o,i)=>o.finish===i+1))examples.push({date,venue_code:race.venue_code,race_no:race.race_no,phase:race.context?.phase,base,
          vectors:vectors.map(v=>v.raw),history_samples:vectors.map(v=>v.history.samples),order:order.map(o=>o.i)});
      }catch(error){if(!/基礎入力/.test(error.message))throw error;}
    }
    // Results from the same race/day cannot leak into the corresponding features.
    for(const race of day)observeRace(profiles,race);
    profiles.cutoff_date=date;
  }
  return {examples,profiles};
}
