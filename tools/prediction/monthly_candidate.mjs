import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function monthlyCandidate(directory,output,now=Date.now(),train=(source,target)=>execFileSync(process.execPath,[fileURLToPath(new URL('./train_annual.mjs',import.meta.url)),source,target,...(fs.existsSync('models/annual/current.json')&&JSON.parse(fs.readFileSync('models/annual/current.json')).engine_version==='annual-player-v3.1'?['--venue']:[])],{stdio:'inherit'})) {
 const month=new Date(now+9*3600000).toISOString().slice(0,7),destination=path.join(output,month);
 if(fs.existsSync(destination)){
  const record=JSON.parse(fs.readFileSync(path.join(destination,'review.json')));
  if(record.month!==month||record.status!=='AWAITING_REVIEW'||record.model_sha256!==hash(path.join(destination,'current.json'))||record.validation_sha256!==hash(path.join(destination,'validation.json')))throw Error('月次候補の保存内容が一致しません');
  return {month,created:false,status:record.status};
 }
 fs.mkdirSync(output,{recursive:true});const temporary=fs.mkdtempSync(path.join(output,'.candidate-'));
 try{
  train(directory,path.join(temporary,'current.json'));
  const model=JSON.parse(fs.readFileSync(path.join(temporary,'current.json'))),validation=JSON.parse(fs.readFileSync(path.join(temporary,'validation.json')));
  if(model.schema_version!==3||!model.id?.startsWith('annual-v3-')||!Number.isFinite(validation.heldout?.log_loss))throw Error('月次候補の検証結果がありません');
  fs.writeFileSync(path.join(temporary,'review.json'),JSON.stringify({month,status:'AWAITING_REVIEW',created_at:new Date(now).toISOString(),model_id:model.id,
   model_sha256:hash(path.join(temporary,'current.json')),validation_sha256:hash(path.join(temporary,'validation.json'))},null,2)+'\n');
  fs.renameSync(temporary,destination);return {month,created:true,status:'AWAITING_REVIEW'};
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(!process.argv[2]||!process.argv[3])throw Error('履歴フォルダと月次候補保存先が必要です');console.log('::notice title=Monthly coefficient candidate::'+JSON.stringify(monthlyCandidate(process.argv[2],process.argv[3])));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
