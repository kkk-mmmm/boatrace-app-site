// Autonomous authorization is limited to a validated coefficient update + its generated note.
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import crypto from 'node:crypto';
import {coefficientRelease} from './coefficient-release.mjs';import {validateReleases} from './releases.mjs';import {publicationApproved} from './check-approval.mjs';
import {adoptionAllowed,coefficientId} from '../tools/prediction/compare_monthly.mjs';
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function approveModelUpdate(directory=process.cwd()){
 const git=args=>execFileSync('git',args,{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024}).trim();
 const approvalFile=path.join(directory,'.github/publication.json'),approval=JSON.parse(fs.readFileSync(approvalFile));
 if(approval.approved!==true||!/^[a-f0-9]{40}$/.test(approval.reviewed_commit||''))throw Error('承認済みランタイムが必要です');
 git(['merge-base','--is-ancestor',approval.reviewed_commit,'HEAD']);
 const dirty=git(['diff','--name-only','HEAD','--','site','tools','app','cloudflare','.github',':(exclude).github/publication.json']);
 if(dirty)throw Error('未コミットのコード・履歴を自動承認できません');
 const active=JSON.parse(fs.readFileSync(path.join(directory,'models/annual/current.json'))),old=JSON.parse(git(['show',approval.reviewed_commit+':models/annual/current.json']));
 if(publicationApproved(directory)&&coefficientId(active)===coefficientId(old))return false;
 const changes=git(['diff','--name-only',approval.reviewed_commit,'HEAD','--','site','tools','app','cloudflare','.github',':(exclude).github/publication.json',':(exclude)site/releases.json']);
 if(changes)throw Error('係数更新でコードの公開承認を変更できません');
 const before=validateReleases(JSON.parse(git(['show',approval.reviewed_commit+':site/releases.json']))),after=validateReleases(JSON.parse(fs.readFileSync(path.join(directory,'site/releases.json'))));
 if(after.releases.length!==before.releases.length+1||JSON.stringify(after.releases.slice(1))!==JSON.stringify(before.releases))throw Error('生成済み係数更新履歴1件だけが対象です');
 const entry=after.releases[0],month=entry.coefficient_update?.month;if(!/^\d{4}-\d{2}$/.test(month||''))throw Error('月次更新の識別がありません');
 const folder=path.join(directory,'models/monthly-candidates',month),decision=JSON.parse(fs.readFileSync(path.join(folder,'decision.json'))),record=JSON.parse(fs.readFileSync(path.join(folder,'review.json'))),candidateFile=path.join(folder,'current.json');
 const candidate=JSON.parse(fs.readFileSync(candidateFile));
 if(decision.month!==month||decision.status!=='ADOPTED'||!adoptionAllowed(decision.comparison)||decision.candidate_sha256!==hash(candidateFile)||record.model_sha256!==hash(candidateFile)||record.validation_sha256!==hash(path.join(folder,'validation.json'))
  ||coefficientId(active)!==coefficientId(candidate)||coefficientId(old)!==decision.comparison.active_coefficient_id||coefficientId(candidate)!==decision.comparison.candidate_coefficient_id
  ||JSON.stringify(entry)!==JSON.stringify(coefficientRelease(decision,before.releases[0].version)))throw Error('検証済み係数・比較結果・更新履歴が一致しません');
 fs.writeFileSync(approvalFile,JSON.stringify({approved:true,reviewed_commit:git(['rev-parse','HEAD'])},null,2)+'\n');return true;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log('approval_updated='+approveModelUpdate());}catch(e){console.error(e.message);process.exitCode=1;}}
