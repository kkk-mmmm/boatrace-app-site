import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {prepareVenue} from '../prerace/save_venue_prediction.mjs';import {raceId} from '../prerace/venues.mjs';
import {predict,validateModel} from './model.mjs';import {featuresFor} from './features.mjs';
export const modelFile = new URL('./model-v2.json',import.meta.url);
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const engineHash=digest(Buffer.concat(['features.mjs','model.mjs'].map(name=>fs.readFileSync(new URL(name,import.meta.url)))));
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
export function loadModel(file=modelFile){
  if(!fs.existsSync(file))return null;
  const bytes=fs.readFileSync(file),model=validateModel(JSON.parse(bytes));
  return {model,id:digest(bytes),bytes};
}
const fields=['lane','racer_id','name','class','national_win_rate','local_win_rate','motor_2rate','boat_2rate','avg_st','exhibition_time','exhibition_st','exhibition_course','exhibition_st_status','qualification_pressure'];
export function preRaceInput(request){
  const context={};for(const key of ['meeting_day','day_label','meeting_id','series_start','phase','race_label','grade','title'])context[key]=request.context?.[key] ?? null;
  context.phase ||= 'UNKNOWN';
  return {date:request.date,venue_code:request.venue_code || '01',race_no:request.race_no,deadline_at:request.deadline_at,context,
    entries:request.entries.map(e=>Object.fromEntries(fields.map(k=>[k,e[k] ?? null]))).sort((a,b)=>a.lane-b.lane)};
}
export function saveForecast(request,root,html,{bundle=loadModel(),now=Date.now(),exhibitionSource=null}={}){
  if(!bundle)return null;
  if(request.entries.some(e=>!/^\d{4}$/.test(e.racer_id || '')))return null;
  const base=prepareVenue(request,html,now);
  if(exhibitionSource && !(Date.parse(exhibitionSource.retrieved_at)<=now))throw Error('展示の取得時刻が未来・不正です');
  if(Date.parse(bundle.model.created_at)>now)throw Error('未来に作成された学習モデルは使用できません');
  const input=preRaceInput(request);
  for(const entry of input.entries)if(entry.qualification_pressure && Date.parse(entry.qualification_pressure.confirmed_at)>now)throw Error('未来の通過条件は使用できません');
  const output=predict(input,bundle.model);
  const fingerprint=digest(JSON.stringify({input,model_id:bundle.id}));
  const directory=path.join(root,base.race_id,fingerprint);
  if(fs.existsSync(directory)){
    verifyForecast(directory);
    return {version:fingerprint,record:read(path.join(directory,'prediction.json'))};
  }
  fs.mkdirSync(directory,{recursive:true});
  const record={schema_version:2,race_id:base.race_id,date:request.date,venue_code:input.venue_code,race_no:request.race_no,
    saved_at:new Date(now).toISOString(),deadline_at:request.deadline_at,input_fetched_at:request.input_fetched_at,input_source_url:request.input_source_url,
    exhibition_fetched_at:exhibitionSource?.retrieved_at || null,exhibition_source_url:exhibitionSource?.url || null,
    pre_race_input:input,model_id:bundle.id,model_name:bundle.model.name,model_status:bundle.model.status,
    engine_sha256:engineHash,model_trained_through:bundle.model.trained_through,validation:bundle.model.validation,
    items:output.items,features:output.features,classification:'PRERACE_LOCAL_RECORD_UNVERIFIED',result_not_seen_self_report:true};
  if(Date.now()>=Date.parse(request.deadline_at))throw Error('処理中に締切を過ぎました');
  const bytes=JSON.stringify(record,null,2)+'\n';
  fs.writeFileSync(path.join(directory,'prediction.json'),bytes,{flag:'wx'});
  fs.writeFileSync(path.join(directory,'model.json'),bundle.bytes,{flag:'wx'});
  const completed_at=new Date().toISOString();if(Date.parse(completed_at)>=Date.parse(record.deadline_at))throw Error('保存完了時に締切を過ぎました');
  fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify({completed_at,files:{'prediction.json':digest(bytes),'model.json':bundle.id}},null,2)+'\n',{flag:'wx'});
  return {version:fingerprint,record};
}
export function verifyForecast(directory){
  const record=read(path.join(directory,'prediction.json')),receipt=read(path.join(directory,'receipt.json'));
  for(const file of ['prediction.json','model.json'])if(digest(fs.readFileSync(path.join(directory,file)))!==receipt.files[file])throw Error('履歴予想の保存記録が変更されています');
  if(record.engine_sha256!==engineHash || record.model_id!==receipt.files['model.json']
    || record.race_id!==raceId(record.venue_code,record.date,record.race_no)
    || ['date','venue_code','race_no','deadline_at'].some(k=>record[k]!==record.pre_race_input[k])
    || Date.parse(read(path.join(directory,'model.json')).created_at)>Date.parse(record.saved_at)
    || (record.exhibition_fetched_at && !(Date.parse(record.exhibition_fetched_at)<=Date.parse(record.saved_at)))
    || record.result_not_seen_self_report!==true || !(Date.parse(record.input_fetched_at)<=Date.parse(record.saved_at)
    && Date.parse(record.saved_at)<=Date.parse(receipt.completed_at) && Date.parse(receipt.completed_at)<Date.parse(record.deadline_at)))throw Error('履歴予想の対象・版・事前保存時刻が不正です');
  const output=predict(record.pre_race_input,read(path.join(directory,'model.json')));
  if(JSON.stringify(output.items)!==JSON.stringify(record.items) || JSON.stringify(output.features)!==JSON.stringify(record.features))throw Error('履歴予想の再現が一致しません');
  return record;
}
export function readForecast(root,date,code,raceNo,version){
  if(!/^[a-f0-9]{64}$/.test(version || ''))throw Error('履歴予想の版が不正です');
  const record=verifyForecast(path.join(root,raceId(code,date,raceNo),version));
  if(record.date!==date || record.venue_code!==code || record.race_no!==raceNo)throw Error('履歴予想の対象レースが一致しません');
  return record;
}
export function publicAnalysis(request,bundle=loadModel()){
  if(!bundle || bundle.model.trained_through>=request.date)return {status:'NOT_READY',lanes:[]};
  return {status:bundle.model.status,model_id:bundle.id,trained_through:bundle.model.trained_through,
    lanes:featuresFor(preRaceInput(request),bundle.model.profiles).map(x=>({lane:x.lane,racer_id:x.racer_id,...x.history}))};
}
