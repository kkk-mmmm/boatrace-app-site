import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';import {Miniflare} from 'miniflare';
const directory=path.dirname(fileURLToPath(import.meta.url));
test('Workersの公式気象パースとSQLite移行・日付変更後の記録保持',{timeout:30000},async t=>{
 const source=`import {parseProgramHtml,programEnvironment} from './program.mjs';import {migrateHistory,saveEnvironment,saveHistoryRecord,rolloverHistory,savePublicArchive,publicArchiveRows} from './history-store.mjs';
 export class StorageProbe{constructor(ctx){this.ctx=ctx;migrateHistory(ctx.storage);}async fetch(){const storage=this.ctx.storage;const race={date:'2030-01-07',venue_code:'24',race_no:1,environment:{fetched_at:'2030-01-07T01:00:00Z',source_url:'https://www.boatrace.jp/',wind_speed_mps:0,wind_direction_code:null,wave_height_cm:0,tide:{status:'UNAVAILABLE'}}};await saveEnvironment(storage,race);await saveHistoryRecord(storage,'proposal',{date:race.date,venue_code:'24',race_no:1,token:'original'});const rows=Array.from({length:204},(_,i)=>({date:race.date,venue_code:String(Math.floor(i/12)+1).padStart(2,'0'),race_no:i%12+1,cohort:'WORKER_REPORTED_ONLY',padding:'x'.repeat(1000)}));await savePublicArchive(storage,rows);await storage.put('program:24-1',race);migrateHistory(storage);await rolloverHistory(storage,'2030-01-08');return Response.json({environment:[...storage.sql.exec('SELECT * FROM race_environment')],records:[...storage.sql.exec('SELECT * FROM verification_records')],archiveCount:(await publicArchiveRows(storage,'2030-01-07','2030-01-08')).length,programRemoved:!await storage.get('program:24-1')});}}
 export default{async fetch(request,env){if(new URL(request.url).pathname==='/db')return env.DB.get(env.DB.idFromName('test')).fetch(request);return Response.json(programEnvironment(await parseProgramHtml(await request.text()),{source_url:request.url,fetched_at:'2026-10-26T10:00:00Z'}));}};`;
 const output=await build({stdin:{contents:source,resolveDir:directory},format:'esm',platform:'browser',bundle:true,write:false});
 const mf=new Miniflare({modules:true,script:output.outputFiles[0].text,compatibilityDate:'2026-06-11',durableObjects:{DB:{className:'StorageProbe',useSQLite:true}}});t.after(()=>mf.dispose());
 const html=fs.readFileSync(new URL('../../tools/site/fixtures/context/beforeinfo-20261026-24-R12.html',import.meta.url),'utf8');
 const weather=await(await mf.dispatchFetch('https://example.test/weather',{method:'POST',body:html})).json();assert.equal(weather.wind_speed_mps,5);assert.equal(weather.wind_direction_code,11);assert.equal(weather.wave_height_cm,4);assert.equal(weather.air_temperature_c,21);assert.match(weather.measurement_label,/11R/);
 const db=await(await mf.dispatchFetch('https://example.test/db')).json();assert.equal(db.environment.length,1);assert.equal(db.environment[0].wind_speed_mps,0);assert.equal(db.records.length,1);assert.equal(JSON.parse(db.records[0].payload).token,'original');assert.equal(db.programRemoved,true);assert.equal(db.archiveCount,204);
});
test('独立監視DOをSQLite bindingで実行し、保存状態の読み取りはGitHubを再取得しない',{timeout:30000},async t=>{
 const source=`import {WorkflowMonitor} from './monitor.mjs';
 export class MonitorProbe extends WorkflowMonitor {async github(path){if(!path.includes('/runs?'))throw Error('Unexpected write');const now=new Date().toISOString();return {workflow_runs:[{id:42,head_branch:'main',event:'schedule',status:'completed',conclusion:'success',created_at:now,updated_at:now}]};}}
 export default{fetch(request,env){return env.MONITOR.get(env.MONITOR.idFromName('test')).fetch(request);}};`;
 const output=await build({stdin:{contents:source,resolveDir:directory},format:'esm',platform:'browser',bundle:true,write:false});
 const mf=new Miniflare({modules:true,script:output.outputFiles[0].text,compatibilityDate:'2026-06-11',durableObjects:{MONITOR:{className:'MonitorProbe',useSQLite:true}}});t.after(()=>mf.dispose());
 const first=await(await mf.dispatchFetch('https://internal/tick',{method:'POST'})).json();assert.equal(first.status,'OK');assert.equal(first.workflows.length,3);
 const status=await(await mf.dispatchFetch('https://internal/status')).json();assert.deepEqual(status,first);
 const repeated=await(await mf.dispatchFetch('https://internal/tick',{method:'POST'})).json();assert.deepEqual(repeated,first);
 assert.equal((await mf.dispatchFetch('https://internal/retry',{method:'POST'})).status,404);
});
test('Workers本体のfetchでGitHub監視・認証・復旧を実行し、リダイレクトを追従しない',{timeout:30000},async t=>{
 const source=`export {WorkflowMonitor} from './monitor.mjs';export default{fetch(request,env){return env.MONITOR.get(env.MONITOR.idFromName('test')).fetch(request);}};`;
 const output=await build({stdin:{contents:source,resolveDir:directory},format:'esm',platform:'browser',bundle:true,write:false});
 const calls=[];let redirect=false;
 const mf=new Miniflare({modules:true,script:output.outputFiles[0].text,compatibilityDate:'2026-06-11',bindings:{GITHUB_MONITOR_TOKEN:'test-only-token'},durableObjects:{MONITOR:{className:'WorkflowMonitor',useSQLite:true}},outboundService:async request=>{
  const u=new URL(request.url);assert.equal(u.origin,'https://api.github.com');assert.equal(request.headers.get('authorization'),'Bearer test-only-token');
  calls.push({url:request.url,method:request.method,body:request.method==='POST'?await request.json():null});
  if(redirect)return new Response(null,{status:302,headers:{Location:'https://untrusted.test/'}});
  if(request.method==='POST')return new Response(null,{status:204});
  return Response.json(u.pathname.endsWith('/runs')?{workflow_runs:[]}:{state:'active'});
 }});t.after(()=>mf.dispose());
 const report=await(await mf.dispatchFetch('https://internal/tick',{method:'POST'})).json();
 assert.equal(report.recovery_configured,true);assert.ok(report.workflows.filter(r=>r.status!=='OUTSIDE_SCHEDULE').every(r=>r.recovery==='DISPATCHED'));
 const posts=calls.filter(r=>r.method==='POST');assert.ok(posts.length>=2);assert.ok(posts.every(r=>r.body.ref==='main'));
 assert.equal(posts.find(r=>r.url.includes('verification-data')).body.inputs.mode,'hourly');
 const count=calls.length;await mf.dispatchFetch('https://internal/status');assert.equal(calls.length,count);
 // A new object has no cooldown and tests the real Workers redirect implementation.
 redirect=true;const second=await mf.getDurableObjectNamespace('MONITOR');
 const blocked=await(await second.get(second.idFromName('redirect-test')).fetch('https://internal/tick',{method:'POST'})).json();
 assert.equal(blocked.workflows[0].status,'CHECK_FAILED');assert.equal(blocked.workflows[0].error,'HTTP_302');
});
