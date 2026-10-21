import {FEATURE_NAMES,ENGINE_VERSION,featuresFor,baseLogWorth} from './features.mjs';
export const canonical = value => JSON.stringify(value);
export function logSumExp(values){const max=Math.max(...values);return max+Math.log(values.reduce((s,v)=>s+Math.exp(v-max),0));}
export function tripleItems(logWorth,lanes=[1,2,3,4,5,6]){
  const output=[];
  for(let a=0;a<6;a++)for(let b=0;b<6;b++)for(let c=0;c<6;c++){
    if(a===b||a===c||b===c)continue;
    const p=Math.exp(logWorth[a]-logSumExp(logWorth)+logWorth[b]-logSumExp(logWorth.filter((_,i)=>i!==a))+logWorth[c]-logSumExp(logWorth.filter((_,i)=>i!==a&&i!==b)));
    output.push({combo:`${lanes[a]}-${lanes[b]}-${lanes[c]}`,probability:p});
  }
  return output.sort((a,b)=>b.probability-a.probability||a.combo.localeCompare(b.combo)).map((x,i)=>({rank:i+1,...x}));
}
export function transformed(raw,model){return raw.map((v,i)=>(v-model.means[i])/model.scales[i]);}
export function validateModel(model){
  if(model.schema_version!==2||model.engine_version!==ENGINE_VERSION||canonical(model.feature_names)!==canonical(FEATURE_NAMES)
    || !model.profiles || model.trained_through!==model.profiles.cutoff_date || !/^\d{4}-\d{2}-\d{2}$/.test(model.trained_through || '')
    || !Number.isFinite(Date.parse(model.created_at))
    || ['means','scales','coefficients'].some(key=>!Array.isArray(model[key])||model[key].length!==FEATURE_NAMES.length||model[key].some(v=>!Number.isFinite(v)))
    || model.scales.some(s=>s<=0))throw Error('履歴モデルの形式・バージョンが不正です');
  return model;
}
export function predict(race,model){
  validateModel(model);
  if(model.trained_through>=race.date)throw Error('予想対象日以降の学習結果は使用できません');
  const sorted={...race,entries:[...race.entries].sort((a,b)=>a.lane-b.lane)};
  if(sorted.entries.length!==6 || sorted.entries.some(e=>!Number.isInteger(e.lane)||e.lane<1||e.lane>6) || new Set(sorted.entries.map(e=>e.lane)).size!==6)throw Error('6艇分の予想入力が必要です');
  if(sorted.context?.meeting_day!=null && (!Number.isInteger(sorted.context.meeting_day)||sorted.context.meeting_day<1||sorted.context.meeting_day>30))throw Error('開催日次が不正です');
  for(const e of sorted.entries){
    if(e.exhibition_time!=null&&(!Number.isFinite(e.exhibition_time)||e.exhibition_time<5||e.exhibition_time>9))throw Error('展示タイムが不正です');
    if(e.exhibition_st!=null&&(!Number.isFinite(e.exhibition_st)||Math.abs(e.exhibition_st)>=1))throw Error('展示STが不正です');
    if(e.exhibition_course!=null&&(!Number.isInteger(e.exhibition_course)||e.exhibition_course<1||e.exhibition_course>6))throw Error('展示進入が不正です');
  }
  const features=featuresFor(sorted,model.profiles);
  const logWorth=features.map((feature,i)=>{
    const vector=transformed(feature.raw,model);
    feature.contributions=vector.map((v,j)=>v*model.coefficients[j]);
    feature.log_adjustment=feature.contributions.reduce((s,v)=>s+v,0);
    return baseLogWorth(sorted.entries[i])+feature.log_adjustment;
  });
  if(logWorth.some(v=>!Number.isFinite(v)))throw Error('履歴補正の計算値が不正です');
  return {items:tripleItems(logWorth),features,log_worth:logWorth};
}
export function lossAndGradient(examples,beta,{lambda=0,gradient=true}={}){
  let loss=0;const grad=beta.map(()=>0);
  for(const example of examples){
    const score=example.base.map((base,i)=>base+example.x[i].reduce((s,v,j)=>s+v*beta[j],0));
    const remaining=[0,1,2,3,4,5];
    for(const chosen of example.order.slice(0,3)){
      const denom=logSumExp(remaining.map(i=>score[i]));loss+=denom-score[chosen];
      if(gradient)for(let j=0;j<beta.length;j++)grad[j]+=remaining.reduce((s,i)=>s+Math.exp(score[i]-denom)*example.x[i][j],0)-example.x[chosen][j];
      remaining.splice(remaining.indexOf(chosen),1);
    }
  }
  const n=examples.length||1;
  return {loss:loss/n+lambda*beta.reduce((s,v)=>s+v*v,0)/2,gradient:grad.map((v,j)=>v/n+lambda*beta[j])};
}
export function fit(examples,lambda,iterations=220){
  const beta=FEATURE_NAMES.map(()=>0),m=[...beta],v=[...beta];
  for(let step=1;step<=iterations;step++){
    const gradient=lossAndGradient(examples,beta,{lambda}).gradient;
    for(let j=0;j<beta.length;j++){
      m[j]=.9*m[j]+.1*gradient[j];v[j]=.999*v[j]+.001*gradient[j]*gradient[j];
      beta[j]-=.025*(m[j]/(1-.9**step))/(Math.sqrt(v[j]/(1-.999**step))+1e-8);
    }
  }
  return beta;
}
