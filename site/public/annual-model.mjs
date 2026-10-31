import {CONTEXT_LABELS,contextFeatures,observeRaceContext,course2Stats,lane2SupportFeature,lane2SupportStats,LANE2_SUPPORT_LABEL} from './race-context.mjs';
// Versioned independently: v2 saved forecasts retain their original engine.
export const ANNUAL_ENGINE='annual-player-v3.0';
export const ANNUAL_FEATURES=['枠別1着率','枠別着順点','選手の着順点','枠別ST','ST安定度','枠別スタート順位','展示順位と着順の差','逃げ傾向','差し傾向','まくり傾向','まくり差し傾向','抜き傾向','開催日ST','区分別ST'];
export const VENUE_ANNUAL_ENGINE='annual-player-v3.1';
export const VENUE_ANNUAL_FEATURES=[...ANNUAL_FEATURES,'場・枠別1着傾向','場・枠別着順傾向','場と選手の決まり手適合'];
export const CONTEXT_ANNUAL_ENGINE='annual-player-v3.2';
export const CONTEXT_ANNUAL_FEATURES=[...VENUE_ANNUAL_FEATURES,...CONTEXT_LABELS];
export const LANE2_ANNUAL_ENGINE='annual-player-v3.3';
export const LANE2_ANNUAL_FEATURES=[...CONTEXT_ANNUAL_FEATURES,LANE2_SUPPORT_LABEL];
export const annualFeatureNames=model=>model.feature_names||ANNUAL_FEATURES;
export const STYLES=['逃げ','差し','まくり','まくり差し','抜き','恵まれ'];
// n,w,points,finishN,stN,stSum,stSq,rankN,rankSum,styleCounts,gapN,gapSum,gapSq
export const emptyAnnualStats=()=>[0,0,0,0,0,0,0,0,0,[0,0,0,0,0,0],0,0,0];
export const emptyAnnualProfiles=()=>({players:{},population:{},venues:{}});
const points=[0,10,8,6,4,2,1],finite=Number.isFinite;
const shrunk=(sum,n,prior,strength=20)=>(sum+strength*prior)/(n+strength);
const meanST=s=>s?.[4]?s[5]/s[4]:.17;
const sdST=s=>s?.[4]>1?Math.sqrt(Math.max(0,(s[6]-s[5]*s[5]/s[4])/(s[4]-1))):.06;
export function exhibitionRank(entries,lane){
 if(entries.length!==6||entries.some(e=>!finite(e.exhibition_time)))return null;
 const value=entries.find(e=>e.lane===lane)?.exhibition_time;
 return 1+entries.filter(e=>e.exhibition_time<value).length+(entries.filter(e=>e.exhibition_time===value).length-1)/2;
}
export function annualLaneStats(model,id,lane){
 const s=model.profiles.players[id]?.['l'+lane];
 if(!s?.[0])return {samples:0,win_rate:null,mean_points:null,mean_st:null,mean_start_rank:null,st_samples:0,start_rank_samples:0,kimarite:null};
 return {samples:s[0],win_rate:s[1]/s[0],mean_points:s[3]?s[2]/s[3]:null,mean_st:s[4]?s[5]/s[4]:null,
  mean_start_rank:s[7]?s[8]/s[7]:null,st_samples:s[4],start_rank_samples:s[7],kimarite:Object.fromEntries(STYLES.map((name,i)=>[name,s[9][i]]))};
}
export function annualFeatures(race,profiles,names=ANNUAL_FEATURES){
 return [...race.entries].sort((a,b)=>a.lane-b.lane).map(e=>{
  const player=profiles.players[e.racer_id]||{},s=player['l'+e.lane]||emptyAnnualStats(),all=player.all||s;
  const pool=profiles.population['l'+e.lane]||emptyAnnualStats(),overall=profiles.population.all||pool;
  const popWin=pool[0]?(pool[1]+1)/(pool[0]+6):[.5,.15,.12,.1,.08,.05][e.lane-1];
  const win=shrunk(s[1],s[0],popWin),pts=shrunk(s[2],s[3],pool[3]?pool[2]/pool[3]:5);
  const allPts=shrunk(all[2],all[3],overall[3]?overall[2]/overall[3]:5);
  const st=shrunk(s[5],s[4],meanST(pool)),sd=shrunk(sdST(s)*s[4],s[4],sdST(pool));
  const rank=shrunk(s[8],s[7],pool[7]?pool[8]/pool[7]:3.5),ex=exhibitionRank(race.entries,e.lane);
  const gap=shrunk(s[11],s[10],pool[10]?pool[11]/pool[10]:0);
  const conditional=key=>{const c=player[key];return c?.[4]?st-shrunk(c[5],c[4],st):0;};
  const base=[Math.log(Math.max(1e-6,win)),pts/10,allPts/10,(.17-st)*10,(.06-sd)*10,(3.5-rank)/2.5,
   ex===null?0:(3.5-ex-gap)/2.5,...[0,1,2,3,4].map(i=>shrunk(s[9][i],s[0],pool[0]?pool[9][i]/pool[0]:0)),
   conditional('d'+race.context?.meeting_day)*10,conditional('p'+race.context?.phase)*10];
  if(names.length===ANNUAL_FEATURES.length)return base;
  const v=profiles.venues?.[race.venue_code]?.['l'+e.lane]||emptyAnnualStats(),nationalPoints=pool[3]?pool[2]/pool[3]:5;
  const extra=names.length>=CONTEXT_ANNUAL_FEATURES.length?contextFeatures(race,profiles,e):[];if(names.length===LANE2_ANNUAL_FEATURES.length)extra.push(lane2SupportFeature(race,profiles,e));
  if(!v[0])return [...base,0,0,0,...extra];
  const venueWin=shrunk(v[1],v[0],popWin,300),venuePoints=shrunk(v[2],v[3],nationalPoints,300);
  const fit=[0,1,2,3,4].reduce((sum,k)=>{
   const rate=pool[0]?pool[9][k]/pool[0]:0,venueRate=shrunk(v[9][k],v[0],rate,300),preference=shrunk(s[9][k],s[1],pool[1]?pool[9][k]/pool[1]:0,5);
   return sum+preference*Math.log(Math.max(1e-6,venueRate)/Math.max(1e-6,rate));
  },0);
  return [...base,Math.log(Math.max(1e-6,venueWin)/Math.max(1e-6,popWin)),(venuePoints-nationalPoints)/10,fit,...extra];
 });
}
export function observeAnnual(profiles,race){
 observeRaceContext(profiles,race);
 for(const e of race.entries){
  if(!/^\d{4}$/.test(e.racer_id)||!Number.isInteger(e.lane)||e.lane<1||e.lane>6)throw Error('履歴の枠・登録番号が不正です');
  if(String(e.finish_status||'').startsWith('K'))continue;
  const player=profiles.players[e.racer_id]||=( {} );
  const keys=['all','l'+e.lane];if(Number.isInteger(e.actual_course)&&e.actual_course>=1&&e.actual_course<=6)keys.push('c'+e.actual_course);if(race.context?.meeting_day)keys.push('d'+race.context.meeting_day);if(race.context?.phase)keys.push('p'+race.context.phase);
  for(const key of keys){
   const groups=[player[key]||=emptyAnnualStats(),profiles.population[key]||=emptyAnnualStats()];
   if(/^(0[1-9]|1\d|2[0-4])$/.test(race.venue_code||'')&&(key==='all'||key==='l'+e.lane)){
    const venues=profiles.venues||=( {} ),venue=venues[race.venue_code]||=( {} );groups.push(venue[key]||=emptyAnnualStats());
   }
   for(const s of groups){s[0]++;if(e.finish===1){s[1]++;const k=STYLES.indexOf(race.kimarite);if(k>=0)s[9][k]++;}
    s[3]++;if(Number.isInteger(e.finish)&&e.finish>=1&&e.finish<=6){s[2]+=points[e.finish];const ex=exhibitionRank(race.entries,e.lane);if(ex!==null){s[10]++;s[11]+=e.finish-ex;s[12]=(s[12]||0)+(e.finish-ex)**2;}}
    if(e.actual_st_status==='NORMAL'&&finite(e.actual_st)&&e.actual_st>=0&&e.actual_st<1){s[4]++;s[5]+=e.actual_st;s[6]+=e.actual_st**2;}
    if(finite(e.start_rank)&&e.start_rank>=1&&e.start_rank<=6){s[7]++;s[8]+=e.start_rank;}
   }
  }
 }
}
export function annualTriples(scores){
 const exp=scores.map(s=>Math.exp(s-Math.max(...scores))),sum=exp.reduce((a,b)=>a+b,0),rows=[];
 for(let a=0;a<6;a++)for(let b=0;b<6;b++)for(let c=0;c<6;c++)if(a!==b&&a!==c&&b!==c)rows.push({combo:`${a+1}-${b+1}-${c+1}`,probability:exp[a]/sum*exp[b]/exp.reduce((s,v,i)=>s+(i!==a?v:0),0)*exp[c]/exp.reduce((s,v,i)=>s+(i!==a&&i!==b?v:0),0)});
 return rows.sort((a,b)=>b.probability-a.probability||a.combo.localeCompare(b.combo)).map((r,i)=>({rank:i+1,...r}));
}
export function validateAnnualModel(model,date){
 const names=annualFeatureNames(model||{}),lane2=model?.engine_version===LANE2_ANNUAL_ENGINE,context=lane2||model?.engine_version===CONTEXT_ANNUAL_ENGINE,venue=context||model?.engine_version===VENUE_ANNUAL_ENGINE;
 if(JSON.stringify(names)!==JSON.stringify(lane2?LANE2_ANNUAL_FEATURES:context?CONTEXT_ANNUAL_FEATURES:venue?VENUE_ANNUAL_FEATURES:ANNUAL_FEATURES)||venue&&!model?.profiles?.venues)throw Error('場別モデルの特徴量・履歴が不正です');
 if(model?.schema_version!==3||![ANNUAL_ENGINE,VENUE_ANNUAL_ENGINE,CONTEXT_ANNUAL_ENGINE,LANE2_ANNUAL_ENGINE].includes(model.engine_version)||model.coverage?.days!==365||model.coverage.failures!==0
  || model.coverage.from!==model.trained_from||model.coverage.through!==model.trained_through
  || Date.parse(date)-Date.parse(model.trained_through)>3*86400000
  || !model.profiles?.players || model.coefficients?.length!==names.length||model.means?.length!==names.length||model.scales?.length!==names.length
  || [model.coefficients,model.means,model.scales].some(a=>a.some(x=>!finite(x)))||model.scales.some(x=>x<=0)||!(model.temperature>0)
  || !model.trained_from||!model.trained_through||model.trained_through>=date||Date.parse(model.trained_through)-Date.parse(model.trained_from)!==364*86400000
  || !/^annual-v3-[a-f0-9]{64}$/.test(model.id||''))throw Error('直近1年モデルの期間・完全性・形式を確認できません');
 if(lane2&&model.coefficients.at(-1)<0)throw Error('2号艇逃がし率の係数は非負である必要があります');
 return model;
}
export function predictAnnual(race,model){
 validateAnnualModel(model,race.date);
 if(race.entries.some(e=>!Number.isInteger(e.lane)||e.lane<1||e.lane>6)||race.entries.length!==6||new Set(race.entries.map(e=>e.lane)).size!==6||race.entries.some(e=>!/^\d{4}$/.test(e.racer_id||'')))throw Error('年次予想に必要な6艇の登録番号がありません');
 const sorted=[...race.entries].sort((a,b)=>a.lane-b.lane),features=annualFeatures({...race,entries:sorted},model.profiles,annualFeatureNames(model));
 const contributions=features.map(row=>row.map((v,i)=>(v-model.means[i])/model.scales[i]*model.coefficients[i]/model.temperature));
 const scores=contributions.map(row=>Math.max(-15,Math.min(15,row.reduce((a,b)=>a+b,0))));
 return {items:annualTriples(scores),scores:sorted.map((e,i)=>({lane:e.lane,name:e.name,base_score:0,history_adjustment:scores[i],total:scores[i],base_components:[],history_components:contributions[i].map((value,j)=>({label:annualFeatureNames(model)[j],raw_value:features[i][j],value}))})),
  entries:sorted.map(e=>({...e,annual_lane:annualLaneStats(model,e.racer_id,e.lane)}))};
}

export function pairedExhibitionGap(model,id,date) {
 const data=model.exhibition_st_profiles,s=data?.players?.[id];
 if(data?.schema_version!==1||data.kind!=='EXHIBITION_ST_PAIRED_HISTORY'||!s||!(data.through<date)||!Number.isInteger(s.n)||s.n<1
  || ![s.sum,s.sum_squares].every(Number.isFinite)||s.sum_squares<0||s.from<data.window_from||s.through>data.through||s.from>s.through)return null;
 return {n:s.n,mean:s.sum/s.n,sd:s.n>1?Math.sqrt(Math.max(0,(s.sum_squares-s.sum*s.sum/s.n)/(s.n-1))):null,
  rmse:Math.sqrt(s.sum_squares/s.n),from:s.from,through:s.through,scope:'選手全枠'};
}
export function annualDataDetails(race,model,e){
 const p=model.profiles.players[e.racer_id]||{},summarize=s=>({samples:s?.[0]||0,win_rate:s?.[0]?s[1]/s[0]:null,
  mean_points:s?.[3]?s[2]/s[3]:null,mean_st:s?.[4]?meanST(s):null,st_sd:s?.[4]>1?sdST(s):null,
  mean_start_rank:s?.[7]?s[8]/s[7]:null,st_samples:s?.[4]||0,start_rank_samples:s?.[7]||0});
 const windows=model.profiles.windows,recent={};
 if(windows?.through===model.trained_through&&windows.through<race.date)for(const days of [30,90])recent[days]={
  from:new Date(Date.parse(windows.through)-(days-1)*86400000).toISOString().slice(0,10),through:windows.through,
  all:summarize(p[`r${days}all`]),lane:summarize(p[`r${days}l${e.lane}`])};
 const course=Number.isInteger(e.exhibition_course)&&e.exhibition_course>=1&&e.exhibition_course<=6?e.exhibition_course:null;
 return {recent,actual_course:course===null?null:{course,basis:'EXHIBITION_COURSE_NOT_CONFIRMED_RACE_ENTRY',...summarize(p['c'+course])},
  conditional:{day:{...summarize(p['d'+race.context?.meeting_day])},phase:{...summarize(p['p'+race.context?.phase])}},
  probability_usage:'NOT_ADDED_TO_APPROVED_14_FEATURES'};
}
export function annualHistory(race,model){
 const conditional=s=>({samples:s?.[4]||0,st_mean:s?.[4]?meanST(s):null,st_sd:s?.[4]>1?sdST(s):null});
 return {trained_from:model.trained_from,trained_through:model.trained_through,venue:annualVenueSummary(race,model),course2_escape:course2Stats(race,model.profiles),lane2_support:{...lane2SupportStats(race,model.profiles),applied:model.engine_version===LANE2_ANNUAL_ENGINE&&model.coefficients.at(-1)>0},context_features_applied:[CONTEXT_ANNUAL_ENGINE,LANE2_ANNUAL_ENGINE].includes(model.engine_version),context_usage:Object.fromEntries(['course2_escape','course2_sashi','wind_speed','wind_direction','tide','tide_trend'].map((key,i)=>[key,[CONTEXT_ANNUAL_ENGINE,LANE2_ANNUAL_ENGINE].includes(model.engine_version)&&Math.abs(model.coefficients[17+i])>1e-10])),lanes:race.entries.map(e=>{
  const p=model.profiles.players[e.racer_id]||{},s=p['l'+e.lane];
  return {lane:e.lane,data_details:annualDataDetails(race,model,e),exhibition_rank:exhibitionRank(race.entries,e.lane),day:conditional(p['d'+race.context?.meeting_day]),phase:conditional(p['p'+race.context?.phase]),
   exhibition_rank_gap:s?.[10]?{n:s[10],mean:s[11]/s[10],rmse:Math.sqrt((s[12]||0)/s[10])}:null,exhibition_st_gap:pairedExhibitionGap(model,e.racer_id,race.date),pressure:{status:'UNCONFIRMED'}};
 })};
}

export function annualVenueSummary(race,model){
 const venue=model.profiles.venues?.[race.venue_code];if(!venue)return null;
 const one=venue.l1,pool=model.profiles.population.l1;
 return {venue_code:race.venue_code,from:model.trained_from,through:model.trained_through,
  applied:[VENUE_ANNUAL_ENGINE,CONTEXT_ANNUAL_ENGINE].includes(model.engine_version),
  lanes:Array.from({length:6},(_,i)=>{const s=venue['l'+(i+1)];return {lane:i+1,starts:s?.[0]||0,win_rate:s?.[0]?s[1]/s[0]:null,escape_rate:s?.[0]?s[9][0]/s[0]:null};}),
  national_lane1_win_rate:pool?.[0]?pool[1]/pool[0]:null,
  note:'枠番別の過去実績。1枠1着率と決まり手が逃げの割合は別集計。少数例は全国の同じ枠へ縮小して予想に使用。'};
}
