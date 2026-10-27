// New inputs are versioned separately; existing saved v3/v3.1 forecasts stay intact.
export const CONTEXT_LABELS=['2コース選手の逃がし傾向','2コース選手の差し決着傾向','風速条件とコース適性','風向条件とコース適性','予測潮位とコース適性','潮位変化とコース適性'];
const finite=Number.isFinite;
const blank=()=>({n:0,escape:0,second_sashi:0});
const bounded=(x,a,b)=>Math.max(a,Math.min(b,x));
const normal=r=>r.entries?.length===6&&new Set(r.entries.map(e=>e.actual_course)).size===6&&r.entries.every(e=>e.actual_course>=1&&e.actual_course<=6&&e.finish_status==='NORMAL'&&e.actual_st_status==='NORMAL')&&new Set(r.entries.map(e=>e.finish)).size===6&&r.entries.every(e=>e.finish>=1&&e.finish<=6);
export const speedBucket=v=>!finite(v)?null:v<3?'0-2':v<6?'3-5':'6+';
export function preraceEnvironment(race){
 const env=race.environment,at=Date.parse(env?.fetched_at),cutoff=Date.parse(race.deadline_at)-180000;
 return env?.kind==='PRERACE_OFFICIAL'&&finite(at)&&finite(cutoff)&&at<=cutoff?env:null;
}
export function observeRaceContext(profiles,race){
 if(!normal(race))return;
 const context=profiles.race_context||=( {course2:{...blank(),players:{}},conditions:{}} );
 const one=race.entries.find(e=>e.actual_course===1),two=race.entries.find(e=>e.actual_course===2);
 if(one.lane===1&&/^\d{4}$/.test(two.racer_id)){
  const player=context.course2.players[two.racer_id]||=blank();
  for(const stats of [context.course2,player]){stats.n++;stats.escape+=Number(one.finish===1&&race.kimarite==='逃げ');stats.second_sashi+=Number(two.finish===1&&race.kimarite==='差し');}
 }
 const env=preraceEnvironment(race)||race.environment?.kind==='RESULT_REPORTED'&&race.environment;
 if(!env)return;
 const bins=[['speed',speedBucket(env.wind_speed_mps)],['direction',env.wind_direction_key||null]];
 const before=preraceEnvironment(race),tide=before?.tide;
 if(tide?.status==='OK'&&tide.kind==='PREDICTED_REFERENCE'&&finite(tide.normalized_level))bins.push(['tide',tide.normalized_level<-.33?'LOW':tide.normalized_level>.33?'HIGH':'MID'],['trend',tide.trend]);
 for(const e of race.entries)for(const [type,value] of bins)if(value){
  const key=`${race.venue_code}/${e.actual_course}/${type}/${value}`,s=context.conditions[key]||=( {n:0,wins:0} );s.n++;s.wins+=Number(e.finish===1);
 }
}
const entryCourse=(race,e)=>{const courses=race.entries.map(x=>x.exhibition_course);return courses.length===6&&new Set(courses).size===6&&courses.every(c=>Number.isInteger(c)&&c>=1&&c<=6)?e.exhibition_course:e.lane;};
export function course2Stats(race,profiles){
 const entered=[...race.entries],courses=entered.map(e=>e.exhibition_course),confirmed=courses.length===6&&new Set(courses).size===6&&courses.every(c=>Number.isInteger(c)&&c>=1&&c<=6);
 const one=entered.find(e=>(confirmed?e.exhibition_course:e.lane)===1),two=entered.find(e=>(confirmed?e.exhibition_course:e.lane)===2),pool=profiles.race_context?.course2;
 const s=pool?.players?.[two?.racer_id];
 if(!pool?.n||!s?.n||one?.lane!==1)return {samples:0,escape_rate:null,smoothed_escape_rate:null,sashi_rate:null,player_id:two?.racer_id||null,basis:confirmed?'展示進入':'枠なり想定'};
 const prior=pool.escape/pool.n,sashiPrior=pool.second_sashi/pool.n;
 return {samples:s.n,escape_rate:s.escape/s.n,smoothed_escape_rate:(s.escape+20*prior)/(s.n+20),sashi_rate:(s.second_sashi+20*sashiPrior)/(s.n+20),population_escape_rate:prior,population_sashi_rate:sashiPrior,player_id:two.racer_id,basis:confirmed?'展示進入':'枠なり想定'};
}
export function contextFeatures(race,profiles,entry){
 const stats=course2Stats(race,profiles),course=entryCourse(race,entry),env=preraceEnvironment(race);
 const delta=stats.samples?(stats.smoothed_escape_rate-stats.population_escape_rate):0;
 const sashi=stats.samples?(stats.sashi_rate-stats.population_sashi_rate):0;
 const bins=[['speed',speedBucket(env?.wind_speed_mps)],['direction',env?.wind_direction_key||null],['tide',env?.tide?.status==='OK'&&finite(env.tide.normalized_level)?env.tide.normalized_level<-.33?'LOW':env.tide.normalized_level>.33?'HIGH':'MID':null],['trend',env?.tide?.status==='OK'?env.tide.trend:null]];
 const pool=profiles.population['l'+entry.lane],prior=pool?.[0]?(pool[1]+1)/(pool[0]+6):[.5,.15,.12,.1,.08,.05][entry.lane-1];
 return [entry.lane===1?delta:0,course===2?sashi:0,...bins.map(([type,value])=>{
  const s=value&&profiles.race_context?.conditions?.[`${race.venue_code}/${course}/${type}/${value}`];
  return s?.n?bounded(Math.log(Math.max(1e-6,(s.wins+100*prior)/(s.n+100))/prior),-2,2):0;
 })];
}
