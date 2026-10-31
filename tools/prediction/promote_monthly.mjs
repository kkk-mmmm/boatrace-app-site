import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {compareMonthly,coefficientId} from './compare_monthly.mjs';
import {coefficientRelease} from '../../site/coefficient-release.mjs';
import {validateReleases} from '../../site/releases.mjs';
const digest=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
export function promoteMonthly(directory,output,activeFile,releasesFile,now=Date.now()){
 const month=new Date(now+9*3600000).toISOString().slice(0,7),folder=path.join(output,month),decisionFile=path.join(folder,'decision.json'),candidateFile=path.join(folder,'current.json');
 const record=JSON.parse(fs.readFileSync(path.join(folder,'review.json')));
 if(record.month!==month||record.model_sha256!==digest(candidateFile)||record.validation_sha256!==digest(path.join(folder,'validation.json')))throw Error('月次候補の変更を検出しました');
 if(fs.existsSync(decisionFile)){const decision=JSON.parse(fs.readFileSync(decisionFile));if(decision.month!==month||decision.candidate_sha256!==record.model_sha256||!['ADOPTED','RETAINED'].includes(decision.status))throw Error('月次判定の整合性が不正です');return {status:decision.status,changed:false};}
 const active=JSON.parse(fs.readFileSync(activeFile)),candidate=JSON.parse(fs.readFileSync(candidateFile)),manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
 const date=new Date(now+9*3600000).toISOString().slice(0,10);if(manifest.through>=date||Date.parse(date)-Date.parse(manifest.through)>3*86400000||active.trained_through!==manifest.through)throw Error('前日までの新鮮な履歴更新が必要です');
 const comparison=compareMonthly(JSON.parse(fs.readFileSync(path.join(directory,'races.json'))),manifest,candidate,active);
 const decision={schema_version:1,month,status:comparison.accepted?'ADOPTED':'RETAINED',checked_at:new Date(now).toISOString(),candidate_sha256:record.model_sha256,comparison};
 if(comparison.accepted){
  const next={...active};const fields=['coefficients','means','scales','temperature','feature_names','engine_version'];
  fs.writeFileSync(path.join(folder,'previous-coefficients.json'),JSON.stringify(Object.fromEntries([...fields,'validation','coefficients_trained_through','coefficient_id'].map(k=>[k,active[k]])))+'\n',{flag:'wx'});
  for(const key of fields)next[key]=candidate[key];next.name=candidate.name;next.validation={...candidate.validation,automatic_comparison:comparison};next.coefficient_id=coefficientId(next);next.coefficients_trained_through=candidate.coefficients_trained_through||candidate.trained_through;next.created_at=new Date(now).toISOString();
  delete next.id;next.id='annual-v3-'+crypto.createHash('sha256').update(JSON.stringify(next)).digest('hex');
  const releases=JSON.parse(fs.readFileSync(releasesFile));releases.releases.unshift(coefficientRelease(decision,releases.releases[0].version));validateReleases(releases);
  fs.writeFileSync(activeFile,JSON.stringify(next)+'\n');fs.writeFileSync(path.join(path.dirname(activeFile),'validation.json'),JSON.stringify(next.validation,null,2)+'\n');fs.writeFileSync(releasesFile,JSON.stringify(releases,null,2)+'\n');
 }
 fs.writeFileSync(decisionFile,JSON.stringify(decision,null,2)+'\n',{flag:'wx'});return {status:decision.status,changed:comparison.accepted,comparison};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [directory,output,active,releases]=process.argv.slice(2);if(!releases)throw Error('履歴・月次候補・現行モデル・リリース履歴が必要です');console.log('::notice title=Automatic monthly decision::'+JSON.stringify(promoteMonthly(directory,output,active,releases)));}catch(e){console.error(e.message);process.exitCode=1;}
}
