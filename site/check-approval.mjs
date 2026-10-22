import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkReleaseNotes} from './check-release-notes.mjs';
import {root} from './data.mjs';

export function publicationApproved(directory = root) {
  const approval = JSON.parse(fs.readFileSync(path.join(directory,'.github/publication.json'),'utf8'));
  if (approval.approved !== true || !/^[0-9a-f]{40}$/.test(approval.reviewed_commit || '')) return false;
  execFileSync('git',['merge-base','--is-ancestor',approval.reviewed_commit,'HEAD'],{cwd:directory});
  const changes = execFileSync('git',['diff','--name-only',approval.reviewed_commit,'HEAD','--','site','tools','app','cloudflare','.github',':(exclude).github/publication.json'],{cwd:directory,encoding:'utf8'}).trim();
  if(changes.length)return false;
  const parent=execFileSync('git',['rev-list','--parents','-n','1',approval.reviewed_commit],{cwd:directory,encoding:'utf8'}).trim().split(' ')[1];
  checkReleaseNotes({directory,base:parent});
  return true;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log('approved='+publicationApproved());}
  catch(error){console.error('公開確認を検証できません: '+error.message);process.exitCode=1;}
}
