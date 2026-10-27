import test from 'node:test';
import assert from 'node:assert/strict';
import {assess,expectedTime,WORKFLOWS,WorkflowMonitor,CHECK_INTERVAL} from './monitor.mjs';
import worker from './worker.mjs';
const now=Date.parse('2026-10-27T10:50:00Z'),M=60000;
const run=(age,extra={})=>({id:1,head_branch:'main',event:'schedule',status:'completed',conclusion:'success',created_at:new Date(now-age*M).toISOString(),updated_at:new Date(now-age*M+M).toISOString(),...extra});
const store=()=>{const map=new Map();return {async get(k){return structuredClone(map.get(k));},async put(k,v){map.set(k,structuredClone(v));}};};
const monitor=(env={})=>new WorkflowMonitor({storage:store()},env);
const response=value=>Response.json(value);
test('periods, grace, Japan midnight, active hours and failure priority',()=>{
 const [pages,hourly,daily]=WORKFLOWS;
 assert.equal(assess(pages,[run(24)],now).status,'OK');
 assert.equal(assess(pages,[run(26)],now).status,'LATE');
 assert.equal(assess(pages,[],now).status,'LATE');
 assert.equal(assess(pages,[run(2,{conclusion:'failure'}),run(4)],now).status,'FAILED');
 assert.equal(assess(pages,[run(2,{head_branch:'evil'})],now).status,'LATE');
 assert.equal(assess(pages,[],Date.parse('2026-10-27T14:00Z')).status,'OUTSIDE_SCHEDULE');
 assert.equal(new Date(expectedTime(daily,Date.parse('2026-10-27T16:00Z'))).toISOString(),'2026-10-26T17:10:00.000Z');
 assert.equal(assess(hourly,[run(1,{event:'workflow_dispatch',display_title:'Verification data (capture)'})],now).status,'LATE');
 assert.equal(assess(hourly,[run(1,{event:'workflow_dispatch',display_title:'Verification data (hourly)'})],now).status,'OK');
 assert.equal(assess(pages,[run(46,{status:'in_progress',conclusion:null})],now).status,'RUNNING_LATE');
});
test('missing token reports recovery requirement and public GET never dispatches',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(u,o)=>{calls.push([u,o]);return response({workflow_runs:[]});});
 const m=monitor();const report=await m.tick(now);
 assert.equal(report.status,'ATTENTION');assert.equal(report.recovery_configured,false);
 assert.ok(report.workflows.every(r=>r.recovery==='TOKEN_REQUIRED'));
 await m.fetch(new Request('https://internal/status'));assert.equal(calls.length,3);
 await m.tick(now+M);assert.equal(calls.length,3);
});
test('bounded persisted recovery, main-only allowlist, cooldown and no duplicates after restart',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(u,o)=>{calls.push([u,o]);if(o.method==='POST')return new Response(null,{status:204});return response(u.includes('/runs?')?{workflow_runs:[]}:{state:'active'});});
 const m=monitor({GITHUB_MONITOR_TOKEN:'test-only-token'});
 let report=await m.tick(now);assert.ok(report.workflows.every(r=>r.recovery==='DISPATCHED'));assert.equal(await m.storage.get('next_check'),now+M);
 let posts=calls.filter(([,o])=>o.method==='POST');assert.equal(posts.length,3);
 for(const [u,o] of posts){assert.match(u,/repos\/kkk-mmmm\/boatrace-app-site\/actions\/workflows\/(update-pages|verification-data|daily-learning)\.yml\/dispatches$/);assert.equal(JSON.parse(o.body).ref,'main');}
 assert.deepEqual(JSON.parse(posts.find(([u])=>u.includes('verification-data'))[1].body).inputs,{mode:'hourly'});
 const restarted=new WorkflowMonitor({storage:m.storage},m.env);
 report=await restarted.tick(now+CHECK_INTERVAL);assert.ok(report.workflows.every(r=>r.recovery==='BACKOFF'));
 await restarted.tick(now+30*M);await restarted.tick(now+90*M);
 assert.equal(calls.filter(([,o])=>o.method==='POST').length,6);
 const last=await m.storage.get('report');assert.ok(last.workflows.every(r=>r.recovery==='EXHAUSTED'));
 assert.ok(!JSON.stringify(last).includes('test-only-token'));
});
test('running jobs are not duplicated; success resets incident',async t=>{
 t.mock.method(globalThis,'fetch',async()=>response({workflow_runs:[run(1,{status:'in_progress',conclusion:null})]}));
 const m=monitor({GITHUB_MONITOR_TOKEN:'test'});let report=await m.tick(now);assert.ok(report.workflows.every(r=>r.status==='RUNNING'));
 t.mock.method(globalThis,'fetch',async()=>response({workflow_runs:[run(1)]}));
 report=await m.tick(now+CHECK_INTERVAL);assert.ok(report.workflows.every(r=>r.status==='OK'));
 assert.deepEqual(await m.storage.get('retry:update-pages.yml'),{resolved:true});
});
test('disabled workflows and auth/rate-limit errors do not loop or expose remote error text',async t=>{
 let count=0;t.mock.method(globalThis,'fetch',async(u,o)=>{count++;assert.notEqual(o.method,'POST');return response(u.includes('/runs?')?{workflow_runs:[]}:{state:'disabled_manually'});});
 const m=monitor({GITHUB_MONITOR_TOKEN:'test'});assert.ok((await m.tick(now)).workflows.every(r=>r.recovery==='WORKFLOW_DISABLED'));
 t.mock.method(globalThis,'fetch',async()=>new Response('secret remote content',{status:403,headers:{'Retry-After':'3600'}}));
 const report=await m.tick(now+CHECK_INTERVAL);assert.equal(report.workflows[0].error,'HTTP_403');assert.equal(report.workflows[1].status,'NOT_CHECKED');assert.ok(!JSON.stringify(report).includes('secret'));
 const before=count;await m.tick(now+2*CHECK_INTERVAL);assert.equal(count,before);
});
test('ambiguous dispatch failure is persisted before send and backs off',async t=>{
 let posts=0;t.mock.method(globalThis,'fetch',async(u,o)=>{if(o.method==='POST'){posts++;throw Error('timeout');}return response(u.includes('/runs?')?{workflow_runs:[]}:{state:'active'});});
 const m=monitor({GITHUB_MONITOR_TOKEN:'test'});await m.tick(now);await m.tick(now+CHECK_INTERVAL);assert.equal(posts,3);
});
test('health endpoint read only and odds scheduling isolated from monitor failure',async()=>{
 let oddsStarted=false;const waits=[];
 const env={SITE_ORIGIN:'https://funeyomi.win',WORKFLOW_MONITOR:{idFromName:x=>x,get:()=>({fetch:async()=>{throw Error('unavailable');}})},ODDS:{idFromName:x=>x,get:()=>({fetch:async()=>{oddsStarted=true;return new Response('ok');}})}};
 assert.equal((await worker.fetch(new Request('https://worker/v1/health',{method:'POST'}),env)).status,405);
 assert.equal((await worker.fetch(new Request('https://worker/v1/health'),env)).status,503);
 await worker.scheduled({scheduledTime:now},env,{waitUntil:p=>waits.push(p)});
 const results=await Promise.allSettled(waits);assert.equal(oddsStarted,true);assert.equal(results.filter(r=>r.status==='rejected').length,1);
});

test('monitor upgrades recheck immediately without resetting exhausted recovery budgets',async t=>{
 t.mock.method(globalThis,'fetch',async(u,o)=>{assert.notEqual(o.method,'POST');return response({workflow_runs:[]});});
 const m=monitor({GITHUB_MONITOR_TOKEN:'test'});
 await m.storage.put('monitor_version',1);await m.storage.put('next_check',now+86400000);
 for(const p of WORKFLOWS)await m.storage.put(`retry:${p.file}`,{started_at:now-M,attempts:2});
 const report=await m.tick(now);assert.equal(report.monitor_version,2);assert.ok(report.workflows.every(r=>r.recovery==='EXHAUSTED'));
});
