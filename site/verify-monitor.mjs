// Read-only post-deployment smoke check; no dispatch or official data request.
import assert from 'node:assert/strict';
const endpoint='https://boatrace-odds.kazu80504.workers.dev/v1/health';
const until=Date.now()+Number(process.env.MONITOR_WAIT_MS||0);
let previous='';
while(true){
 try{
  const response=await fetch(endpoint,{signal:AbortSignal.timeout(15000),redirect:'error'});
  assert.equal(response.status,200);
  const report=await response.json();
  const digest=JSON.stringify(report);
  if(digest!==previous){console.log('::notice title=Workflow monitor::'+digest);previous=digest;}
  assert.equal(report.schema_version,1);
  assert.equal(report.recovery_configured,true,'Dedicated recovery credential not configured');
  assert.ok(Date.now()-Date.parse(report.checked_at)<30*60000,'Monitor observation is stale');
  assert.equal(report.workflows.length,3);
  assert.ok(report.workflows.every(r=>['OK','RUNNING','OUTSIDE_SCHEDULE'].includes(r.status)),'Pending recovery or unhealthy workflow');
  console.log('::notice title=Monitor verification::Independent monitor and authenticated recovery are operational');break;
 }catch(error){if(Date.now()>=until)throw error;await new Promise(resolve=>setTimeout(resolve,30000));}
}
