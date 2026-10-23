import fs from 'node:fs';
import {raceStatus} from './public/view.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {validateLiveOdds,applyLiveOdds,proposalRace} from './public/odds-live.mjs';
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
await get('odds-live.mjs');
const oddsConfig=await(await get('data/odds-config.json')).json();
assert.equal(oddsConfig.interval_seconds,60);
let workerOdds=null;
if(oddsConfig.api_url) {
 assert.equal(oddsConfig.api_url,'https://boatrace-odds.kazu80504.workers.dev/v1/odds');
 assert.ok(html.includes(new URL(oddsConfig.api_url).origin),'CSPにWorkerの接続先が必要です');
 const url=new URL(oddsConfig.api_url);url.searchParams.set('date',current.date);
 const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(20000),headers:{Origin:'https://kkk-mmmm.github.io'}});
 assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'https://kkk-mmmm.github.io');
 workerOdds=validateLiveOdds(await response.json(),current.date);
 assert.ok(Array.isArray(workerOdds.featured_races),'全場の厳選候補が必要です');
 assert.notEqual(workerOdds.update.status,'FAILED');assert.equal(workerOdds.interval_seconds,60);
}
const venues=[];
for(const venue of current.venues){
 const data=await(await get(`data/venues/${venue.code}.json`)).json();
 assert.equal(data.venue_code,venue.code);assert.equal(data.date,current.date);
 assert.ok(data.races.every(r=>r.date===data.date&&r.venue_code===venue.code));
 assert.ok(data.races.every(r=>r.items.length===0||r.items.length===10));
 venues.push(workerOdds?applyLiveOdds(data,workerOdds):data);
}
const now=Date.now(),fresh=v=>['OK','PARTIAL'].includes(v.update.status)&&now-Date.parse(v.update.last_success_at)<=600000;
const available=venues.filter(fresh).flatMap(venue=>venue.races.map(race=>({venue,race})))
 .filter(({race:r})=>r.items.length===10&&r.odds?.items?.length>=10&&now-Date.parse(r.odds.fetched_at)<=540000&&Date.parse(r.deadline_at)>now+4*60000)
 .sort((a,b)=>Date.parse(b.race.odds.fetched_at)-Date.parse(a.race.odds.fetched_at));
const preserved=venues.flatMap(venue=>venue.races.filter(race=>proposalRace(race,now)!==race).map(race=>({venue,race})));
const reference=venues.flatMap(venue=>venue.races.filter(race=>race.items.length===10).map(race=>({venue,race})));
const chosen=available[0] || preserved[0] || reference[0];
const morning=!chosen && new Date(now+9*3600000).getUTCHours()<7;assert.ok(chosen || morning,'日中に保存済み予想を確認できません');
const {venue:candidate,race}=chosen || {venue:venues.find(v=>v.meeting_status==='OPEN')||venues[0],race:null};
const savedProposal=race?proposalRace(race,now)!==race:false;
const expectedValueRows=race&&(savedProposal || raceStatus(race,candidate,now).currentOdds && Date.parse(race.deadline_at)-now>180000)?10:0;
const cdp='http://127.0.0.1:9222',page=await(await fetch(cdp+'/json/new?about:blank',{method:'PUT'})).json();
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
let id=0;const pending=new Map(),errors=[];
ws.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.id){const p=pending.get(value.id);pending.delete(value.id);value.error?p.reject(Error(value.error.message)):p.resolve(value.result);}else if(value.method==='Runtime.exceptionThrown')errors.push(value.params.exceptionDetails);});
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
const run=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
const wait=async expression=>{for(let n=0;n<200;n++){if(await run(expression))return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('画面待ち: '+expression);};
try{
 await send('Runtime.enable');await send('Page.enable');
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`{
  const nativeFetch=window.fetch.bind(window);window.__cloudflareReads=[];
  window.fetch=async(input,options)=>{
   const response=await nativeFetch(input,options),url=new URL(String(input),location.href);
   if(url.origin==='https://boatrace-odds.kazu80504.workers.dev'&&url.pathname==='/v1/odds'){
    const data=await response.clone().json();window.__cloudflareReads.push({status:response.status,cache:options?.cache,date:data.date,served_at:data.served_at,venue:url.searchParams.get('venue')});
   }
   return response;
  };
 }`});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base+'?venue='+candidate.venue_code});
 if(morning){
  await wait("document.querySelectorAll('#venue-select option').length===24 && document.querySelector('.empty h3')");
  assert.equal(await run("document.querySelectorAll('.prediction-table tbody tr').length"),0);
  assert.ok((await run("document.getElementById('current-date').textContent")).includes(current.date));
  assert.equal(await run("getComputedStyle(document.querySelector('.header')).display"),'flex');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);assert.deepEqual(errors,[]);
  const report={checked_at:new Date().toISOString(),site_url:base,date:current.date,mode:'MORNING_WAIT',venues:venues.length,
   annual_model:workerOdds?.annual_model,initial_collection_hour_jst:7,browser:{prediction_rows:0,empty_state:await run("document.querySelector('.empty h3').textContent"),mobile_overflow:false,errors},
   live_prediction_verified:false,note:'朝の初回取得前。前日の予想やサンプルを当日の予想として表示していません。'};
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log('::notice title=Published site verification::'+JSON.stringify(report));
 }else{
 await wait("document.querySelectorAll('#venue-select option').length===24 && document.querySelectorAll('[data-race]').length>0");
 await run(`document.querySelector('[data-race="${race.race_no}"]').click()`);
 await wait("document.querySelectorAll('.prediction-table tbody tr').length===10");
 if(workerOdds)assert.ok((await run("document.getElementById('odds-status').textContent")).includes('1分'));
 assert.equal(await run("getComputedStyle(document.querySelector('.header')).display"),'flex');
 const label=await run("document.getElementById('model-label').textContent"),displayed=proposalRace(race,now);
 assert.equal(label,displayed.model_validation?.selected_lambda===null?'固定式 / 履歴補正は未適用':displayed.model_name || '固定スコアモデル v1');
 const probabilityRows=await run("document.querySelectorAll('.prediction-table tbody tr').length");
 await run("document.getElementById('value-tab').click()");
 const valueRows=await run("document.querySelectorAll('.prediction-table tbody tr').length");assert.equal(valueRows,expectedValueRows);
 // Check the published scenario filters and full incremental list, using
 // probability order so unavailable market quotes cannot hide combinations.
 await run("document.getElementById('probability-tab').click();document.querySelector('[data-scenario=in]').click()");
 const scenarioIn=await run("document.querySelector('[data-scenario=in] strong').textContent");assert.notEqual(scenarioIn,'—');
 await run("document.getElementById('more-predictions').click()");
 const inRows=await run("document.querySelectorAll('.prediction-table tbody tr').length");assert.equal(inRows,20);
 assert.equal(await run("[...document.querySelectorAll('.prediction-table [data-combo]')].every(x=>x.dataset.combo.startsWith('1-'))"),true);
 assert.equal(await run("document.getElementById('more-predictions')"),null);
 await run("document.querySelector('[data-scenario=other]').click()");
 const scenarioOther=await run("document.querySelector('[data-scenario=other] strong').textContent");
 for(let n=0;n<9;n++)await run("document.getElementById('more-predictions').click()");
 const otherRows=await run("document.querySelectorAll('.prediction-table tbody tr').length");assert.equal(otherRows,100);
 assert.equal(await run("[...document.querySelectorAll('.prediction-table [data-combo]')].every(x=>!x.dataset.combo.startsWith('1-'))"),true);
 assert.equal(await run("new Set([...document.querySelectorAll('.prediction-table [data-combo]')].map(x=>x.dataset.combo)).size"),100);
 await run("document.querySelector('.prediction-table [data-combo]').click()");
 await run("document.querySelectorAll('.prediction-table [data-combo]')[1].click()");
 const selectedCombos=await run("[...document.querySelectorAll('.related-selection [data-combo]')].map(x=>x.dataset.combo)");assert.equal(selectedCombos.length,2);
 const relatedRows=await run("[...document.querySelectorAll('.related-bets tbody tr')].map(tr=>({combo:tr.querySelector('[data-combo]').dataset.combo,value:parseFloat(tr.children[3].textContent)}))");
 assert.ok(relatedRows.length<=10);assert.equal(new Set(relatedRows.map(r=>r.combo)).size,relatedRows.length);
 for(const row of relatedRows){assert.ok(!selectedCombos.includes(row.combo));assert.ok(selectedCombos.some(c=>c[0]===row.combo[0]));assert.ok(Number.isFinite(row.value));}
 for(let n=1;n<relatedRows.length;n++)assert.ok(relatedRows[n-1].value>=relatedRows[n].value);
 await run("document.getElementById('clear-bets').click();document.querySelector('[data-scenario=all]').click();document.getElementById('"+(expectedValueRows?"value":"probability")+"-tab').click();document.querySelector('.prediction-table [data-combo]').click()");
 const metrics=await send('Page.getLayoutMetrics');
 fs.writeFileSync(path.join(output,'desktop.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:1440,height:metrics.cssContentSize.height,scale:1}})).data,'base64'));
 await run("document.getElementById('exhibition-tab').click()");assert.ok((await run("document.getElementById('exhibition-panel').textContent")).includes('展示と本番の差'));
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await run('scrollTo(0,0)');
 assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);
 const heights=await run("[...document.querySelectorAll('.opportunity-card')].map(element=>element.getBoundingClientRect().height)");assert.ok(heights.every(height=>height<=115));
 fs.writeFileSync(path.join(output,'mobile.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 assert.deepEqual(errors,[]);
 const report={checked_at:new Date().toISOString(),site_url:base,date:current.date,venues:venues.length,
  odds_api_url:oddsConfig.api_url,odds_interval_seconds:oddsConfig.interval_seconds,worker_live_records:workerOdds?.races.filter(r=>r.status==='OK').length || 0,
  held:venues.filter(v=>v.meeting_status==='OPEN').length,not_held:venues.filter(v=>v.meeting_status==='NO_MEETING').length,
  fresh_venues:venues.filter(fresh).length,races:venues.reduce((n,v)=>n+v.races.length,0),
  predicted_races:venues.flatMap(v=>v.races).filter(r=>r.items.length===10).length,
  races_with_odds:venues.flatMap(v=>v.races).filter(r=>r.odds?.items?.length).length,
  browser:{venue_code:candidate.venue_code,race_no:race.race_no,model:label,probability_rows:probabilityRows,value_rows:valueRows,saved_proposal:savedProposal,saved_proposal_count:workerOdds?.proposals?.length || 0,scenario_in:scenarioIn,scenario_other:scenarioOther,in_rows:inRows,other_rows:otherRows,suji_rows:relatedRows.length,mobile_overflow:false,opportunity_card_heights:heights,errors}};
 fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log('::notice title=Published site verification::'+JSON.stringify(report));
 }
 const featuredGroups={};
 assert.equal(await run("document.querySelector('#opportunities-section h1').textContent"),'厳選レース');
 for(const tab of ['value','high','low']){
  await run(`document.querySelector('[data-featured-tab="${tab}"]').click()`);
  assert.equal(await run(`document.querySelector('[data-featured-tab="${tab}"]').getAttribute('aria-pressed')`),'true');
  const cards=await run("[...document.querySelectorAll('.opportunity-card')].map(x=>({key:x.dataset.opportunityVenue+'/'+x.dataset.opportunityRace,in:Number(x.dataset.inProbability),other:Number(x.dataset.otherProbability),value:Number(x.dataset.expectedValue),probability_text:x.querySelector('.opportunity-probabilities').textContent,height:x.getBoundingClientRect().height}))");
  assert.ok(cards.length<=3);
  for(const card of cards){
   assert.ok(Number.isFinite(card.in)&&Number.isFinite(card.other)&&Math.abs(card.in+card.other-1)<1e-6);
   assert.ok(card.probability_text.includes('イン逃げ想定')&&card.probability_text.includes('それ以外'));
   assert.ok(tab==='high'?card.in>=.7-1e-12:tab==='low'?card.in<=.3+1e-12:card.in>.3&&card.in<.7&&card.value>1);
   assert.ok(card.height<=115);
  }
  if(!cards.length)assert.ok((await run("document.getElementById('opportunities-content').textContent")).includes('この条件に合うレースはありません'));
  featuredGroups[tab]=cards;
 }
 const featuredKeys=Object.values(featuredGroups).flat().map(r=>r.key);assert.equal(new Set(featuredKeys).size,featuredKeys.length);
 assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);
 const featuredReport={checked_at:new Date().toISOString(),site_url:base,groups:featuredGroups,duplicates:0,errors};
 fs.writeFileSync(path.join(output,'featured-races.json'),JSON.stringify(featuredReport,null,2)+'\n');console.log('::notice title=Published featured races verification::'+JSON.stringify(featuredReport));
 await run("document.querySelector('[data-featured-tab=value]').click()");
 if(workerOdds){
  await wait("!document.getElementById('refresh-button').disabled && window.__cloudflareReads.length>0");
  const before=await run('window.__cloudflareReads.length');
  for(let n=1;n<=2;n++){
   await run("document.getElementById('refresh-button').click()");
   await wait(`!document.getElementById('refresh-button').disabled && window.__cloudflareReads.length===${before+n}`);
  }
  const reads=await run('window.__cloudflareReads.slice(-2)');
  for(const read of reads){assert.equal(read.status,200);assert.equal(read.cache,'no-store');assert.equal(read.date,current.date);assert.equal(read.venue,candidate.venue_code);}
  if(morning&&candidate.meeting_status==='OPEN'){
   assert.ok((await run("document.getElementById('update-status').textContent")).includes('初回取得待ち'));
   assert.equal(await run("document.getElementById('update-status').textContent.includes('取得に失敗')"),false);
  }
  assert.deepEqual(errors,[]);
  const refreshReport={checked_at:new Date().toISOString(),site_url:base,manual_refreshes:reads,waited_for_60_second_throttle:false,update_status:await run("document.getElementById('update-status').textContent"),errors};
  fs.writeFileSync(path.join(output,'manual-refresh.json'),JSON.stringify(refreshReport,null,2)+'\n');console.log('::notice title=Published manual refresh verification::'+JSON.stringify(refreshReport));
 }
 await run("document.getElementById('releases-tab').click()");
 await wait("!document.getElementById('releases-view').hidden && document.querySelectorAll('.release-card').length>=7");
 assert.equal(await run("document.querySelector('.venue-picker').hidden"),true);
 assert.equal(await run("document.querySelector('.update-bar').hidden"),true);
 assert.equal(await run("location.hash"),'#releases');
 assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);assert.deepEqual(errors,[]);
 const releaseReport={checked_at:new Date().toISOString(),url:base+'#releases',cards:await run("document.querySelectorAll('.release-card').length"),latest:await run("document.querySelector('.release-card .pill').textContent"),mobile_overflow:false,errors};
 fs.writeFileSync(path.join(output,'release-notes.json'),JSON.stringify(releaseReport,null,2)+'\n');console.log('::notice title=Published release notes verification::'+JSON.stringify(releaseReport));
}finally{ws.close();await fetch(cdp+'/json/close/'+page.id).catch(()=>{});}
