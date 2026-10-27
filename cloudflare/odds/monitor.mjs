export const REPOSITORY='kkk-mmmm/boatrace-app-site';
const M=60_000;
const MONITOR_VERSION=2;
export const CHECK_INTERVAL=10*M;
export const WORKFLOWS=[
 {file:'update-pages.yml',label:'公開データ更新',period:5*M,grace:20*M,timeout:45*M,active:h=>h>=8&&h<22},
 {file:'verification-data.yml',label:'結果照合',period:60*M,grace:30*M,timeout:30*M,minute:15},
 {file:'daily-learning.yml',label:'日次履歴更新',period:1440*M,grace:90*M,timeout:90*M,hour:2,minute:10},
];
export function expectedTime(p,now){
 const local=new Date(now+9*3600_000);
 if(p.active&&!p.active(local.getUTCHours()))return null;
 if(p.hour!==undefined){const t=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),p.hour,p.minute)-9*3600_000;return now>=t?t:t-1440*M;}
 const offset=(p.minute||0)*M;return Math.floor((now-offset)/p.period)*p.period+offset;
}
export function assess(p,runs,now){
 const due=expectedTime(p,now);if(due===null)return {status:'OUTSIDE_SCHEDULE',due:null};
 const eligible=runs.filter(r=>r.head_branch==='main'&&['schedule','workflow_dispatch',...(p.file==='update-pages.yml'?['push']:[])].includes(r.event))
 .filter(r=>p.file!=='verification-data.yml'||r.event==='schedule'||r.display_title==='Verification data (hourly)')
 .filter(r=>Number.isFinite(Date.parse(r.created_at))&&Date.parse(r.created_at)<=now+M).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
 const success=eligible.find(r=>r.conclusion==='success'),last_success=success?.updated_at||null;
 const active=eligible.find(r=>['queued','in_progress','waiting','requested','pending'].includes(r.status));
 if(active)return {status:now-Date.parse(active.created_at)>p.timeout?'RUNNING_LATE':'RUNNING',due,last_success,run_id:active.id};
 const latest=eligible[0];
 if(latest&&['failure','timed_out','startup_failure'].includes(latest.conclusion)&&now-Date.parse(latest.created_at)<p.period+p.grace)return {status:'FAILED',due,last_success,run_id:latest.id};
 if(success&&now-Date.parse(success.created_at)<=p.period+p.grace)return {status:'OK',due,last_success,run_id:success.id};
 return {status:'LATE',due,last_success,run_id:latest?.id||null};
}
const reply=data=>Response.json(data,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export class WorkflowMonitor{
 constructor(ctx,env){this.storage=ctx.storage;this.env=env;this.serial=Promise.resolve();}
 async fetch(request){
  const u=new URL(request.url);
  if(u.pathname==='/status'&&request.method==='GET'){
   const report=await this.storage.get('report');
   return reply(report?{...report,...(Date.now()-Date.parse(report.checked_at)>3*CHECK_INTERVAL?{status:'STALE'}:{})}:{status:'NOT_CHECKED',checked_at:null});
  }
  if(u.pathname!=='/tick'||request.method!=='POST')return new Response('Not found',{status:404});
  const next=this.serial.then(()=>this.tick());this.serial=next.catch(()=>{});return reply(await next);
 }
 async github(path,options={}){
  const token=this.env.GITHUB_MONITOR_TOKEN;
  const r=await fetch(`https://api.github.com/repos/${REPOSITORY}/${path}`,{...options,redirect:'manual',signal:AbortSignal.timeout(15_000),headers:{Accept:'application/vnd.github+json','User-Agent':'funeyomi-schedule-monitor','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:`Bearer ${token}`} : {}),...(options.body?{'Content-Type':'application/json'}:{})}});
  if(!r.ok){const e=new Error(`GitHub HTTP ${r.status}`);e.status=r.status;const retry=Number(r.headers.get('retry-after')),reset=Number(r.headers.get('x-ratelimit-reset'))*1000;e.nextCheck=retry>0?Date.now()+Math.min(retry,86400)*1000:reset>Date.now()?Math.min(reset,Date.now()+86400_000):Date.now()+CHECK_INTERVAL;throw e;}
  return r.status===204?null:r.json();
 }
 async tick(now=Date.now()){
  if(await this.storage.get('monitor_version')===MONITOR_VERSION&&now<(await this.storage.get('next_check')||0))return await this.storage.get('report')||{status:'WAITING'};
  await this.storage.put('monitor_version',MONITOR_VERSION);
  await this.storage.put('next_check',now+CHECK_INTERVAL);
  const previous=await this.storage.get('report'),rows=[];
  for(const p of WORKFLOWS){try{
   const data=await this.github(`actions/workflows/${p.file}/runs?branch=main&per_page=50`);if(!Array.isArray(data.workflow_runs))throw Error('Invalid response');
   let row={workflow:p.file,label:p.label,...assess(p,data.workflow_runs,now)};
   const key=`retry:${p.file}`,retry=await this.storage.get(key)||{};
   if(['LATE','FAILED'].includes(row.status)){
    const incident=retry.resolved||!retry.started_at?{started_at:now,attempts:0}:retry;row.attempts=incident.attempts;
    if(!this.env.GITHUB_MONITOR_TOKEN)row.recovery='TOKEN_REQUIRED';
    else if(incident.attempts>=2)row.recovery='EXHAUSTED';
    else if(now<(incident.next_retry||0))row.recovery='BACKOFF';
    else{const workflow=await this.github(`actions/workflows/${p.file}`);
     if(workflow.state!=='active')row.recovery='WORKFLOW_DISABLED';
     else{incident.attempts++;row.attempts=incident.attempts;incident.next_retry=now+30*M*incident.attempts;await this.storage.put(key,incident);
      try{await this.github(`actions/workflows/${p.file}/dispatches`,{method:'POST',body:JSON.stringify({ref:'main',...(p.file==='verification-data.yml'?{inputs:{mode:'hourly'}}:{})})});row.recovery='DISPATCHED';row.attempts=incident.attempts;}
      catch(e){row.recovery=[401,403].includes(e.status)?'AUTH_BLOCKED':'DISPATCH_UNCONFIRMED';throw Object.assign(e,{row});}
     }
    }
   }else if(row.status==='OK')await this.storage.put(key,{resolved:true});
   else if(row.status==='RUNNING'&&retry.attempts)row.recovery='AWAITING_COMPLETION';
   rows.push(row);
  }catch(e){const old=previous?.workflows?.find(r=>r.workflow===p.file);rows.push({...e.row,workflow:p.file,label:p.label,status:'CHECK_FAILED',last_success:old?.last_success||null,error:e.status?`HTTP_${e.status}`:'UNAVAILABLE'});if(e.nextCheck){await this.storage.put('next_check',Math.max(now+CHECK_INTERVAL,e.nextCheck));break;}}}
  for(const p of WORKFLOWS)if(!rows.some(r=>r.workflow===p.file))rows.push({...previous?.workflows?.find(r=>r.workflow===p.file),workflow:p.file,label:p.label,status:'NOT_CHECKED'});
  if(!rows.some(r=>r.status==='CHECK_FAILED')&&rows.some(r=>['DISPATCHED','AWAITING_COMPLETION'].includes(r.recovery)))await this.storage.put('next_check',now+M);
  const report={schema_version:1,monitor_version:MONITOR_VERSION,checked_at:new Date(now).toISOString(),recovery_configured:Boolean(this.env.GITHUB_MONITOR_TOKEN),status:rows.every(r=>['OK','RUNNING','WAITING','OUTSIDE_SCHEDULE'].includes(r.status))?'OK':'ATTENTION',workflows:rows};
  await this.storage.put('report',report);console.log(JSON.stringify({event:'workflow_monitor',...report}));return report;
 }
}
