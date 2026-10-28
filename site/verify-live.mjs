import {branding} from './seo.mjs';
import {contact} from './info-pages.mjs';
import fs from 'node:fs';
import {raceStatus} from './public/view.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {validateLiveOdds,applyLiveOdds,proposalRace,resultComparison} from './public/odds-live.mjs';
process.on('uncaughtException',error=>{
 const message=String(error.stack || error).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');
 console.error('::error title=Public site verification::'+message);process.exit(1);
});
const output=path.resolve(process.env.SITE_VERIFY_OUTPUT || '/tmp/boatrace-public-check');fs.mkdirSync(output,{recursive:true});
const base=branding.base_url;
const get=async(path,options={})=>{const response=await fetch(new URL(path,base),{signal:AbortSignal.timeout(20000),cache:'no-store',...options});assert.equal(response.status,200,path);return response;};
const current=await(await get('data/current.json')).json();
assert.equal(current.date,new Date(Date.now()+9*3600000).toISOString().slice(0,10));
assert.equal(current.venues.length,24);assert.equal(new Set(current.venues.map(v=>v.code)).size,24);
const html=await(await get('')).text();assert.ok(html.includes('フネヨミ'));
assert.ok((await get('style.css')).headers.get('content-type').includes('text/css'));
await get('app.mjs');await get('view.mjs');
await get('odds-live.mjs');await get('development.mjs');
// Verify search metadata without relying on JavaScript rendering.
assert.ok(html.includes(`name="application-name" content="${branding.name}"`));
assert.ok(html.includes(`<title>${branding.name}</title>`));
assert.ok(html.includes(`property="og:site_name" content="${branding.name}"`));
const website=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'].filter(n=>n['@type']==='WebSite');
assert.equal(website.length,1);assert.equal(website[0].name,branding.name);assert.equal(website[0].url,base);assert.ok(website[0].alternateName.includes('フネヨミ'));
assert.equal(html.match(/<link rel="icon" href="([^"]+)" type="image\/svg\+xml">/)[1],html.match(/class="brand-icon" src="([^"]+)"/)[1]);
for(const [file,type] of [['favicon.svg','image/svg+xml'],['icon-192.png','image/png']]){
 const icon=await get(file,{headers:{'User-Agent':'Googlebot-Image/1.0'}});assert.ok(icon.headers.get('content-type').includes(type));assert.ok(!/noindex|noimageindex/i.test(icon.headers.get('x-robots-tag')||''));
 if(type==='image/png'){const bytes=Buffer.from(await icon.arrayBuffer());assert.equal(bytes.readUInt32BE(16),192);assert.equal(bytes.readUInt32BE(20),192);}
}
assert.ok((await(await get('robots.txt')).text()).includes('Allow: /'));

assert.ok(html.includes('<link rel="canonical" href="'+base+'">'));
if(new URL(base).pathname==='/')assert.ok((await(await get('robots.txt')).text()).includes(base+'sitemap.xml'));
const sitemap=await(await get('sitemap.xml')).text();assert.equal((sitemap.match(/<loc>/g)||[]).length,29);
for(const slug of ['about','guide','verification']){const page=await(await get(slug+'/')).text();assert.ok(page.includes(`<link rel="canonical" href="${base}${slug}/">`));assert.ok(page.includes('予想の見方'));if(slug==='about'){assert.ok(page.includes('フネヨミ運営者'));if(contact.verified){assert.ok(page.includes(`mailto:${contact.email}`));assert.ok(!page.includes('お問い合わせ用メールアドレスは準備中'));}}}
for(const file of ['favicon.svg','favicon-32.png','apple-touch-icon.png','social-card.png','site.webmanifest'])await get(file);
for(let i=1;i<=24;i++){const code=String(i).padStart(2,'0'),pageHtml=await(await get(`venues/${code}/`)).text();assert.ok(pageHtml.includes(`data-venue="${code}"`));assert.ok(pageHtml.includes(`<link rel="canonical" href="${base}venues/${code}/">`));assert.ok(pageHtml.includes('application/ld+json'));assert.equal(JSON.parse(pageHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'].some(n=>n['@type']==='WebSite'),false);}
console.log('::notice title=Published SEO verification::'+JSON.stringify({site_name:branding.name,website_home_only:true,favicon_brand_match:true,favicon_png_size:192,googlebot_image_access:true,pages:29,sitemap:true,favicon:true,ogp:true,structured_data:true}));
const oddsConfig=await(await get('data/odds-config.json')).json();
assert.equal(oddsConfig.interval_seconds,60);
let workerOdds=null;
if(oddsConfig.api_url) {
 assert.equal(oddsConfig.api_url,'https://boatrace-odds.kazu80504.workers.dev/v1/odds');
 assert.ok(html.includes(new URL(oddsConfig.api_url).origin),'CSPにWorkerの接続先が必要です');
 const url=new URL(oddsConfig.api_url);url.searchParams.set('date',current.date);
 const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(20000),headers:{Origin:new URL(branding.base_url).origin}});
 assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),new URL(branding.base_url).origin);
 workerOdds=validateLiveOdds(await response.json(),current.date);
 assert.ok(Array.isArray(workerOdds.featured_races),'全場の厳選候補が必要です');
 assert.notEqual(workerOdds.update.status,'FAILED');assert.equal(workerOdds.interval_seconds,60);
}
const deliveredModel=await(await get('data/player-model.json')).json(),gapProfile=deliveredModel.exhibition_st_profiles;
assert.ok(gapProfile?.paired_starts>0 && gapProfile.through<current.date,'照合済みの過去STが必要です');
if(workerOdds){console.log('::notice title=Live history delivery::'+JSON.stringify({annual_model:workerOdds.annual_model,update:workerOdds.update,served_at:workerOdds.served_at,public_gap_through:gapProfile.through,public_gap_starts:gapProfile.paired_starts}));assert.ok(workerOdds.annual_model?.exhibition_st?.paired_starts>0,'WorkerのST差プロファイル反映が必要です');}
const programs=workerOdds?.programs||[],exhibitionPrograms=programs.filter(p=>p.exhibition_fetched_at),pairedPrograms=programs.filter(p=>p.history?.lanes?.some(h=>h.exhibition_st_gap?.n));
if(deliveredModel.engine_version==='annual-player-v3.1'){
 assert.equal(workerOdds?.annual_model?.engine_version,'annual-player-v3.1','Workerへの場別モデル反映が必要です');
 assert.equal(workerOdds.annual_model.venue_profiles,24);
 const enriched=programs.filter(p=>p.history?.venue?.venue_code===p.venue_code),predicted=enriched.filter(p=>p.scores?.some(s=>s.history_components?.some(c=>c.label==='場・枠別1着傾向')));
 if(programs.some(p=>Date.parse(p.deadline_at)>Date.now()+180000&&p.probabilities?.length===120))assert.ok(predicted.length>0,'締切前の場別予想が必要です');
 const report={checked_at:new Date().toISOString(),engine:workerOdds.annual_model.engine_version,venue_profiles:24,enriched_programs:enriched.length,predicted_programs:predicted.length,comparison:deliveredModel.validation?.venue_comparison};
 console.log('::notice title=Published venue model verification::'+JSON.stringify({...report,comparison:report.comparison?{...report.comparison,daily:undefined}:null}));
 fs.writeFileSync(path.join(output,'venue-model.json'),JSON.stringify(report,null,2)+'\n');
}
if(programs.length)assert.ok(pairedPrograms.length>0,'選手ごとの展示ST差が必要です');
const exhibitionReport={checked_at:new Date().toISOString(),profile:{through:gapProfile.through,paired_starts:gapProfile.paired_starts,players:Object.keys(gapProfile.players).length},worker_profile:workerOdds?.annual_model?.exhibition_st,
 programs_with_exhibition:exhibitionPrograms.length,programs_with_st_gap:pairedPrograms.length,complete_exhibitions:exhibitionPrograms.filter(p=>p.exhibition_available).length,
 examples:pairedPrograms.slice(0,2).map(p=>({venue_code:p.venue_code,race_no:p.race_no,lanes:p.history.lanes.filter(h=>h.exhibition_st_gap?.n).map(h=>({lane:h.lane,...h.exhibition_st_gap}))}))};
fs.writeFileSync(path.join(output,'exhibition.json'),JSON.stringify(exhibitionReport,null,2)+'\n');console.log('::notice title=Published exhibition verification::'+JSON.stringify(exhibitionReport));
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
 if(workerOdds)assert.match(await run("document.getElementById('odds-status').textContent"),/^オッズ：(取得済み|未取得)$/);
 assert.equal(await run("getComputedStyle(document.querySelector('.header')).display"),'flex');
 const label=await run("document.getElementById('model-label').textContent"),displayed=proposalRace(race,now);
 assert.equal(label,displayed.model_validation?.selected_lambda===null?'固定式 / 履歴補正は未適用':displayed.model_name || '固定スコアモデル v1');
 // The fixed refresh action must also work before switching to mobile emulation.
 await run("document.querySelector('.prediction-table').scrollIntoView({block:'center',behavior:'instant'})");
 await wait("!document.getElementById('mobile-race-context').hidden && !document.getElementById('mobile-refresh-button').disabled");
 assert.equal(await run("getComputedStyle(document.getElementById('mobile-race-context')).position"),'fixed');
 const desktopReads=await run('window.__cloudflareReads.length');
 await run("window.__desktopRefreshAnchor=document.querySelector('.prediction-table thead');window.__desktopRefreshTop=window.__desktopRefreshAnchor.getBoundingClientRect().top;document.getElementById('mobile-refresh-button').focus({preventScroll:true});document.getElementById('mobile-refresh-button').click()");
 await wait(`!document.getElementById('mobile-refresh-button').disabled && window.__cloudflareReads.length===${desktopReads+1}`);
 assert.ok(await run("Math.abs(window.__desktopRefreshAnchor.getBoundingClientRect().top-window.__desktopRefreshTop)<2"));
 assert.equal(await run('document.activeElement.id'),'mobile-refresh-button');
 assert.equal(await run("document.querySelectorAll('.selection-toolbar, #jump-to-suji').length"),0);
 assert.equal(await run("document.querySelectorAll('#bet-selection-count').length"),1);
 console.log('::notice title=Published desktop refresh verification::'+JSON.stringify({fixed:true,unified_menu:true,manual_refresh:true,viewport_preserved:true,focus_preserved:true}));
 assert.doesNotMatch(await run('document.body.innerText'),/\b\d{1,2}:\d{2}:\d{2}\b/);
 assert.doesNotMatch(await run("document.querySelector('.entry-alerts')?.textContent||''"),/本番.*未確定/);
 const probabilityRows=await run("document.querySelectorAll('.prediction-table tbody tr').length");
 await run("document.getElementById('value-tab').click()");
 const valueRows=await run("document.querySelectorAll('.prediction-table tbody tr').length");assert.equal(valueRows,expectedValueRows);
 assert.equal(await run("document.getElementById('probability-tab').textContent"),'的中率上位');assert.equal(await run("document.getElementById('value-tab').textContent"),'期待値上位');
 await run("document.getElementById('return-tab').click()");
 assert.equal(await run("document.getElementById('prediction-panel').getAttribute('aria-labelledby')"),'return-tab');
 const returnRows=await run("[...document.querySelectorAll('.prediction-table tbody tr')].map(tr=>({combo:tr.querySelector('[data-combo]').dataset.combo,probability:parseFloat(tr.children[2].textContent),odds:parseFloat(tr.children[3].textContent),value:parseFloat(tr.children[4].textContent)}))");
 assert.ok(returnRows.length<=10);assert.ok(returnRows.every(r=>r.probability>=1&&r.odds>=50));for(let i=1;i<returnRows.length;i++)assert.ok(returnRows[i-1].value>=returnRows[i].value);
 if(!returnRows.length)assert.ok(await run("!!document.querySelector('.empty-value')"));
 // Check the published scenario filters and full incremental list, using
 // probability order so unavailable market quotes cannot hide combinations.
 assert.equal(await run("document.getElementById('condition-tab').textContent"),'条件別検証');
 await run("document.getElementById('condition-tab').click()");
 assert.equal(await run("document.getElementById('prediction-panel').getAttribute('aria-labelledby')"),'condition-tab');
 assert.equal(await run("document.getElementById('condition-preset').value"),'in50');
 assert.ok(await run("document.querySelectorAll('.prediction-table tbody tr').length<=10"));
 await run("document.getElementById('condition-limit').value='20';document.getElementById('condition-limit').dispatchEvent(new Event('change'))");
 assert.equal(await run("document.getElementById('condition-limit').value"),'20');
 assert.ok(await run("document.querySelectorAll('.prediction-table tbody tr').length<=20"));
 assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);
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
 assert.equal(await run("document.getElementById('exhibition-tab').textContent"),'展示情報');
 assert.equal(await run("document.body.textContent.includes('日本時間')"),false);
 assert.equal(await run("document.getElementById('featured-details').open"),false);
 await run("document.querySelector('#featured-details>summary').click()");
 assert.ok((await run("document.getElementById('featured-details').textContent")).includes('高率は70%以上'));
 await run("document.querySelector('#featured-details>summary').click()");
 assert.equal(await run("document.getElementById('entry-statistics-details').open"),false);
 await run("document.querySelector('#entry-statistics-details>summary').click()");
 assert.ok((await run("document.getElementById('entry-statistics-details').textContent")).includes('枠別統計：'));
 await run("document.querySelector('#entry-statistics-details>summary').click()");

 assert.equal(await run("document.getElementById('prediction-details').open"),false);
 assert.equal(await run("document.querySelector('.time-note').closest('details').id"),'prediction-details');
 const closedPredictionDetailsHeight=await run("document.getElementById('prediction-details').getBoundingClientRect().height");assert.ok(closedPredictionDetailsHeight<80);
 await run("document.querySelector('#prediction-details>summary').click()");
 assert.ok(await run("document.getElementById('prediction-details').getBoundingClientRect().height")>closedPredictionDetailsHeight+40);
 assert.ok((await run("document.getElementById('prediction-details').textContent")).includes('期待値は推定確率 × 取得時点のオッズ'));
 await run("document.querySelector('#prediction-details>summary').click()");
 await run("document.getElementById('assessment-tab').click()");
 await wait("!document.getElementById('assessment-panel').hidden && typeof window.Chart==='function' && !!window.Chart.getChart(document.getElementById('score-radar'))");
 const radar=await run("(()=>{const c=window.Chart.getChart(document.getElementById('score-radar'));return {axes:c.data.labels.length,datasets:c.data.datasets.length,colors:c.data.datasets.map(d=>d.borderColor)};})()");
 assert.equal(radar.axes,6);assert.equal(radar.datasets,6);assert.deepEqual(radar.colors,['#8b96a4','#253744','#e34747','#1681ca','#e3bc12','#28a76b']);
 await run("document.querySelector('[data-radar-lane=\"2\"]').click()");
 assert.equal(await run("window.Chart.getChart(document.getElementById('score-radar')).data.datasets.find(d=>d.label.startsWith('2号艇')).hidden"),true);
 console.log('::notice title=Published assessment verification::'+JSON.stringify(radar));
 await run("document.getElementById('development-tab').click()");
 assert.equal(await run("document.getElementById('development-panel').hidden"),false);
 assert.equal(await run("document.querySelectorAll('[data-development-boat]').length"),6);
  assert.equal(await run("document.querySelectorAll('.development-start-pole').length"),2);
  assert.equal(await run("document.querySelectorAll('.development-boat text, .development-boat circle').length"),0);
  assert.deepEqual(await run("[...document.querySelectorAll('.development-hull')].map(p=>p.getAttribute('fill'))"),['#fff','#253744','#e34747','#1681ca','#ffd747','#28a76b']);
  const wakeFrames=await run(`(()=>{
   const water=document.getElementById('development-water');water.pauseAnimations();
   const frames=[0,2,4.2,6].map(time=>{water.setCurrentTime(time);
    return [...document.querySelectorAll('.development-track')].map((track,i)=>{
     const fraction=Number(document.querySelectorAll('.development-boat animateMotion')[i].getAttribute('keyPoints').split(';')[1]),progress=time<=4.2?fraction*time/4.2:fraction+(1-fraction)*(time-4.2)/1.8;
     const point=track.getPointAtLength(track.getTotalLength()*progress),screen=new DOMPoint(point.x,point.y).matrixTransform(track.getCTM());
     const boat=document.querySelectorAll('[data-development-boat]')[i].getCTM();
     return {expectedOffset:100*(1-progress),offset:parseFloat(getComputedStyle(track).strokeDashoffset),distance:Math.hypot(boat.e-screen.x,boat.f-screen.y)};
    });
   });water.setCurrentTime(0);water.unpauseAnimations();return frames;
  })()`);
  for(let frame=0;frame<4;frame++)for(const wake of wakeFrames[frame]){
   assert.ok(Math.abs(wake.offset-wake.expectedOffset)<.1,'航跡が時刻とともに伸びる');
   assert.ok(wake.distance<1,'航跡の先端と船の位置が一致する');
  }

 const developmentCases=await run("[...document.querySelectorAll('button[data-development-lane]')].map(b=>({lane:Number(b.dataset.developmentLane),probability:Number(b.dataset.firstProbability)}))");
 assert.ok(developmentCases.length>0);assert.ok(developmentCases.every(c=>c.lane===1||c.probability>=.2-1e-12));
 const developmentTickets=[],developmentPathsSeen=[];
 for(const c of developmentCases){
  await run(`document.querySelector('button[data-development-lane="${c.lane}"]').click()`);
  const paths=await run("[...document.querySelectorAll('.development-boat animateMotion')].map(x=>x.getAttribute('path'))");
  for(const previous of developmentPathsSeen)assert.notDeepEqual(paths,previous);developmentPathsSeen.push(paths);
  await run("document.getElementById('development-water').pauseAnimations();document.getElementById('development-water').setCurrentTime(4.2)");
  assert.equal(await run("Number([...document.querySelectorAll('[data-development-boat]')].sort((a,b)=>a.getCTM().e-b.getCTM().e)[0].dataset.developmentBoat)"),c.lane);
  const combo=await run("document.querySelector('[data-development-combo]').dataset.developmentCombo");assert.ok(combo.startsWith(c.lane+'-'));developmentTickets.push(combo);
 }
 await run("document.getElementById('development-water').unpauseAnimations();document.getElementById('development-water').setCurrentTime(2);document.getElementById('development-pause').click()");
 assert.equal(await run("document.getElementById('development-water').animationsPaused()"),true);
 const animationStart=await run("document.querySelector('[data-development-boat]').getCTM().e");
 await run("document.getElementById('development-water').setCurrentTime(4)");
 assert.notEqual(await run("document.querySelector('[data-development-boat]').getCTM().e"),animationStart);
 await run("document.querySelector('[data-development-combo]').click()");
 assert.equal(await run('document.activeElement.id'),'related-title');
 const selectedFromDevelopment=await run("[...document.querySelectorAll('.related-selection [data-combo]')].map(b=>b.dataset.combo)");
 assert.ok(selectedFromDevelopment.includes(developmentTickets.at(-1)));
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);
 const developmentReport={checked_at:new Date().toISOString(),site_url:base,venue_code:candidate.venue_code,race_no:race.race_no,cases:developmentCases,tickets:developmentTickets,boats:6,motion_verified:true,winner_positions_verified:true,distinct_scenario_paths_verified:true,boat_shapes_verified:true,start_poles:2,progressive_trails_verified:true,suji_selected:selectedFromDevelopment,mobile_overflow:false,errors};
 fs.writeFileSync(path.join(output,'development.json'),JSON.stringify(developmentReport,null,2)+'\n');console.log('::notice title=Published development verification::'+JSON.stringify(developmentReport));
 await run("document.getElementById('result-tab').click()");assert.equal(await run("document.getElementById('result-panel').hidden"),false);
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
 assert.equal(await run("document.querySelector('#opportunities-section h2').textContent"),'厳選レース');
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
  if(!morning)await run("window.__uxPanel=document.getElementById('entries-panel');window.__uxWater=document.getElementById('development-water');window.__uxButton=document.getElementById('entries-tab');window.__uxDetails=document.querySelector('.score-section details');if(window.__uxDetails)window.__uxDetails.open=true;window.__uxButton.scrollIntoView({block:'center'});window.__uxButton.focus({preventScroll:true});window.__uxTop=window.__uxButton.getBoundingClientRect().top");
  if(!morning)await wait("!document.getElementById('mobile-race-context').hidden");
  const before=await run('window.__cloudflareReads.length');
  for(let n=1;n<=2;n++){
   await run(n===1?"document.getElementById('mobile-refresh-button').click()":"document.getElementById('refresh-button').click()");
   await wait(`!document.getElementById('refresh-button').disabled && window.__cloudflareReads.length===${before+n}`);
  }
  if(!morning){
   assert.equal(await run("window.__uxPanel===document.getElementById('entries-panel') && window.__uxWater===document.getElementById('development-water')"),true);
   assert.equal(await run("document.activeElement===window.__uxButton"),true);
   assert.equal(await run("!window.__uxDetails || window.__uxDetails.open"),true);
   assert.ok(await run("Math.abs(window.__uxButton.getBoundingClientRect().top-window.__uxTop)<2"));
  }
  const reads=await run('window.__cloudflareReads.slice(-2)');
  for(const read of reads){assert.equal(read.status,200);assert.equal(read.cache,'no-store');assert.equal(read.date,current.date);assert.equal(read.venue,candidate.venue_code);}
  if(morning&&candidate.meeting_status==='OPEN'){
   assert.ok((await run("document.getElementById('update-status').textContent")).includes('初回取得待ち'));
   assert.equal(await run("document.getElementById('update-status').textContent.includes('取得に失敗')"),false);
  }
  assert.deepEqual(errors,[]);
  const refreshReport={checked_at:new Date().toISOString(),site_url:base,manual_refreshes:reads,waited_for_60_second_throttle:false,dom_preserved:!morning,viewport_preserved:!morning,focus_preserved:!morning,details_preserved:!morning,update_status:await run("document.getElementById('update-status').textContent"),errors};
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
 const confirmed=venues.flatMap(v=>v.races.filter(r=>r.result?.status==='CONFIRMED').map(r=>({venue:v,race:r})));
 if(confirmed.length){
  const sample=confirmed.find(s=>resultComparison(s.race).status==='OK')||confirmed[0];await send('Page.navigate',{url:base+'?venue='+sample.venue.venue_code});
  await wait("document.querySelectorAll('[data-race]').length>0");await run(`document.querySelector('[data-race="${sample.race.race_no}"]').click();document.getElementById('result-tab').click()`);
  await wait("document.querySelectorAll('#result-panel .race-result > .table-wrap tbody tr').length===6");
  const comparison=resultComparison(sample.race);
  await wait("!!document.querySelector('.result-comparison')");
  if(comparison.status==='OK'){assert.equal(await run("document.querySelectorAll('.result-comparison tbody tr').length"),comparison.rows.length);for(const row of comparison.rows)assert.ok((await run("document.querySelector('.result-comparison').textContent")).includes(row.combo));}
  const text=await run("document.getElementById('result-panel').textContent");assert.ok(text.includes('確定結果'));assert.ok(text.includes('本番ST'));assert.ok(text.includes('3連単'));
  assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'results.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const report={checked_at:new Date().toISOString(),confirmed_races:confirmed.length,comparison_status:comparison.status,comparison_rows:comparison.rows,venue_code:sample.venue.venue_code,race_no:sample.race.race_no,kimarite:sample.race.result.kimarite,payouts:sample.race.result.payouts,source_url:sample.race.result.source_url,mobile_overflow:false};
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');console.log('::notice title=Published race results verification::'+JSON.stringify(report));
 }
 const upcoming=await run("[...document.querySelectorAll('[data-upcoming-venue]')].map(b=>({venue:b.dataset.upcomingVenue,race:Number(b.dataset.upcomingRace),deadline:b.querySelector('time').dateTime,text:b.textContent}))");
 assert.ok(upcoming.length<=5);assert.equal(new Set(upcoming.map(r=>r.venue+'/'+r.race)).size,upcoming.length);
 for(let i=0;i<upcoming.length;i++){assert.ok(!/オッズ|期待値/.test(upcoming[i].text));if(i)assert.ok(Date.parse(upcoming[i-1].deadline)<=Date.parse(upcoming[i].deadline));}
 assert.equal(await run("document.getElementById('opportunities-section').nextElementSibling.id"),'upcoming-section');
 if(upcoming.length){const target=upcoming.at(-1);await run(`document.querySelector('[data-upcoming-venue="${target.venue}"][data-upcoming-race="${target.race}"]').click()`);await wait(`document.getElementById('venue-select').value==='${target.venue}' && document.querySelector('[data-race="${target.race}"]')?.getAttribute('aria-pressed')==='true'`);assert.equal(await run("document.getElementById('live-view').hidden"),false);}
 assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);assert.deepEqual(errors,[]);
 const upcomingReport={checked_at:new Date().toISOString(),races:upcoming,navigation_verified:upcoming.length>0,mobile_overflow:false,errors};fs.writeFileSync(path.join(output,'upcoming.json'),JSON.stringify(upcomingReport,null,2)+'\n');console.log('::notice title=Published upcoming races verification::'+JSON.stringify(upcomingReport));
 await run("document.getElementById('live-tab').click()");
 await run("document.querySelector('.prediction-table')?.scrollIntoView({block:'center',behavior:'instant'})");
 if(await run("!!document.querySelector('.prediction-table')")){
  await wait("!document.getElementById('mobile-race-context').hidden");
  assert.equal(await run("getComputedStyle(document.getElementById('mobile-race-context')).position"),'fixed');
  assert.equal(await run("document.getElementById('mobile-refresh-label').textContent"),'データ更新');
  assert.ok(await run("(()=>{const r=document.getElementById('mobile-refresh-button').getBoundingClientRect();return r.width>=44&&r.height>=44&&r.right<=innerWidth;})()"));

  assert.ok((await run("document.getElementById('mobile-race-name').textContent")).includes('R'));
  await run("document.getElementById('mobile-suji-jump').click()");assert.equal(await run("document.activeElement.id"),'related-title');
 }
 await send('Page.navigate',{url:base+'#archive'});
 await wait("document.querySelectorAll('#experiment-content .study').length>0 && document.querySelector('[data-study-count]')?.textContent.includes('条件に合う記録')");
 assert.equal(await run("document.getElementById('archive-tab').textContent"),'検証企画・記事');
 assert.equal(await run("document.querySelector('.study').querySelectorAll('.study-metrics .study-metric').length"),4);
 assert.equal(await run("document.querySelector('.study-method').open"),false);
 assert.equal(await run("document.getElementById('mobile-race-context').hidden"),true);
 await run("document.getElementById('experiments-refresh').click()");
 await wait("!document.getElementById('experiments-refresh').disabled && document.getElementById('experiments-status').textContent.includes('画面確認')");
 const studyResponse=await get('data/experiments.json'),studies=await studyResponse.json();assert.equal(studies.kind,'STRATEGY_EXPERIMENT_ARCHIVE');
 const study=studies.experiments.find(s=>s.definition.id==='ev-top10-four-box-20261027');assert.ok(study);assert.equal(study.definition.venue_codes.length,24);assert.equal(study.definition.through,'2026-11-26');assert.equal(study.records.length,0);
 assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);assert.deepEqual(errors,[]);
 const studyReport={status:study.status,activated_at:study.activated_at,summary:study.summary,days:study.record_days.length,mobile_overflow:false};
 fs.writeFileSync(path.join(output,'study.json'),JSON.stringify(studyReport,null,2)+'\n');console.log('::notice title=Published strategy study verification::'+JSON.stringify(studyReport));
 const sharedHeaderLabels=await run("[...document.querySelector('header nav').children].map(x=>x.textContent)");
 assert.deepEqual(sharedHeaderLabels,['今日の予想','検証企画・記事','予想実績','リリースノート']);
 await send('Page.navigate',{url:base+'verification/'});
 await wait("document.querySelectorAll('[data-verification-date]').length===7 && document.getElementById('verification-status').textContent.includes('更新確認')");
 assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);
 assert.deepEqual(await run("[...document.querySelector('header nav').children].map(x=>x.textContent)"),sharedHeaderLabels);
 assert.equal(await run("document.querySelectorAll('header nav a').length"),4);
 assert.equal(await run("document.body.textContent.includes('日本時間')"),false);
 const review=await(await get('data/validation.json')).json();assert.equal(review.kind,'PROBABILITY_EV_VALIDATION');assert.equal(review.policy.version,'probability-ev-v1');
 assert.equal(Date.parse(review.through)-Date.parse(review.from),29*86400000);assert.ok(review.through<current.date);assert.equal(review.inputs_sha256.length,64);
 for(const g of review.groups){assert.ok(g.summary.races<=g.selected);assert.ok(g.summary.roi_races<=g.summary.races);assert.equal(g.summary.probability_bins.reduce((s,b)=>s+b.observations,0),g.summary.races*120);assert.equal(g.summary.first_place_bins.reduce((s,b)=>s+b.hits,0),g.summary.races);if(g.summary.races<2000||g.summary.days<20)assert.equal(g.summary.uncertainty.eligible,false);}
 await wait("document.querySelector('#validation-quality h2') && document.getElementById('validation-quality-status').textContent.includes('データ集計')");
 assert.equal(await run("document.querySelectorAll('#validation-group option').length"),review.groups.length);assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);
 console.log('::notice title=Published probability and EV validation::'+JSON.stringify({from:review.from,through:review.through,policy:review.policy.version,coverage:review.coverage,groups:review.groups.map(g=>({cohort:g.cohort,coefficient:g.coefficient_id,races:g.summary.races,days:g.summary.days,roi_races:g.summary.roi_races,uncertainty_ready:g.summary.uncertainty.eligible})),mobile_overflow:false}));
 const verificationReport={days:7,visible_records:await run("document.querySelectorAll('.verification-record').length"),status:await run("document.getElementById('verification-status').textContent"),mobile_overflow:false};
 const verificationURL=new URL(oddsConfig.api_url);verificationURL.pathname='/v1/verification';verificationURL.search='';
 const verificationAPI=await fetch(verificationURL,{headers:{Origin:new URL(base).origin},signal:AbortSignal.timeout(20000)});assert.equal(verificationAPI.status,200);const response=await verificationAPI.json();assert.equal(response.kind,'PUBLIC_SAVED_FORECAST_VERIFICATION');assert.equal(response.days.length,7);
 verificationReport.api_records=response.total;verificationReport.public_days=response.public_days;fs.writeFileSync(path.join(output,'verification-page.json'),JSON.stringify(verificationReport,null,2)+'\n');console.log('::notice title=Published saved forecasts verification::'+JSON.stringify(verificationReport));
 await send('Page.navigate',{url:base+'strategies/'});
 await wait("document.getElementById('strategy-report')?.textContent.includes('データ充足率')");
 assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);
 const strategies=await(await get('data/strategies.json')).json();assert.equal(strategies.kind,'CONDITIONAL_STRATEGY_REVIEW');assert.equal(strategies.definition.rules.length,22);
 console.log('::notice title=Published strategy dashboard::'+JSON.stringify({records:strategies.records,coverage:strategies.coverage}));
}finally{ws.close();await fetch(cdp+'/json/close/'+page.id).catch(()=>{});}
