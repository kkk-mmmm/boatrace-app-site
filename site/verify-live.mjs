import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
process.on('uncaughtException',error=>{
 const message=String(error.stack || error).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');
 console.error('::error title=Public site verification::'+message);process.exit(1);
});
const output=path.resolve(process.env.SITE_VERIFY_OUTPUT || '/tmp/boatrace-public-check');fs.mkdirSync(output,{recursive:true});
const base='https://kkk-mmmm.github.io/boatrace-app-site/';
const get=async path=>{const response=await fetch(new URL(path,base),{signal:AbortSignal.timeout(20000),cache:'no-store'});assert.equal(response.status,200,path);return response;};
const current=await(await get('data/current.json')).json();
assert.equal(current.date,new Date(Date.now()+9*3600000).toISOString().slice(0,10));
assert.equal(current.venues.length,24);assert.equal(new Set(current.venues.map(v=>v.code)).size,24);
const html=await(await get('')).text();assert.ok(html.includes('BOATRACE NOTE'));
assert.ok((await get('style.css')).headers.get('content-type').includes('text/css'));
await get('app.mjs');await get('view.mjs');
const venues=[];
for(const venue of current.venues){
 const data=await(await get(`data/venues/${venue.code}.json`)).json();
 assert.equal(data.venue_code,venue.code);assert.equal(data.date,current.date);
 assert.ok(data.races.every(r=>r.date===data.date&&r.venue_code===venue.code));
 assert.ok(data.races.every(r=>r.items.length===0||r.items.length===10));
 venues.push(data);
}
const now=Date.now(),fresh=v=>['OK','PARTIAL'].includes(v.update.status)&&now-Date.parse(v.update.last_success_at)<=600000;
const available=venues.filter(fresh).flatMap(venue=>venue.races.map(race=>({venue,race})))
 .filter(({race:r})=>r.items.length===10&&r.odds?.items?.length>=10&&now-Date.parse(r.odds.fetched_at)<=540000&&Date.parse(r.deadline_at)>now+60000)
 .sort((a,b)=>Date.parse(b.race.odds.fetched_at)-Date.parse(a.race.odds.fetched_at));
assert.ok(available.length,'最新出走表・予想・オッズがそろう場が必要です');
const {venue:candidate,race}=available[0];
const cdp='http://127.0.0.1:9222',page=await(await fetch(cdp+'/json/new?about:blank',{method:'PUT'})).json();
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
let id=0;const pending=new Map(),errors=[];
ws.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.id){const p=pending.get(value.id);pending.delete(value.id);value.error?p.reject(Error(value.error.message)):p.resolve(value.result);}else if(value.method==='Runtime.exceptionThrown')errors.push(value.params.exceptionDetails);});
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
const run=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
const wait=async expression=>{for(let n=0;n<200;n++){if(await run(expression))return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('画面待ち: '+expression);};
try{
 await send('Runtime.enable');await send('Page.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base+'?venue='+candidate.venue_code});
 await wait("document.querySelectorAll('#venue-select option').length===24 && document.querySelectorAll('[data-race]').length>0");
 await run(`document.querySelector('[data-race="${race.race_no}"]').click()`);
 await wait("document.querySelectorAll('.prediction-table tbody tr').length===10");
 assert.equal(await run("getComputedStyle(document.querySelector('.header')).display"),'flex');
 const label=await run("document.getElementById('model-label').textContent");assert.ok(label.includes('固定式')&&label.includes('未適用'));
 const probabilityRows=await run("document.querySelectorAll('.prediction-table tbody tr').length");
 await run("document.getElementById('value-tab').click()");
 const valueRows=await run("document.querySelectorAll('.prediction-table tbody tr').length");assert.equal(valueRows,10);
 const metrics=await send('Page.getLayoutMetrics');
 fs.writeFileSync(path.join(output,'desktop.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:1440,height:metrics.cssContentSize.height,scale:1}})).data,'base64'));
 await run("document.getElementById('exhibition-tab').click()");assert.ok((await run("document.getElementById('exhibition-panel').textContent")).includes('展示と本番の差'));
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await run('scrollTo(0,0)');
 assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);
 const heights=await run("[...document.querySelectorAll('.opportunity-card')].map(element=>element.getBoundingClientRect().height)");assert.ok(heights.every(height=>height<=115));
 fs.writeFileSync(path.join(output,'mobile.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 assert.deepEqual(errors,[]);
 const report={checked_at:new Date().toISOString(),site_url:base,date:current.date,venues:venues.length,
  held:venues.filter(v=>v.meeting_status==='OPEN').length,not_held:venues.filter(v=>v.meeting_status==='NO_MEETING').length,
  fresh_venues:venues.filter(fresh).length,races:venues.reduce((n,v)=>n+v.races.length,0),
  predicted_races:venues.flatMap(v=>v.races).filter(r=>r.items.length===10).length,
  races_with_odds:venues.flatMap(v=>v.races).filter(r=>r.odds?.items?.length).length,
  browser:{venue_code:candidate.venue_code,race_no:race.race_no,model:label,probability_rows:probabilityRows,value_rows:valueRows,mobile_overflow:false,opportunity_card_heights:heights,errors}};
 fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log('::notice title=Published site verification::'+JSON.stringify(report));
}finally{ws.close();await fetch(cdp+'/json/close/'+page.id).catch(()=>{});}
