import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {loadHistory,train} from './train.mjs';import {chronologicalExamples,baseLogWorth} from './features.mjs';
import {verifyForecast} from './forecast.mjs';import {tripleItems,validateModel} from './model.mjs';
import {verify} from '../prerace/save_venue_prediction.mjs';import {raceId,venueDirectory} from '../prerace/venues.mjs';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function savedFor(race,cache,archiveRoot){
  const directory=venueDirectory(cache,race.date,race.venue_code),id=raceId(race.venue_code,race.date,race.race_no),records=[];
  const versions=path.join(directory,'predictions-v2',id);
  if(fs.existsSync(versions))for(const name of fs.readdirSync(versions)){
    if(!/^[a-f0-9]{64}$/.test(name))throw Error('予想版の名前が不正です');
    records.push(verifyForecast(path.join(versions,name)));
  }
  if(records.length)return records.sort((a,b)=>Date.parse(b.saved_at)-Date.parse(a.saved_at)||a.model_id.localeCompare(b.model_id))[0];
  let original=path.join(directory,'predictions',id);
  if(!fs.existsSync(original) && archiveRoot && race.venue_code==='01')original=path.join(archiveRoot,race.date,'prerace_snapshot/saved',id);
  if(!fs.existsSync(original))return null;
  verify(original);const saved=read(path.join(original,'prediction.json'));
  return {...saved,date:saved.input.date,venue_code:race.venue_code,race_no:saved.input.races[0].race_no,model_id:'legacy-v1',pre_race_input:{date:race.date,venue_code:race.venue_code,race_no:race.race_no,entries:saved.input.races[0].entries}};
}
export function evaluateSaved(races,cache,{now=Date.now(),archiveRoot=null}={}){
  const today=new Date(now+9*3600000).toISOString().slice(0,10),records=[];
  if(races.some(r=>r.date>=today))throw Error('日次照合には前日までの完了レースを指定してください');
  const ids=races.map(r=>`${r.date}/${r.venue_code}/${r.race_no}`);if(new Set(ids).size!==ids.length)throw Error('照合対象のレースが重複しています');
  for(const race of races){
    const item={date:race.date,venue_code:race.venue_code,race_no:race.race_no};
    try{
      const normal=race.entries.length===6&&race.entries.every(e=>Number.isInteger(e.finish)&&e.finish>=1&&e.finish<=6)&&new Set(race.entries.map(e=>e.finish)).size===6;
      if(!normal){records.push({...item,status:'EXCLUDED_ABNORMAL_RESULT'});continue;}
      const record=savedFor(race,cache,archiveRoot);
      if(!record){records.push({...item,status:'MISSING_PRERACE_FORECAST'});continue;}
      if(record.date!==race.date || (record.venue_code || '01')!==race.venue_code || Number(record.race_no ?? record.input?.races?.[0]?.race_no)!==race.race_no
        || Date.parse(record.deadline_at)!==Date.parse(race.deadline_at) || Date.parse(record.saved_at)>=Date.parse(race.deadline_at))throw Error('照合レースと事前予想の対象・締切が一致しません');
      for(const e of record.pre_race_input.entries){const actual=race.entries.find(x=>x.lane===e.lane);if(!actual || (e.racer_id&&e.racer_id!==actual.racer_id) || e.name!==actual.name)throw Error('予想と結果の選手が一致しません');}
      const combo=[...race.entries].sort((a,b)=>a.finish-b.finish).slice(0,3).map(e=>e.lane).join('-');
      const predicted=record.items.find(x=>x.combo===combo);if(!predicted||!(predicted.probability>0))throw Error('全120通りの事前予想がありません');
      const baseline=tripleItems(record.pre_race_input.entries.map(baseLogWorth)).find(x=>x.combo===combo);
      records.push({...item,status:'EVALUATED_LOCAL_PRERACE',model_id:record.model_id,saved_at:record.saved_at,combo,
        probability:predicted.probability,log_loss:-Math.log(predicted.probability),baseline_log_loss:-Math.log(baseline.probability),top10_hit:record.items.slice(0,10).some(x=>x.combo===combo)});
    }catch(error){records.push({...item,status:'INVALID_FORECAST',reason:error.message});}
  }
  const evaluated=records.filter(r=>r.status==='EVALUATED_LOCAL_PRERACE');
  const counts={};for(const r of records)counts[r.status]=(counts[r.status]||0)+1;
  return {schema_version:1,kind:'DAILY_SAVED_FORECAST_EVALUATION',generated_at:new Date(now).toISOString(),
    timing_proof:'LOCAL_RECORD_UNVERIFIED',note:'保存記録・原資料の整合性を検査します。外部による締切前の時刻証明とは区別します。事後の予想再作成はしません。',
    counts,evaluated_races:evaluated.length,log_loss:evaluated.length?evaluated.reduce((s,r)=>s+r.log_loss,0)/evaluated.length:null,
    baseline_log_loss:evaluated.length?evaluated.reduce((s,r)=>s+r.baseline_log_loss,0)/evaluated.length:null,records};
}
export function refreshProfiles(active,races,{now=Date.now()}={}){
  validateModel(active);const today=new Date(now+9*3600000).toISOString().slice(0,10);
  if(!races.length||races.some(r=>r.date>=today))throw Error('日次更新には前日までの完了結果が必要です');
  const ids=races.map(r=>`${r.date}/${r.venue_code}/${r.race_no}`);if(new Set(ids).size!==ids.length)throw Error('履歴レースが重複しています');
  const cutoff=races.map(r=>r.date).sort().at(-1);if(cutoff<active.trained_through)throw Error('履歴の更新日を後退させることはできません');
  const from=new Date(Date.parse(cutoff+'T00:00:00Z')-((active.window_days || 90)-1)*86400000).toISOString().slice(0,10);
  const window=races.filter(r=>r.date>=from),profiles=chronologicalExamples(window).profiles;
  const history_coverage={from:window.map(r=>r.date).sort()[0],through:cutoff,races:window.length,days:new Set(window.map(r=>r.date)).size,venues:[...new Set(window.map(r=>r.venue_code))].sort()};
  return {...active,created_at:new Date(now).toISOString(),trained_from:from,trained_through:cutoff,
    coefficient_trained_through:active.coefficient_trained_through || active.trained_through,profiles,history_coverage,
    learning_policy:{...active.learning_policy,last_profiles_updated_at:new Date(now).toISOString()}};
}
export function cycleRecommendation(races){
  const dates=[...new Set(races.map(r=>r.date))].sort(),meetings=new Set(races.filter(r=>r.context?.day_label==='最終日').map(r=>r.context.meeting_id).filter(Boolean));
  return {status:'INSUFFICIENT_COMPARISON_DATA',observed_days:dates.length,completed_meetings:meetings.size,
    recommended:{results_matching:'daily',profiles:'daily',coefficient_candidate:'weekly',window_days:90,cycle_comparison:'monthly'},
    candidates:['daily','7_days','30_days','meeting_end'],
    reason:'日次で結果と履歴を更新し、係数は週次候補を作ります。30日・節終了の優劣は未確定です。連続した30日以上かつ複数節の、同じ締切前保存予想による時系列比較が必要です。',
    automatic_promotion:false,promotion_requirements:['200件以上・7日以上の未使用検証で改善','同じ対象・入力で保存した候補と現行モデルの将来比較','外部で時刻が確認できる締切前記録','準優・優勝戦を含む区分別の悪化確認']};
}
export function dailyUpdate({files,cache,activeFile,output,now=Date.now(),trainCandidate=false}){
  const {races,sources}=loadHistory(files),active=read(activeFile),report=evaluateSaved(races,cache,{now});
  const refreshed=refreshProfiles(active,races,{now});refreshed.data_sources=sources;
  const policy=cycleRecommendation(races);fs.mkdirSync(output,{recursive:true});
  const write=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
  write('daily-evaluation.json',report);write('cycle-policy.json',policy);write('active-model.json',refreshed);
  if(trainCandidate){
    try{const candidate=train(races,{now}).model;candidate.data_sources=sources;write('weekly-candidate.json',candidate);}
    catch(error){if(!/3日以上/.test(error.message))throw error;write('weekly-candidate.json',{status:'INSUFFICIENT_DATA',reason:error.message});}
  }
  // A candidate never replaces coefficients here: held-out plus externally timed prospective evidence is required.
  return {evaluated_races:report.evaluated_races,counts:report.counts,profiles_through:refreshed.trained_through,coefficients_promoted:false,weekly_candidate:trainCandidate};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [cache,activeFile,output,...args]=process.argv.slice(2);const files=args.filter(x=>x!=='--train-candidate');
    if(!cache||!activeFile||!output||!files.length)throw Error('使用方法: node tools/prediction/daily.mjs cache モデル.json 出力先 履歴.json ... [--train-candidate]');
    console.log(JSON.stringify(dailyUpdate({files,cache,activeFile,output,trainCandidate:args.includes('--train-candidate')})));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
