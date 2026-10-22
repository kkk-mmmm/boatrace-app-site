import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {validateReleases,readReleases} from './releases.mjs';
export function checkReleaseNotes({directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),base=process.env.BASE_SHA}={}){
 const current=readReleases(path.join(directory,'site/releases.json'));
 if(!base||/^0+$/.test(base))return {version:current.releases[0].version,bootstrap:true};
 if(!/^[a-f0-9]{40}$/.test(base))throw Error('比較元のコミットが不正です');
 const git=args=>execFileSync('git',args,{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 git(['cat-file','-e',base+'^{commit}']);
 const existed=git(['ls-tree','--name-only',base,'--','site/releases.json']).trim();
 if(!existed)return {version:current.releases[0].version,bootstrap:true};
 const previous=validateReleases(JSON.parse(git(['show',base+':site/releases.json']))),added=current.releases.length-previous.releases.length;
 if(added<0||JSON.stringify(current.releases.slice(added))!==JSON.stringify(previous.releases))throw Error('既存のリリース履歴は削除・書換せず、新しい版を先頭へ追記してください');
 const files=git(['diff','--name-only',base,'HEAD']).trim().split('\n');
 const runtime=files.filter(f=>/^site\/public\//.test(f)||/^site\/(build|data|opportunities|collect-cloudflare|releases)\.mjs$/.test(f)||/^tools\/(prediction|prerace)\//.test(f)&&!/(test_|fixtures\/)/.test(f)||/^cloudflare\/odds\/(worker|program|official)\.mjs$/.test(f)||/^tools\/site\/(?!test_|review_|fixtures\/).*\.py$/.test(f)||/^site\/(odds-provider\.(mjs|json)|update\.mjs)$/.test(f)||/^cloudflare\/odds\/(wrangler\.jsonc|package(?:-lock)?\.json)$/.test(f)||/^(site\/release|\.github\/workflows)\/(update-pages|daily-learning)\.yml$/.test(f));
 if(runtime.length&&!added)throw Error('サイト・予想・取得処理を変更したため site/releases.json に新しい版の追記が必要です');
 return {version:current.releases[0].version,added,runtime_files:runtime.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(checkReleaseNotes()));}catch(e){console.error(e.message);process.exitCode=1;}}
