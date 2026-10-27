import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {CONTEXT_ANNUAL_ENGINE,CONTEXT_ANNUAL_FEATURES,ANNUAL_ENGINE,ANNUAL_FEATURES,VENUE_ANNUAL_ENGINE,VENUE_ANNUAL_FEATURES,emptyAnnualProfiles,annualFeatures,observeAnnual,annualTriples} from '../../site/public/annual-model.mjs';
const contextMode=process.argv.includes('--context'),venueMode=contextMode||process.argv.includes('--venue'),featureNames=contextMode?CONTEXT_ANNUAL_FEATURES:venueMode?VENUE_ANNUAL_FEATURES:ANNUAL_FEATURES;
const [directory,output]=process.argv.slice(2);if(!directory||!output)throw Error('履歴フォルダとモデル出力先が必要です');
const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'))),races=JSON.parse(fs.readFileSync(path.join(directory,'races.json')));
if(manifest.days!==365||manifest.failures.length||!races.length)throw Error('完全な1年履歴が必要です');
races.sort((a,b)=>a.date.localeCompare(b.date)||a.venue_code.localeCompare(b.venue_code)||a.race_no-b.race_no);
const profiles=emptyAnnualProfiles(),examples=[],dates=[...new Set(races.map(r=>r.date))];
for(const date of dates){const day=races.filter(r=>r.date===date);for(const race of day){
 const entries=[...race.entries].sort((a,b)=>a.lane-b.lane),order=entries.map((e,i)=>({finish:e.finish,i})).sort((a,b)=>a.finish-b.finish);
 if(order.every((x,i)=>x.finish===i+1))examples.push({date,x:annualFeatures({...race,entries},profiles,featureNames),order:order.map(x=>x.i),combo:order.slice(0,3).map(x=>x.i+1).join('-')});
}for(const race of day)observeAnnual(profiles,race);}
const tuneStart=dates.at(-60),testStart=dates.at(-30),train=examples.filter(e=>e.date<tuneStart),tune=examples.filter(e=>e.date>=tuneStart&&e.date<testStart),test=examples.filter(e=>e.date>=testStart);
if(train.length<5000||tune.length<500||test.length<500)throw Error('時系列の学習・検証数が不足しています');
const means=featureNames.map((_,j)=>train.reduce((s,e)=>s+e.x.reduce((n,row)=>n+row[j],0),0)/(train.length*6));
const scales=means.map((m,j)=>Math.max(.01,Math.sqrt(train.reduce((s,e)=>s+e.x.reduce((n,row)=>n+(row[j]-m)**2,0),0)/(train.length*6))));
for(const e of examples)e.x=e.x.map(row=>row.map((v,j)=>(v-means[j])/scales[j]));
function fit(data,lambda){
 const beta=featureNames.map(()=>0),m=[...beta],v=[...beta],sample=data.filter((_,i)=>i%Math.max(1,Math.floor(data.length/6000))===0);
 for(let step=1;step<=100;step++){
  const grad=[...beta].fill(0);for(const e of sample){const score=e.x.map(row=>row.reduce((s,x,j)=>s+x*beta[j],0)),left=[0,1,2,3,4,5];
   for(const selected of e.order.slice(0,3)){const max=Math.max(...left.map(i=>score[i])),weights=left.map(i=>Math.exp(score[i]-max)),sum=weights.reduce((a,b)=>a+b,0);
    for(let j=0;j<beta.length;j++)grad[j]+=left.reduce((s,i,k)=>s+weights[k]/sum*e.x[i][j],0)-e.x[selected][j];left.splice(left.indexOf(selected),1);}}
  for(let j=0;j<beta.length;j++){const g=grad[j]/sample.length+lambda*beta[j];m[j]=.9*m[j]+.1*g;v[j]=.999*v[j]+.001*g*g;beta[j]-=.025*(m[j]/(1-.9**step))/(Math.sqrt(v[j]/(1-.999**step))+1e-8);}
 }return beta;
}
function evaluate(data,beta,temp=1){let loss=0,hits=0;for(const e of data){const rows=annualTriples(e.x.map(row=>Math.max(-15,Math.min(15,row.reduce((s,x,j)=>s+x*beta[j],0)/temp))));loss-=Math.log(rows.find(r=>r.combo===e.combo).probability);if(rows.slice(0,10).some(r=>r.combo===e.combo))hits++;}return {races:data.length,log_loss:loss/data.length,top10_hit_rate:hits/data.length};}
const candidates=[];for(const lambda of [.05,.5,5]){const beta=fit(train,lambda);for(const temperature of [.8,1,1.2,1.5])candidates.push({lambda,temperature,beta,tuning:evaluate(tune,beta,temperature)});}
candidates.sort((a,b)=>a.tuning.log_loss-b.tuning.log_loss);const selected=candidates[0],heldout=evaluate(test,selected.beta,selected.temperature);
const baselineBeta=featureNames.map((_,i)=>i===0?scales[0]:0),baselineTemps=[.8,1,1.2,1.5].map(temperature=>({temperature,tuning:evaluate(tune,baselineBeta,temperature)})).sort((a,b)=>a.tuning.log_loss-b.tuning.log_loss);
const baseline=evaluate(test,baselineBeta,baselineTemps[0].temperature);
const report={baseline:{name:'枠別1着率のみ',temperature:baselineTemps[0].temperature,heldout:baseline},delta_log_loss:heldout.log_loss-baseline.log_loss,kind:'RETROSPECTIVE_TEMPORAL_HOLDOUT',training_races:train.length,tuning_from:tuneStart,test_from:testStart,lambda:selected.lambda,temperature:selected.temperature,tuning:selected.tuning,heldout,
 note:'結果アーカイブからの時系列検証。実運用の締切前保存を証明する成績ではありません。スタート順位は正常な6艇のSTを順位化し、同値は平均順位。'};
const model={schema_version:3,engine_version:contextMode?CONTEXT_ANNUAL_ENGINE:venueMode?VENUE_ANNUAL_ENGINE:ANNUAL_ENGINE,name:contextMode?'直近1年・選手履歴＋場別・直前条件モデル v3.2':venueMode?'直近1年・選手履歴＋場別傾向モデル v3.1':'直近1年・選手履歴モデル v3',status:'HISTORICAL_VALIDATED',trained_from:manifest.from,trained_through:manifest.through,
 coefficients_trained_through:manifest.through,created_at:new Date().toISOString(),feature_names:featureNames,coefficients:selected.beta,means,scales,temperature:selected.temperature,profiles,
 coverage:{from:manifest.from,through:manifest.through,days:365,races:races.length,players:Object.keys(profiles.players).length,failures:0,excluded_races:manifest.excluded_races?.length||0},validation:report};
model.id='annual-v3-'+crypto.createHash('sha256').update(JSON.stringify(model)).digest('hex');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(model)+'\n');
fs.writeFileSync(path.join(path.dirname(output),'validation.json'),JSON.stringify(report,null,2)+'\n');
console.log('::notice title=Annual model validation::'+JSON.stringify({coverage:model.coverage,validation:report,bytes:fs.statSync(output).size,id:model.id}));
