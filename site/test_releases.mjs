import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {readReleases,validateReleases,renderReleases} from './releases.mjs';import {checkReleaseNotes} from './check-release-notes.mjs';import {publicationApproved} from './check-approval.mjs';
const release=version=>({version,date:'2026-10-23',title:'Feature',changes:['User-facing change']});
test('履歴は版の重複・日付不正・空の変更点を拒否し、表示内容をHTMLとして実行させない',()=>{
 const data=readReleases();assert.ok(data.releases.length>=7);assert.match(renderReleases(data),/55,477/);
 const original=JSON.stringify(data);assert.doesNotMatch(renderReleases(data),/日本時間/);assert.equal(JSON.stringify(data),original);
 for(const bad of [{...release('1.0.0'),date:'2026-02-30'},{...release('1.0.0'),changes:[]},{...release('1.0.0'),notes:'invalid'}])assert.throws(()=>validateReleases({schema_version:1,releases:[bad]}));
 assert.throws(()=>validateReleases({schema_version:1,releases:[release('1.0.0'),release('1.0.0')]}));
 assert.throws(()=>validateReleases({schema_version:1,releases:[release('1.0.0'),release('1.1.0')]}));
 assert.match(renderReleases({schema_version:1,releases:[{...release('1.0.0'),changes:['<script>alert(1)</script>']}]}),/&lt;script&gt;/);
});
test('コード変更は履歴の追記が必要で、既存の書換・削除は拒否し、定期データ更新は対象外にする',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boatrace-notes-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');fs.mkdirSync(path.join(dir,'site/public'),{recursive:true});fs.mkdirSync(path.join(dir,'.github'));
 const file=path.join(dir,'site/releases.json'),initial={schema_version:1,releases:[release('1.0.0')]},write=data=>fs.writeFileSync(file,JSON.stringify(data)),commit=()=>{git('add','.');git('commit','-qm','Update');return git('rev-parse','HEAD');};
 fs.mkdirSync(path.join(dir,'models/annual'),{recursive:true});const modelFile=path.join(dir,'models/annual/current.json');fs.writeFileSync(modelFile,JSON.stringify({coefficients:[1],profiles:{samples:10}}));
 write(initial);fs.writeFileSync(path.join(dir,'site/public/app.mjs'),'original');const base=commit();
 fs.writeFileSync(path.join(dir,'site/public/app.mjs'),'changed');commit();assert.throws(()=>checkReleaseNotes({directory:dir,base}),/追記が必要/);
 // The publication gate must reject a runtime even if its commit was approved without a new note.
 let reviewed=git('rev-parse','HEAD');fs.writeFileSync(path.join(dir,'.github/publication.json'),JSON.stringify({approved:true,reviewed_commit:reviewed}));commit();assert.throws(()=>publicationApproved(dir),/追記が必要/);
 write({schema_version:1,releases:[release('1.1.0'),...initial.releases]});reviewed=commit();fs.writeFileSync(path.join(dir,'.github/publication.json'),JSON.stringify({approved:true,reviewed_commit:reviewed}));commit();assert.equal(publicationApproved(dir),true);assert.equal(checkReleaseNotes({directory:dir,base}).added,1);
 write({schema_version:1,releases:[release('1.1.0'),{...initial.releases[0],title:'rewritten'}]});commit();assert.throws(()=>checkReleaseNotes({directory:dir,base}),/書換/);
 write(initial);fs.writeFileSync(path.join(dir,'site/public/app.mjs'),'original');fs.mkdirSync(path.join(dir,'models/annual'),{recursive:true});fs.writeFileSync(modelFile,JSON.stringify({coefficients:[1],profiles:{samples:20}}));commit();assert.equal(checkReleaseNotes({directory:dir,base}).added,0);
 fs.writeFileSync(modelFile,JSON.stringify({coefficients:[2],profiles:{samples:20}}));commit();assert.throws(()=>checkReleaseNotes({directory:dir,base}),/追記が必要/);
 fs.writeFileSync(modelFile,JSON.stringify({coefficients:[1],profiles:{samples:20}}));
 fs.mkdirSync(path.join(dir,'tools/site'),{recursive:true});fs.writeFileSync(path.join(dir,'tools/site/annual_history.py'),'changed acquisition');commit();assert.throws(()=>checkReleaseNotes({directory:dir,base}),/追記が必要/);
});
