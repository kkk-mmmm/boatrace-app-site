import {ANNUAL_FEATURES,emptyAnnualProfiles,annualFeatures,observeAnnual,annualTriples,validateAnnualModel} from '../../site/public/annual-model.mjs';
import crypto from 'node:crypto';
export const coefficientId=m=>'annual-coeff-'+crypto.createHash('sha256').update(JSON.stringify([m.engine_version,m.feature_names,m.coefficients,m.means,m.scales,m.temperature])).digest('hex');
export function adoptionAllowed(r){
 return r?.races>=2000&&r.days>=20&&r.delta_log_loss<=-.01&&r.delta_top10>=0&&r.delta_brier<=0&&Number.isFinite(r.daily_loss_ci95?.[1])&&r.daily_loss_ci95[1]<0;
}
function metrics(x,combo,model){
 const scores=x.map(row=>Math.max(-15,Math.min(15,row.reduce((s,v,j)=>s+(v-model.means[j])/model.scales[j]*model.coefficients[j]/model.temperature,0))));
 const rows=annualTriples(scores);return {loss:-Math.log(rows.find(r=>r.combo===combo).probability),hit:Number(rows.slice(0,10).some(r=>r.combo===combo)),brier:rows.reduce((s,r)=>s+(r.probability-Number(r.combo===combo))**2,0)};
}
export function compareMonthly(races,manifest,candidate,active){
 for(const m of [candidate,active]){validateAnnualModel(m,new Date(Date.parse(m.trained_through)+86400000).toISOString().slice(0,10));if(JSON.stringify(m.feature_names)!==JSON.stringify(ANNUAL_FEATURES))throw Error('自動更新できる特徴量が異なります');}
 if(manifest.days!==365||manifest.failures?.length!==0||manifest.races!==races.length||Date.parse(manifest.through)-Date.parse(manifest.from)!==364*86400000)throw Error('比較には完全な365日履歴が必要です');
 const from=new Date(Date.parse(manifest.through)-29*86400000).toISOString().slice(0,10),keys=new Set(),byDay=new Map();
 for(const m of [candidate,active])if(m.validation?.kind!=='RETROSPECTIVE_TEMPORAL_HOLDOUT'||!/^\d{4}-\d{2}-\d{2}$/.test(m.validation.test_from)||m.validation.test_from>from||m.trained_through>manifest.through)throw Error('学習・係数選択に使わない共通評価期間を確認できません');
 for(const race of races){if(race.date<manifest.from||race.date>manifest.through)throw Error('比較期間外の履歴です');const k=`${race.date}/${race.venue_code}/${race.race_no}`;if(keys.has(k))throw Error('比較対象が重複しています');keys.add(k);if(!byDay.has(race.date))byDay.set(race.date,[]);byDay.get(race.date).push(race);}
 const profiles=emptyAnnualProfiles(),sums={candidate:{loss:0,hit:0,brier:0},active:{loss:0,hit:0,brier:0}},daily=[];let n=0;
 for(const date of [...byDay.keys()].sort()){
  let delta=0,count=0;for(const race of byDay.get(date))if(date>=from){
   const entries=[...race.entries].sort((a,b)=>a.lane-b.lane),order=[...entries].sort((a,b)=>a.finish-b.finish);
   if(entries.length!==6||new Set(entries.map(e=>e.racer_id)).size!==6||entries.some((e,i)=>e.lane!==i+1)||!order.every((e,i)=>e.finish===i+1&&e.finish_status==='NORMAL'))continue;
   const x=annualFeatures({...race,entries},profiles),combo=order.slice(0,3).map(e=>e.lane).join('-'),a=metrics(x,combo,active),c=metrics(x,combo,candidate);
   for(const key of ['loss','hit','brier']){sums.active[key]+=a[key];sums.candidate[key]+=c[key];}delta+=c.loss-a.loss;count++;n++;
  }
  if(count)daily.push({date,n:count,delta_loss_sum:delta});
  for(const race of byDay.get(date))observeAnnual(profiles,race); // Never see today's results before its forecasts.
 }
 let seed=1729;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},samples=[];
 if(daily.length)for(let b=0;b<2000;b++){let loss=0,count=0;for(let d=0;d<daily.length;d++){const row=daily[Math.floor(random()*daily.length)];loss+=row.delta_loss_sum;count+=row.n;}samples.push(loss/count);}
 samples.sort((a,b)=>a-b);
 const report={kind:'PAIRED_TEMPORAL_HOLDOUT',from,through:manifest.through,races:n,days:daily.length,active_coefficient_id:coefficientId(active),candidate_coefficient_id:coefficientId(candidate),
  active:{log_loss:n?sums.active.loss/n:null,top10_hit_rate:n?sums.active.hit/n:null,brier:n?sums.active.brier/n:null},
  candidate:{log_loss:n?sums.candidate.loss/n:null,top10_hit_rate:n?sums.candidate.hit/n:null,brier:n?sums.candidate.brier/n:null},
  delta_log_loss:n?(sums.candidate.loss-sums.active.loss)/n:null,delta_top10:n?(sums.candidate.hit-sums.active.hit)/n:null,delta_brier:n?(sums.candidate.brier-sums.active.brier)/n:null,
  daily_loss_ci95:samples.length?[samples[50],samples[1949]]:null,daily,
  criteria:{minimum_races:2000,minimum_days:20,maximum_delta_log_loss:-.01,minimum_delta_top10:0,maximum_delta_brier:0,maximum_daily_ci_upper:0},
  note:'同じレース・同じ過去履歴から比較。日単位の再標本化95%区間。過去検証であり収益の改善を保証しません。'};
 report.accepted=adoptionAllowed(report);return report;
}
