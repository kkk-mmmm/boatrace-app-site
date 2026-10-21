import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {FEATURE_NAMES,ENGINE_VERSION,chronologicalExamples} from './features.mjs';
import {fit,lossAndGradient} from './model.mjs';
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export function train(races,{now=Date.now(),windowDays=90,iterations=220,featureIndices=FEATURE_NAMES.map((_,i)=>i)}={}){
  if(!races.length)throw Error('学習用の完了レースがありません');
  if(!Array.isArray(featureIndices)||new Set(featureIndices).size!==featureIndices.length||featureIndices.some(i=>!Number.isInteger(i)||i<0||i>=FEATURE_NAMES.length))throw Error('検証用の特徴量指定が不正です');
  const selectedFeatures=new Set(featureIndices);
  const today=new Date(now+9*3600000).toISOString().slice(0,10);
  if(races.some(r=>r.date>=today))throw Error('当日・未来の結果は日次学習へ使用できません');
  const ids=races.map(r=>`${r.date}/${r.venue_code}/${r.race_no}`);
  if(new Set(ids).size!==ids.length)throw Error('履歴レースが重複しています');
  const cutoff=races.map(r=>r.date).sort().at(-1);
  const from=new Date(Date.parse(cutoff+'T00:00:00Z')-(windowDays-1)*86400000).toISOString().slice(0,10);
  const history=races.filter(r=>r.date>=from);
  const {examples,profiles}=chronologicalExamples(history);
  const dates=[...new Set(examples.map(e=>e.date))].sort();
  if(dates.length<3 || examples.length<12)throw Error('時系列の学習・選択・検証を分けるには3日以上・12レース以上が必要です');
  const valStart=dates[Math.min(dates.length-2,Math.max(1,Math.floor(dates.length*.6)))];
  const testStart=dates[Math.min(dates.length-1,Math.max(dates.indexOf(valStart)+1,Math.floor(dates.length*.8)))];
  const trainSet=examples.filter(e=>e.date<valStart),validation=examples.filter(e=>e.date>=valStart&&e.date<testStart),test=examples.filter(e=>e.date>=testStart);
  const normalize=set=>{
    const rows=set.flatMap(e=>e.vectors),means=FEATURE_NAMES.map((_,j)=>rows.reduce((s,r)=>s+r[j],0)/rows.length);
    const scales=means.map((mean,j)=>Math.sqrt(rows.reduce((s,r)=>s+(r[j]-mean)**2,0)/rows.length)||1);
    const apply=data=>data.map(e=>({...e,x:e.vectors.map(row=>row.map((v,j)=>selectedFeatures.has(j)?(v-means[j])/scales[j]:0))}));
    return {means,scales,apply};
  };
  const norm=normalize(trainSet),training=norm.apply(trainSet),valid=norm.apply(validation);
  const zero=FEATURE_NAMES.map(()=>0);
  const candidates=[{lambda:null,coefficients:zero,validation_loss:lossAndGradient(valid,zero,{gradient:false}).loss}];
  for(const lambda of [.01,.1,1,10]){
    const coefficients=fit(training,lambda,iterations);
    candidates.push({lambda,coefficients,validation_loss:lossAndGradient(valid,coefficients,{gradient:false}).loss});
  }
  const best=[...candidates].sort((a,b)=>a.validation_loss-b.validation_loss)[0];
  const development=[...trainSet,...validation],finalNorm=normalize(development);
  const coefficients=best.lambda===null?zero:fit(finalNorm.apply(development),best.lambda,iterations);
  const heldout=finalNorm.apply(test),baselineLoss=lossAndGradient(heldout,zero,{gradient:false}).loss;
  const candidateLoss=lossAndGradient(heldout,coefficients,{gradient:false}).loss;
  const improvement=baselineLoss-candidateLoss;
  const paired=heldout.map(e=>lossAndGradient([e],zero,{gradient:false}).loss-lossAndGradient([e],coefficients,{gradient:false}).loss);
  const mean=paired.reduce((s,v)=>s+v,0)/paired.length;
  const se=paired.length>1?Math.sqrt(paired.reduce((s,v)=>s+(v-mean)**2,0)/(paired.length-1)/paired.length):Infinity;
  const eligible=test.length>=200&&new Set(test.map(e=>e.date)).size>=7&&improvement-1.96*se>0;
  const coverage={};
  for(const race of history){const phase=race.context?.phase || 'UNKNOWN';coverage[phase]=(coverage[phase]||0)+1;}
  const model={schema_version:2,engine_version:ENGINE_VERSION,name:'履歴補正モデル v2（検証中）',status:eligible?'VALIDATED_CANDIDATE':'EXPERIMENTAL',
    created_at:new Date(now).toISOString(),trained_from:from,trained_through:cutoff,window_days:windowDays,
    feature_names:FEATURE_NAMES,feature_subset:featureIndices.map(i=>FEATURE_NAMES[i]),means:finalNorm.means,scales:finalNorm.scales,coefficients,profiles,
    validation:{kind:'RETROSPECTIVE_WALK_FORWARD',timing_proof:'NOT_PROVEN_PRERACE',train_races:trainSet.length,selection_races:validation.length,test_races:test.length,
      selection_start:valStart,test_start:testStart,selected_lambda:best.lambda,baseline_log_loss:baselineLoss,candidate_log_loss:candidateLoss,
      improvement,paired_standard_error:Number.isFinite(se)?se:null,eligible_for_promotion:eligible,
      minimum_promotion_test_races:200,minimum_promotion_test_days:7,phase_coverage:coverage,
      note:'同日・未来の結果を特徴量に含めない過去データの再検証です。事前保存予想による将来検証とは区別します。少数の準優・優勝戦や勝負掛けを十分に検証したことを意味しません。'},
    learning_policy:{profiles:'daily_completed_races',coefficients:'weekly',window_days:windowDays,cycle_review:'monthly',promotion:'heldout_and_prospective_gate'}};
  return {model,candidates:candidates.map(({coefficients,...rest})=>rest),excluded_races:history.length-examples.length};
}
export function loadHistory(files){
  const races=[];const sources=[];
  for(const file of files){
    const bytes=fs.readFileSync(file),data=JSON.parse(bytes);
    if(data.kind!=='RETROSPECTIVE_HISTORY'||!Array.isArray(data.races))throw Error('過去履歴の形式が違います');
    for(const race of data.races){
      if(race.venue_code!==data.venue_code)throw Error('履歴の場コードが一致しません');
      for(const source of Object.values(race.sources || {})){
        if(digest(fs.readFileSync(source.evidence_file))!==source.sha256)throw Error('学習原資料の指紋が違います');
      }
      races.push(race);
    }
    sources.push({file:path.basename(file),sha256:digest(bytes),races:data.races.length});
  }
  return {races,sources};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [output,...files]=process.argv.slice(2);if(!output||!files.length)throw Error('使用方法: node tools/prediction/train.mjs 出力モデル.json 過去履歴.json ...');
    const {races,sources}=loadHistory(files),result=train(races);result.model.data_sources=sources;
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result.model,null,2)+'\n');
    console.log(JSON.stringify({validation:result.model.validation,candidates:result.candidates,excluded_races:result.excluded_races},null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
