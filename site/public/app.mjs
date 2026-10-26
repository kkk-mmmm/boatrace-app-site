import {escape as e, raceStatus, safeSource, japanDate, venueTags, filterVenues, venueFilterGroups, matchesPredictionScenario, predictionPool, scenarioProbabilities, predictionRanking, sujiCandidates, featuredRaceGroups, raceEntryAlerts, renderVenueSummary, renderRaceResult, upcomingRaceList} from './view.mjs';
import {ODDS_INTERVAL_MS, validateLiveOdds, applyLiveOdds, liveFeaturedRaces, proposalRace, PROPOSAL_LEAD_MS, resultComparison} from './odds-live.mjs';
import {renderDevelopment} from './development.mjs';
// Update matching DOM nodes in place so reading and interaction state survive polling.
function patchHTML(root,html) {
 const template=document.createElement('template');template.innerHTML=html;
 const key=node=>{
  if(node.nodeType!==1)return node.nodeName;
  if(node.id)return node.nodeName+'#'+node.id;
  for(const names of [['data-combo'],['data-development-lane'],['data-scenario'],['data-race'],['data-opportunity-venue','data-opportunity-race'],['data-upcoming-venue','data-upcoming-race'],['data-venue-filter','data-filter-value'],['data-venue-result']])if(node.hasAttribute(names[0]))return node.nodeName+names.map(n=>':'+node.getAttribute(n)).join('');
  if(node.nodeName==='TR'){const combo=node.querySelector('[data-combo]');if(combo)return 'TR:'+combo.dataset.combo;}
  return node.nodeName+':'+(node.getAttribute('class')||'').split(' ')[0];
 };
 const sync=(parent,source)=>{
  const old=[...parent.childNodes],used=new Set();let cursor=parent.firstChild;
  for(const next of [...source.childNodes]){
   const node=old.find(n=>!used.has(n)&&n.nodeType===next.nodeType&&n.nodeName===next.nodeName&&key(n)===key(next));
   if(!node){parent.insertBefore(next.cloneNode(true),cursor);continue;}
   used.add(node);if(node!==cursor)parent.insertBefore(node,cursor);
   if(node.nodeType===1){
    for(const a of [...node.attributes])if(!next.hasAttribute(a.name)&&a.name!=='data-race-key'&&!(node.tagName==='DETAILS'&&a.name==='open'))node.removeAttribute(a.name);
    for(const a of [...next.attributes])if(node.getAttribute(a.name)!==a.value&&!(node.tagName==='DETAILS'&&a.name==='open'))node.setAttribute(a.name,a.value);
    sync(node,next);
   }else if(node.nodeValue!==next.nodeValue)node.nodeValue=next.nodeValue;
   cursor=node.nextSibling;
  }
  for(const node of old)if(!used.has(node))node.remove();
 };
 sync(root,template.content);
}
let preservingViewport=false;
function preserveViewport(render) {
 if(preservingViewport)return render();
 const focused=document.activeElement;
 const anchors=[...document.querySelectorAll('main h3,main h4,main summary,main tr,main button,main p')].map(node=>({node,top:node.getBoundingClientRect().top,height:node.getBoundingClientRect().height})).filter(a=>a.height>0&&a.top>=0&&a.top<innerHeight).sort((a,b)=>a.top-b.top);
 preservingViewport=true;
 try{return render();}finally{
  preservingViewport=false;
  if(focused?.isConnected&&document.activeElement!==focused)focused.focus({preventScroll:true});
  const anchor=anchors.find(a=>a.node.isConnected&&a.node.getBoundingClientRect().height>0);
  if(anchor){const delta=anchor.node.getBoundingClientRect().top-anchor.top;if(Math.abs(delta)>.5)scrollBy({top:delta,left:0,behavior:'instant'});}
 }
}
const $ = id => document.getElementById(id);
const yen = n => `${n.toLocaleString('ja-JP')}円`;
const pct = n => n == null ? '—' : `${(n * 100).toFixed(1)}%`;
const clock = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('ja-JP', {timeZone:'Asia/Tokyo', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit'}).format(new Date(value)) : '未確認';
let current = null, archive = null, catalog = null, selected = null, selectedVenue = null, predictionTab = 'probability', view = 'live', entryTab = 'entries', loadVersion = 0;
let developmentLane=1;
let predictionScenario='all', predictionLimit=10, chosenCombos=new Set(), predictionRaceKey=null, featuredTab='value';
let oddsConfigPromise=null,liveOdds=null,oddsAttempt=0,oddsRequest=null,oddsFailure=null,oddsVenue=null;
async function refreshOdds({force=false}={}) {
  if(!oddsConfigPromise)oddsConfigPromise=(async()=>{
    const response=await fetch(new URL('./data/odds-config.json',document.baseURI),{cache:'no-store'});
    if(!response.ok)throw Error('オッズ更新の設定を読み込めません');
    const config=await response.json();
    if(config.schema_version!==1 || ![60,300].includes(config.interval_seconds))throw Error('オッズ更新の設定が不正です');
    if(config.api_url){const u=new URL(config.api_url);if(u.protocol!=='https:' || u.pathname!=='/v1/odds' || u.search || u.hash || u.username || u.password)throw Error('オッズAPIの接続先が不正です');}
    return config;
  })();
  let config;
  try {config=await oddsConfigPromise;}catch(error){oddsConfigPromise=null;oddsFailure=error.message;return;}
  if(!config.api_url)return;
  if(oddsRequest){await oddsRequest;if(!force && oddsVenue===selectedVenue)return;}
  if(!force && oddsVenue===selectedVenue && Date.now()-oddsAttempt<ODDS_INTERVAL_MS && liveOdds?.date===japanDate(Date.now()))return;
  if(!force && oddsVenue===selectedVenue && Date.now()-oddsAttempt<ODDS_INTERVAL_MS && oddsFailure)return;
  oddsAttempt=Date.now();oddsVenue=selectedVenue;
  oddsRequest=(async()=>{
    try {
      const url=new URL(config.api_url);url.searchParams.set('date',japanDate(Date.now()));
      if(oddsVenue)url.searchParams.set('venue',oddsVenue);
      const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('オッズの定期更新を確認できません');
      liveOdds=validateLiveOdds(await response.json(),japanDate(Date.now()));oddsFailure=null;
      if(liveOdds.update?.status==='FAILED')oddsFailure=liveOdds.update.message || 'オッズの取得に失敗しました';
    }catch(error){oddsFailure=error.message;if(liveOdds?.date!==japanDate(Date.now()))liveOdds=null;}
    finally{oddsRequest=null;}
  })();
  return oddsRequest;
}
function applyOddsState() {return preserveViewport(applyOddsStateContent);}
function applyOddsStateContent() {
  if(liveOdds && current)current=applyLiveOdds(current,liveOdds);
  if(liveOdds?.calendar?.date===japanDate(Date.now()) && catalog){
    catalog={...catalog,date:liveOdds.date,venues:catalog.venues.map(v=>({...v,...liveOdds.calendar.venues.find(c=>c.code===v.code),update:v.code===selectedVenue?current?.update:v.update}))};
    renderVenueOptions();
  }
  if(oddsFailure && current)current={...current,races:current.races.map(r=>({...r,odds_update:{status:'FAILED',message:oddsFailure}}))};
  const latest=liveOdds?.races.reduce((value,r)=>r.status==='OK' && Date.parse(r.fetched_at)>Date.parse(value || '1970-01-01')?r.fetched_at:value,null);
  $('odds-status').textContent=oddsFailure?`オッズ更新失敗：${oddsFailure}`:liveOdds?`オッズ取得：${clock(latest)} / 締切30分以内は1分、それより先は5分間隔${liveOdds.update?.status==='UPDATING'?'（更新中）':''}`:'';
}
const venueFilters={held:'OPEN',grade:null,day:null,schedule:null};
const shortClock=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'未確認';
const venueName = () => catalog?.venues.find(v => v.code === selectedVenue)?.name || '選んだ場';
const freshUpdate = (update, date) => date === japanDate(Date.now()) && ['OK','PARTIAL'].includes(update?.status)
  && Number.isFinite(Date.parse(update.last_success_at)) && Date.parse(update.last_success_at) <= Date.now() + 60000
  && Date.now() - Date.parse(update.last_success_at) <= 10 * 60000;
function identifyVenue() {
  for (const element of document.querySelectorAll('[data-venue-name]')) element.textContent = venueName();
  document.title = view==='releases'?'リリースノート | BOATRACE NOTE':`BOATRACE NOTE | ${venueName()}のモデル予想とオッズ`;
}
function renderVenueOptions() {return preserveViewport(renderVenueOptionsContent);}
function renderVenueOptionsContent() {
  const facts = venue => {
    const sameDay = catalog.date === japanDate(Date.now());
    const held = sameDay && venue.meeting_status === 'OPEN';
    const absent = sameDay && venue.meeting_status === 'NO_MEETING';
    const m = sameDay ? venue.meeting || {} : {};
    const day = m.day_label === '最終日' && m.meeting_day ? `最終日（${m.meeting_day}日目）` : m.day_label || (m.meeting_day ? `${m.meeting_day}日目` : '日次未確認');
    return [held ? '本日開催' : absent ? '非開催' : '開催未確認', ...(absent ? [] : [m.grade || 'グレード未確認',day,m.schedule_type || '時間帯未確認']),
      freshUpdate(venue.update,catalog.date) ? venue.update.reason==='INITIAL_COLLECTION_PENDING' ? '初回取得待ち' : venue.update.status === 'PARTIAL' ? '一部取得失敗' : '取得確認済み' : '更新待ち'];
  };
  patchHTML($('venue-select'), catalog.venues.map(v => `<option value="${e(v.code)}">${e(v.name)} · ${facts(v).map(e).join(' / ')}</option>`).join(''));
  $('venue-select').value = selectedVenue;
  const venue = catalog.venues.find(v=>v.code===selectedVenue);
  patchHTML($('venue-facts'), venue ? facts(venue).map(text=>`<span class="pill">${e(text)}</span>`).join('') : '');
  $('venue-title').textContent = catalog.date===japanDate(Date.now()) && venue?.meeting_status === 'OPEN' ? venue.meeting?.title || '' : '';
  const count = catalog.venues.filter(v => venueTags(v,catalog.date).held==='OPEN').length;
  $('venue-summary').textContent = `全${catalog.venues.length}場 / 本日開催 ${count}場`;
  identifyVenue();renderVenueFilters();
}
function renderVenueFilters() {return preserveViewport(renderVenueFiltersContent);}
function renderVenueFiltersContent() {
  const groups=venueFilterGroups(catalog.venues,catalog.date);
  patchHTML($('venue-filter-tags'), groups.map(group=>`<div class="venue-filter-row" role="group" aria-label="${e(group.label)}"><span>${e(group.label)}</span><div class="venue-filter-options"><button data-venue-filter="${group.key}" data-filter-value="" aria-pressed="${!venueFilters[group.key]}">すべて</button>${group.options.map(option=>`<button data-venue-filter="${group.key}" data-filter-value="${e(option.value)}" aria-pressed="${venueFilters[group.key]===option.value}">${e(option.label)}</button>`).join('')}</div></div>`).join(''));
  const matches=filterVenues(catalog.venues,venueFilters,catalog.date);
  $('venue-results-count').textContent=`該当 ${matches.length}場 / 全${catalog.venues.length}場`;
  const scroll=$('venue-results').scrollTop;
  patchHTML($('venue-results'), matches.length?matches.map(venue=>{
    const tags=venueTags(venue,catalog.date);
    const details=tags.held==='OPEN'?[tags.grade || 'グレード未確認',tags.final?'最終日':tags.day?`${tags.day}日目`:'日次未確認',tags.schedule || '時間帯未確認']:[tags.held==='NO_MEETING'?'非開催':'開催未確認'];
    return `<button class="venue-result" data-venue-result="${e(venue.code)}" aria-pressed="${selectedVenue===venue.code}"><strong>${e(venue.name)}</strong><span>${details.map(e).join(' / ')}</span></button>`;
  }).join(''):'<p class="venue-filter-empty">この条件に合う場はありません。条件を外すか「絞り込みをクリア」を選んでください。</p>');
  $('venue-results').scrollTop=scroll;
  for(const button of document.querySelectorAll('[data-venue-filter]'))button.onclick=(()=>{
    const key=button.dataset.venueFilter,value=button.dataset.filterValue || null;
    venueFilters[key]=venueFilters[key]===value?null:value;renderVenueFilters();
    document.querySelector(`[data-venue-filter="${key}"][data-filter-value="${value || ''}"]`)?.focus({preventScroll:true});
  });
  for(const button of document.querySelectorAll('[data-venue-result]'))button.onclick=(()=>{
    $('venue-select').value=button.dataset.venueResult;$('venue-select').dispatchEvent(new Event('change'));
  });
}
function clearCurrent() {
  current = null;selected = null;entryTab='entries';predictionRaceKey=null;identifyVenue();
  $('update-status').hidden=false;$('update-status').textContent = `${venueName()}の情報を取得中`;
  $('update-dot').classList.remove('ok');$('updated-at').textContent = '—';
  $('meeting-title').textContent = `${venueName()}の開催情報を確認中`;
  $('meeting-detail').textContent = '出走表・オッズを読み込んでいます。';
  $('live-content').textContent = '情報を読み込んでいます。';
  $('current-date').textContent = `${japanDate(Date.now())} / 日本時間`;
  $('official-link').href = `https://www.boatrace.jp/owpc/pc/race/raceindex?hd=${japanDate(Date.now()).replaceAll('-', '')}&jcd=${selectedVenue}`;
  notify(null);renderArchive();
}
const table = (headers, rows) => `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th scope="col">${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

function showView(name) {
  view = name;
  $('releases-view').hidden = name !== 'releases';
  for(const selector of ['.venue-picker','.update-bar','.meeting-summary','#message'])document.querySelector(selector)?.toggleAttribute('hidden',name==='releases' || selector==='#message'&&!$('message').textContent);
  $('live-view').hidden = name !== 'live';
  $('archive-view').hidden = name !== 'archive';
  $('opportunities-section').hidden = name !== 'live';
  $('upcoming-section').hidden = name !== 'live';
  $('live-tab').setAttribute('aria-pressed', String(name === 'live'));
  $('archive-tab').setAttribute('aria-pressed', String(name === 'archive'));
  $('releases-tab').setAttribute('aria-pressed',String(name==='releases'));
  const url=new URL(location.href);url.hash=name==='releases'?'releases':name==='archive'?'archive':'';
  if(url.href!==location.href)history.pushState(null,'',url);
  identifyVenue();
}

function notify(message) { $('message').textContent = message; $('message').hidden = !message || view==='releases'; }


function renderOpportunities() {return preserveViewport(renderOpportunitiesContent);}
function renderOpportunitiesContent() {
  const now=Date.now();
  const groups=featuredRaceGroups(oddsFailure?[]:liveOdds?liveFeaturedRaces(liveOdds,now):catalog?.featured_races || [],now);
  const rows=groups[featuredTab];
  for(const button of document.querySelectorAll('[data-featured-tab]'))button.setAttribute('aria-pressed',String(button.dataset.featuredTab===featuredTab));
  const conditions={value:'高率・低率に分類されないレースから、期待値1.0超を高い順に表示します。',high:'イン逃げ想定70%以上を、確率が高い順に表示します。期待値1.0未満も含みます。',low:'イン逃げ想定30%以下を、確率が低い順に表示します。期待値1.0未満も含みます。'};
  $('featured-condition').textContent=conditions[featuredTab];
  patchHTML($('opportunities-content'), rows.length?`<div class="opportunity-grid">${rows.map((x,i)=>`<button class="opportunity-card" data-opportunity-venue="${e(x.venue_code)}" data-opportunity-race="${x.race_no}" data-in-probability="${x.scenario_probabilities.in}" data-other-probability="${x.scenario_probabilities.other}" data-expected-value="${x.value}" title="${e(x.model_name)} / オッズ取得 ${e(clock(x.fetched_at))}"><span class="opportunity-top"><span class="eyebrow">${i+1} / ${e(catalog?.venues.find(v=>v.code===x.venue_code)?.name || x.venue)} ${x.race_no}R</span><span>締切 ${e(shortClock(x.deadline_at))}</span></span><span class="opportunity-main"><strong>${e(x.combo)}</strong><span class="opportunity-value"><b>${x.value.toFixed(3)}</b>倍<small>期待値</small></span></span><span class="opportunity-probabilities"><span>イン逃げ想定 <b>${pct(x.scenario_probabilities.in)}</b></span><span>それ以外 <b>${pct(x.scenario_probabilities.other)}</b></span></span><span class="opportunity-bottom"><span>${pct(x.probability)} × ${x.odds.toFixed(1)}倍</span><span>取得 ${e(shortClock(x.fetched_at))}</span></span></button>`).join('')}</div>`
    : `<div class="opportunity-empty">締切まで1時間以内で、この条件に合うレースはありません。${featuredTab==='value'?'期待値1.0超のレースがない、または高率・低率へ分類済みのためです。':`イン逃げ想定${featuredTab==='high'?'70%以上':'30%以下'}のレースを確認できません。`}オッズ・全120通りの予想が未取得、更新待ち、締切済みの場合も対象外です。</div>`);
  for(const button of document.querySelectorAll('[data-opportunity-venue]'))button.onclick=()=>openListedRace(button.dataset.opportunityVenue,Number(button.dataset.opportunityRace),rows.find(r=>r.venue_code===button.dataset.opportunityVenue&&r.race_no===Number(button.dataset.opportunityRace)));
  renderUpcoming();
}

async function openListedRace(code,number,record) {
 showView('live');selectedVenue=code;clearCurrent();await load();
 if(current?.venue_code!==code)return;
 if(!current.races.some(r=>r.race_no===number)&&record&&record.date===current.date){
  current={...current,races:[...current.races,{date:record.date,venue_code:code,venue:venueName(),race_no:number,deadline_at:record.deadline_at,entries:[],items:[],probabilities:[],odds:null,issue:'出走表・予想は取得待ちです。'}].sort((a,b)=>a.race_no-b.race_no)};
 }
 selected=number;renderCurrent();$('live-view').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
function renderUpcoming() {
 const now=Date.now(),rows=upcomingRaceList(liveOdds?.date===japanDate(now)?liveOdds.upcoming_races??catalog?.upcoming_races:catalog?.upcoming_races,now);
 patchHTML($('upcoming-content'),rows.length?`<div class="upcoming-list">${rows.map(r=>`<button class="upcoming-race" data-upcoming-venue="${r.venue_code}" data-upcoming-race="${r.race_no}"><strong>${e(catalog?.venues.find(v=>v.code===r.venue_code)?.name||r.venue_code)} ${r.race_no}R</strong><span>締切 <time datetime="${e(r.deadline_at)}">${e(shortClock(r.deadline_at))}</time></span></button>`).join('')}</div>`:'<p class="upcoming-empty">現在、確認できる締切前のレースはありません。開催前・全レース締切済み・締切情報の取得待ちの場合があります。</p>');
 for(const button of document.querySelectorAll('[data-upcoming-venue]'))button.onclick=()=>openListedRace(button.dataset.upcomingVenue,Number(button.dataset.upcomingRace),rows.find(r=>r.venue_code===button.dataset.upcomingVenue&&r.race_no===Number(button.dataset.upcomingRace)));
}

function renderCurrent() {return preserveViewport(renderCurrentContent);}
function renderCurrentContent() {
  const previousWater=$('development-water');
  const previousMotion=previousWater && !$('development-panel').hidden ? {key:previousWater.dataset.raceKey,time:previousWater.getCurrentTime(),paused:previousWater.animationsPaused()}:null;
  if (!current) return;
  const now = Date.now();
  const today = japanDate(now);
  const name = current.venue;
  const sameDay = current.date === today;
  const successTime = Date.parse(current.update.last_success_at);
  const fresh = sameDay && ['OK','PARTIAL'].includes(current.update.status) && Number.isFinite(successTime)
    && successTime <= now + 60000 && now - successTime <= 10 * 60000;
  $('updated-at').textContent = `${current.source_kind==='CLOUDFLARE_SCHEDULED_PROGRAM'?'Cloudflare配信確認':'公式データの確認'}：${clock(current.update.last_success_at)}（日本時間）`;
  $('update-status').textContent = fresh ? current.update.reason==='INITIAL_COLLECTION_PENDING' ? '本日の出走表・予想は初回取得待ちです' : current.update.status === 'PARTIAL' ? '一部レースの取得に失敗' : '' : '最新データを確認できていません';
  $('update-status').hidden=!$('update-status').textContent;
  $('update-dot').classList.toggle('ok', fresh && current.update.status === 'OK');
  $('current-date').textContent = `${today} / 日本時間`;
  $('official-link').href = `https://www.boatrace.jp/owpc/pc/race/raceindex?hd=${today.replaceAll('-', '')}&jcd=${selectedVenue}`;
  if (!sameDay) {
    notify('日付が変わりました。本日の情報は更新待ちです。');
    $('meeting-title').textContent = '本日の開催情報を確認中';
    $('meeting-detail').textContent = '前日の情報を本日の予想として表示しません。';
  } else if (!fresh) {
    notify(current.update.message || 'データ取得に失敗したか、更新から時間が経過しています。公式サイトも確認してください。');
    $('meeting-title').textContent = '最新情報の確認待ち';
    $('meeting-detail').textContent = '取得時刻と更新状態を確認してご利用ください。';
  } else if (current.meeting_status === 'NO_MEETING') {
    notify(`本日の${name}は非開催です。開催が確認できた日に、取得できた出走表とオッズを反映します。`);
    $('meeting-title').textContent = `本日の${name}開催はありません`;
    $('meeting-detail').textContent = '公式の開催一覧を確認した時点の情報です。';
  } else {
    notify(current.update.status === 'PARTIAL' ? current.update.message : null);
    const next = current.races.find(r => Date.parse(r.deadline_at) > now);
    $('meeting-title').textContent = next ? `次の締切予定 ${next.race_no}R` : current.races.length ? '本日の締切は終了しました' : '本日の出走表は更新待ちです';
    $('meeting-detail').textContent = next ? `${clock(next.deadline_at)}（日本時間）` : current.races.length ? '保存済みの予想は参考として確認できます。' : current.update.message || '取得できた出走表から表示します。';
  }
  if (!sameDay || current.races.length === 0) {
    patchHTML($('live-content'), `<div class="empty"><div class="empty-mark">≋</div><h3>${fresh && current.meeting_status === 'NO_MEETING' ? '次の開催で、また記録を。' : '本日の予想はまだ表示できません'}</h3><p>${fresh && current.meeting_status === 'NO_MEETING' ? `本日は${e(name)}の開催が確認できていません。保存済みの検証結果がある場合は、検証記録からご覧いただけます。` : '最新の出走表や必須データが確認できたレースから表示します。過去の記録やサンプルを、本日の予想として使うことはありません。'}</p><button id="empty-archive" class="text-button">これまでの検証記録を見る ↗</button></div>`);
    $('empty-archive').onclick=( () => showView('archive'));
    return;
  }
  if (!current.races.some(r => r.race_no === selected)) selected = current.races.find(r => Date.parse(r.deadline_at) > now)?.race_no || current.races[0].race_no;
  const originalRace = current.races.find(r => r.race_no === selected);
  const status = raceStatus(originalRace, current, now);
  const race = proposalRace(originalRace,now);
  const savedProposal = race!==originalRace ? race.proposal_snapshot : null;
  const cutoffReached=now>=Date.parse(race.deadline_at)-PROPOSAL_LEAD_MS;
  const withdrawn=originalRace.entries?.some(e=>e.participation_status==='WITHDRAWN');
  const canRank=!withdrawn && (!!savedProposal || status.currentOdds && !cutoffReached);
  const raceKey = `${race.date}/${race.venue_code}/${race.race_no}`;
  if (predictionRaceKey !== raceKey) {predictionRaceKey=raceKey;predictionLimit=10;chosenCombos.clear();}
  const pool = !withdrawn && race.items.length ? predictionPool(race) : [];
  const scenarioMass = scenarioProbabilities(pool);
  const ranked = predictionRanking(pool, race.odds?.items || [], {scenario:predictionScenario,tab:predictionTab,currentOdds:canRank});
  const forecastItems = ranked.slice(0,predictionLimit);
  chosenCombos=new Set([...chosenCombos].filter(combo=>pool.some(row=>row.combo===combo)));
  const correctionPending=race.model_validation?.selected_lambda===null;
  const displayedModel=correctionPending?'固定式 / 履歴補正は未適用':race.model_name || '固定スコアモデル v1';
  $('model-label').textContent = displayedModel;
  const sources = safeSource(race.input_source_url);
  const oddsMap = new Map((race.odds?.items || []).map(x => [x.combo, x.odds]));
  const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
  const annual=String(race.model_id||'').startsWith('annual-v3-');
  const entryInfo=raceEntryAlerts(originalRace,now);
  const exhibitionNotice=entryInfo.state==='AVAILABLE'?`展示情報：取得済み ${clock(race.exhibition_fetched_at)}`:entryInfo.state==='SCHEDULED'?`展示情報：締切10分前（${shortClock(new Date(entryInfo.due).toISOString())}）に取得予定`:entryInfo.state==='FAILED'?`展示取得に失敗：${race.exhibition_issue} / 締切前は次の定期処理で再試行`:entryInfo.state==='PARTIAL'?`展示情報：公式情報の一部が未提供${entryInfo.retryAt?` / ${shortClock(new Date(entryInfo.retryAt).toISOString())}に再確認`:''}`:'展示情報：取得待ち（締切10分前から定期取得）';
  const entryAlerts=`<aside class="entry-alerts" role="status">${entryInfo.absent.length?`<strong class="withdrawal-alert">欠場あり：${entryInfo.absent.map(x=>`${x.lane}号艇 ${e(x.name)}`).join('、')}。6艇を前提とする予想・展開・スジ提案を停止しています。</strong>`:''}<span class="exhibition-state">${e(exhibitionNotice)}</span><span class="${entryInfo.courseStatus==='CHANGED'?'course-change-alert':''}">${entryInfo.courseStatus==='CHANGED'?`進入変化あり（展示）：${entryInfo.changes.map(x=>`${x.lane}号艇 → ${x.exhibition_course}コース`).join('、')}。本番の進入は未確定です。`:entryInfo.courseStatus==='UNCHANGED'?'展示進入：枠なり（本番は未確定）':'展示進入：未確認'}</span></aside>`;
  const entrySheet = race.entries?.length ? `<div class="table-heading"><span>最新の出走表</span><span class="small-note">取得 ${e(clock(race.entries_fetched_at || race.input_fetched_at))}</span></div><div class="entry-table">${table(['枠','選手','級別','全国勝率','当地勝率','モーター2連率','ボート2連率','平均ST','枠別1着率','枠別着順点','枠別平均ST','枠別ST順位','枠別出走数'],race.entries.map(x => [`<span class="lane lane-${x.lane}">${e(x.lane)}</span>`,`${e(x.name)}${x.participation_status==='WITHDRAWN'?'<strong class="withdrawal-label">欠場</strong>':''}`,e(x.class || '—'),numeric(x.national_win_rate),numeric(x.local_win_rate),numeric(x.motor_2rate),numeric(x.boat_2rate),numeric(x.avg_st),pct(x.annual_lane?.win_rate),numeric(x.annual_lane?.mean_points),numeric(x.annual_lane?.mean_st),numeric(x.annual_lane?.mean_start_rank),x.annual_lane?.samples?e(x.annual_lane.samples):'未集計']))}</div><p class="small-note">枠別統計：${e(race.history_window?.from || '未取得')}〜${e(race.history_window?.through || '未取得')}。枠番と実際の進入コースは区別します。着順点は1〜6着を10・8・6・4・2・1点、異常着順を0点として平均した参考値です。欠場は除きます。ST順位は正常な6艇のSTから算出し、同タイムは平均順位とします。STの有効件数は枠別出走数と異なる場合があります。</p>` : '';
  const signed=value=>typeof value==='number'&&Number.isFinite(value)?`${value>0?'+':''}${value.toFixed(3)}`:'—';
  const history=new Map((race.history?.lanes || []).map(x=>[x.lane,x]));
  const showGap=(gap,unit)=>gap?.n?`${signed(gap.mean)}${unit}（${gap.n}件）`:'未集計';
  const exhibit = `<div class="table-heading"><span>今回の展示情報</span><span class="small-note">取得 ${e(clock(race.exhibition_fetched_at))}</span></div>${table(['枠','選手','展示タイム','展示順位','展示ST','展示進入'],(race.entries || []).map(x=>{const h=history.get(x.lane);return [e(x.lane),`${e(x.name)}${x.participation_status==='WITHDRAWN'?'<strong class="withdrawal-label">欠場</strong>':''}`,numeric(x.exhibition_time),h?.exhibition_rank==null?'—':e(h.exhibition_rank),x.exhibition_st==null?'—':`${x.exhibition_st_status==='F'?'F':x.exhibition_st_status==='L'?'L':''}${Math.abs(x.exhibition_st).toFixed(2)}`,x.exhibition_course==null?'—':e(x.exhibition_course)];}))}
    <div class="table-heading"><span>展示と本番の差（過去の集計）</span></div>${table(['枠','展示順位→本番着順の差','順位差のRMSE','展示ST→本番STの差','ST差のRMSE','ST差の標準偏差'],(race.entries || []).map(x=>{const h=history.get(x.lane);return [e(x.lane),e(showGap(h?.exhibition_rank_gap,'着')),numeric(h?.exhibition_rank_gap?.rmse),`${e(showGap(h?.exhibition_st_gap,'秒'))}${h?.exhibition_st_gap?.n?`<small class="gap-period">${e(h.exhibition_st_gap.scope)} / ${e(h.exhibition_st_gap.from)}〜${e(h.exhibition_st_gap.through)}</small>`:''}`,h?.exhibition_st_gap?.n?h.exhibition_st_gap.rmse.toFixed(3):'未集計',h?.exhibition_st_gap?.sd==null?'未集計':h.exhibition_st_gap.sd.toFixed(3)];}))}
    <p class="small-note">差＝本番 − 展示。着順の差がマイナスなら展示順位より上位、ST差がプラスなら展示より本番のスタートが遅い傾向です。RMSEは差の大きさの指標です。展示STと正常な本番STを選手登録番号・レースで照合できた過去の組だけを集計します。差には展示Fを負のSTとして含め、本番F・L等は除外します。未取得・照合できない場合は未集計です。今回の本番結果はこの欄に取り込まず、比較は過去の集計だけを表示します。</p>
    <div class="table-heading"><span>開催日・レース区分ごとのST傾向</span></div>${table(['枠','本日と同じ日次の平均ST','日次のSTばらつき','同じ区分の平均ST','区分のSTばらつき','勝負掛け'],(race.entries || []).map(x=>{const h=history.get(x.lane);return [e(x.lane),h?.day?.samples?`${numeric(h.day.st_mean)}（${h.day.samples}件）`:'未集計',numeric(h?.day?.st_sd),h?.phase?.samples?`${numeric(h.phase.st_mean)}（${h.phase.samples}件）`:'未集計',numeric(h?.phase?.st_sd),h?.pressure?.status==='CONFIRMED'?`${h.pressure.required_finish}着以内 / ${h.pressure.required_points}点必要`:h?.pressure?.status==='NOT_REQUIRED'?'対象外（確認済み）':'未確認・補正なし'];}))}
    <p class="small-note">STのばらつきは標準偏差で、小さいほど安定した傾向です。少数の集計は全体の傾向へ寄せて補正します。集計対象は${e(race.history?.trained_through || '未取得')}までです。通過条件が確認できない選手を勝負掛け扱いにはしません。</p>`;
  const developmentSheet=withdrawn?'<p class="development-empty">欠場があるため、6艇を前提とした展開予想は停止しています。</p>':renderDevelopment(race.items.length?race:{...race,probabilities:[]},developmentLane);
  const sheetTabs=`<div class="entry-tabs" role="tablist" aria-label="出走表・展示情報・展開予想・結果"><button id="entries-tab" role="tab" aria-selected="${entryTab==='entries'}" aria-controls="entries-panel">出走表</button><button id="exhibition-tab" role="tab" aria-selected="${entryTab==='exhibition'}" aria-controls="exhibition-panel">展示情報・過去傾向</button><button id="development-tab" role="tab" aria-selected="${entryTab==='development'}" aria-controls="development-panel">展開予想</button><button id="result-tab" role="tab" aria-selected="${entryTab==='result'}" aria-controls="result-panel">結果</button></div><div id="entries-panel" role="tabpanel" aria-labelledby="entries-tab" ${entryTab==='entries'?'':'hidden'}>${entrySheet}</div><div id="exhibition-panel" role="tabpanel" aria-labelledby="exhibition-tab" ${entryTab==='exhibition'?'':'hidden'}>${exhibit}</div><div id="development-panel" role="tabpanel" aria-labelledby="development-tab" ${entryTab==='development'?'':'hidden'}>${developmentSheet}</div><div id="result-panel" role="tabpanel" aria-labelledby="result-tab" ${entryTab==='result'?'':'hidden'}>${renderRaceResult(originalRace,now,resultComparison(originalRace,now))}</div>`;
  const legacyScores=`<section class="score-section"><div class="table-heading"><h3>予想のもとになる各スコア</h3></div>${table(['枠','選手','基礎スコア','履歴補正','総合スコア'],(race.scores || []).map(x=>[e(x.lane),e(x.name),numeric(x.base_score),signed(x.history_adjustment),numeric(x.total)]))}<p class="small-note">${race.items.length?'表示中の保存予想に用いた計算値です。最新の出走表とは取得時刻が異なる場合があります。':'出走表から計算した参考スコアです。必須データが欠けるため予想には使用していません。'}スコアは順位付け用で、的中率ではありません。履歴の特徴量は件数が少ない場合に縮小し、検証で採用した係数だけを適用します。</p><details><summary>全国・当地・モーター・ST・枠番と履歴補正の内訳</summary>${table(['枠','全国勝率','当地勝率','モーター','平均ST','枠番'],(race.scores || []).map(x=>[e(x.lane),...(x.base_components || [null,null,null,null,null]).map(numeric)]))}${(race.scores || []).map(x=>`<details><summary>${e(x.lane)}号艇 / 履歴補正の内訳</summary>${table(['項目','補正前の特徴量','適用スコア'],x.history_components.map(c=>[e(c.label),signed(c.raw_value),signed(c.value)]))}</details>`).join('')}</details></section>`;
  const scores=annual?`<section class="score-section"><div class="table-heading"><h3>予想のもとになる各スコア</h3></div>${table(['枠','選手','履歴モデルスコア'],(race.scores||[]).map(x=>[e(x.lane),e(x.name),signed(x.total)]))}<p class="small-note">直近365日の選手・枠別の着順、STと安定度、スタート順位、決まり手の実績から算出したスコアです。確率は順位モデルによる推定値で、的中率を保証しません。少数の履歴は全体の傾向へ寄せます。</p>${renderVenueSummary(race)}${(race.scores||[]).map(x=>`<details><summary>${e(x.lane)}号艇 / 特徴量とスコアの内訳</summary>${table(['項目','特徴量','適用スコア'],(x.history_components||[]).map(c=>[e(c.label),signed(c.raw_value),signed(c.value)]))}</details>`).join('')}</section>`:legacyScores;
  const marketItems=(originalRace.odds?.items || []).filter(row=>matchesPredictionScenario(row.combo,predictionScenario));
  const market = marketItems.length ? `<details class="market-odds"><summary>3連単オッズ一覧（${marketItems.length}通り / ${predictionScenario==='in'?'1号艇1着':predictionScenario==='other'?'1号艇以外が1着':'すべて'}）</summary><p class="small-note">取得 ${e(clock(originalRace.odds.fetched_at))} / ${status.currentOdds ? '締切前・取得時点のオッズ' : '参考オッズ。取得時刻・締切・更新状態を確認してください。'}${savedProposal?' / 保存提案の期待値には上の保存オッズを使います。この一覧は最新取得値です。':''}</p>${table(['買い目','取得時点オッズ'],marketItems.map(x=>[e(x.combo),`${x.odds.toFixed(1)}倍`]))}</details>` : '<p class="small-note">この条件の3連単オッズは未取得・未提供です。</p>';
  const scenarios=`<div class="prediction-scenarios" role="group" aria-label="1着の傾向で絞り込み"><button data-scenario="all" aria-pressed="${predictionScenario==='all'}"><span>すべて</span><strong>${scenarioMass?'100%':'—'}</strong></button>${[['in','イン逃げ想定','1号艇が1着'],['other','それ以外','1号艇以外が1着']].map(([key,label,detail])=>`<button data-scenario="${key}" aria-pressed="${predictionScenario===key}"><span>${label}</span><strong>${pct(scenarioMass?.[key])}</strong><small>${detail}</small></button>`).join('')}</div><p class="small-note scenario-note">${scenarioMass?'全120通りの推定確率を集計。イン逃げ想定は1号艇1着として分類し、実際の進入・決まり手の確率を示すものではありません。':'全120通りの確率を確認できないため、傾向別の確率は表示できません。'}</p>`;
  const unavailableReason=!canRank?`期待値上位は表示できません：${status.text}。${cutoffReached?'締切3分前以前の保存記録を確認できません。':'締切前で新鮮なオッズの取得をお待ちください。'}`:'期待値を計算できる買い目がありません。';
  const chosen = pool.filter(row=>chosenCombos.has(row.combo));
  const related=sujiCandidates(pool,race.odds?.items || [],[...chosenCombos],{scenario:predictionScenario,currentOdds:canRank});
  const relatedBlock=`<section class="related-bets" aria-labelledby="related-title"><h4 id="related-title">選んだ買い目から、スジの候補（最大10点）</h4>${chosen.length?`<div class="related-selection"><span>選択中 ${chosen.length}点</span>${chosen.map(row=>`<button class="combo-select" data-combo="${e(row.combo)}" aria-pressed="true" aria-label="${e(row.combo)}の選択を解除"><strong>${e(row.combo)}</strong><small>確率 ${pct(row.probability)} / 期待値 ${canRank && oddsMap.has(row.combo)?(row.probability*oddsMap.get(row.combo)).toFixed(3)+'倍':'—'}</small></button>`).join('')}<button id="clear-bets" class="text-button">選択をクリア</button></div>${related.length?table(['買い目 / スジ','推定確率','オッズ','期待値'],related.map(row=>[`<button class="combo-select" data-combo="${e(row.combo)}" aria-pressed="false" aria-label="${e(row.combo)}を追加選択">${e(row.combo)}</button><small class="suji-reason">${e(row.reason)}<br>軸：${row.based_on.slice(0,2).map(e).join('、')}${row.based_on.length>2?' ほか'+(row.based_on.length-2)+'点':''}</small>`,pct(row.probability),`${row.odds.toFixed(1)}倍`,`${row.value.toFixed(3)}倍`])):`<p class="related-empty" role="status">${canRank?'選択中の傾向で、未選択かつオッズを確認できるスジ候補はありません。':`現在は候補の提案を休止しています：${e(status.text)}。締切前の新鮮なオッズが必要です。`}</p>`}<p class="small-note">複数の選択買い目から、同じ1着を軸に2・3着の入れ替え、または相手を1艇以上残した相手替えを集め、選択済みと重複を除いた期待値上位10点を提案します。表示中の傾向で絞り込みます。決まり手を推定したスジではありません。期待値は各1点の値で、1.0倍未満なら推定払戻が購入額を下回ります。複数の買い目が同時に的中するものではありません。</p>`:'<p class="related-empty">買い目を複数押して選択してください。同じ買い目をもう一度押すと解除でき、選択済みを除くスジ候補を重複なし・最大10点で提案します。</p>'}</section>`;
  const forecast = race.items.length ? `<div class="time-note"><span>予想入力取得：${e(clock(race.input_fetched_at))}</span><span>予想保存：${e(clock(race.prediction_saved_at))}</span><span>オッズ取得：${e(clock(race.odds?.fetched_at))}</span></div>
    ${savedProposal?`<div class="proposal-notice" role="status"><strong>締切3分前の保存提案${status.code==='CLOSED'?' / 締切済み':''}</strong><span>基準 ${e(clock(savedProposal.cutoff_at))} / オッズ取得 ${e(clock(savedProposal.odds.fetched_at))} / 記録 ${e(clock(savedProposal.proposal_saved_at))}</span><span>基準時刻以前の最新成功記録です。この提案の確率・オッズ・期待値は以後更新しません。</span></div>`:cutoffReached?'<p class="small-note proposal-missing">締切3分前以前の提案は未保存です。後から取得したオッズで当時の提案を作り直しません。</p>':''}
    <div class="table-heading"><h3>予想 / 買い目</h3><span class="small-note">${e(displayedModel)}</span></div>
    ${scenarios}
    <div class="entry-tabs prediction-tabs" role="tablist" aria-label="予想の並び順"><button id="probability-tab" role="tab" aria-selected="${predictionTab==='probability'}" aria-controls="prediction-panel">推定確率（的中率）上位</button><button id="value-tab" role="tab" aria-selected="${predictionTab==='value'}" aria-controls="prediction-panel">オッズを含めた期待値上位</button></div>
    <div id="prediction-panel" role="tabpanel" aria-labelledby="${predictionTab==='value'?'value':'probability'}-tab">${forecastItems.length?`<div class="prediction-table">${table(['順位', '買い目', '推定確率', 'オッズ', '期待値'], forecastItems.map((x,i) => {
      const odds = x.odds;
      return [`<span class="rank ${i === 0 ? 'first' : ''}">${i+1}</span>`, `<button class="combo-select" data-combo="${e(x.combo)}" aria-pressed="${chosenCombos.has(x.combo)}" aria-label="${e(x.combo)}${chosenCombos.has(x.combo)?'の選択を解除':'を追加選択'}">${e(x.combo)}</button>`, pct(x.probability), odds == null ? '—' : `${odds.toFixed(1)}倍${!canRank ? '（参考）' : ''}`, canRank && odds != null ? `${(x.probability * odds).toFixed(3)}倍` : '—'];
    }))}</div><div class="prediction-pagination"><span role="status">${forecastItems.length} / ${ranked.length}点を表示</span>${forecastItems.length<ranked.length?'<button id="more-predictions">追加で10点見る</button>':''}</div>`:`<p class="empty-value" role="status">${e(unavailableReason)}</p>`}</div>
    ${relatedBlock}
    ${race.model_status==='EXPERIMENTAL'?`<p class="small-note">${correctionPending?'履歴は集計済み・予想への補正は未適用です。表示中の予想は固定式で計算しています。':'履歴補正は検証中です。'}</p>`:''}
    <p class="small-note">選択した傾向の買い目を10点ずつ表示します。買い目は複数選択・解除でき、選択内容から関連候補を確認できます。絞り込み後も推定確率と期待値はレース全体に対する値です。推定確率はモデルの計算値で、実測の的中率ではありません。期待値は推定確率 × 取得時点のオッズです。オッズが未提供の買い目は期待値順位の対象外です。オッズは変動します。オッズ更新の目安は締切30分以内が1分、それより先が5分です。提案は締切3分前以前の最新成功記録を当日中保持します。処理の遅延や保存欠損が生じる場合があります。</p>`
    : `<div class="empty"><h3>このレースの予想は未取得です</h3><p>${e(race.issue || '必須データが確認できていません。')}</p></div>`;
  patchHTML($('live-content'), `<div class="race-layout"><nav class="race-nav" aria-label="レース選択">${current.races.map(r => `<button data-race="${r.race_no}" aria-pressed="${r.race_no === selected}"><b>${r.race_no}R</b><span>${r.deadline_at ? e(new Date(r.deadline_at).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'})) : '未確認'}</span></button>`).join('')}</nav><article class="race-card"><div class="race-heading"><div><h3>${e(name)} ${race.race_no}R</h3><p>締切予定 ${e(clock(race.deadline_at))}（日本時間）</p></div><span class="status ${status.currentOdds ? '' : status.code === 'CLOSED' ? 'closed' : 'warn'}">${e(status.text)}</span></div>${entryAlerts}${sheetTabs}${forecast}${scores}${market}${race.issue || race.entries_issue || race.exhibition_issue ? `<p class="small-note">更新状況：${e([race.issue,race.entries_issue,race.exhibition_issue].filter(Boolean).join(' / '))}</p>` : ''}${sources ? `<a class="source-link" href="${e(sources)}" target="_blank" rel="noopener noreferrer">公式の出走表・締切を確認する ↗</a>` : ''}</article></div>`);
  $('entries-tab').onclick=(()=>{entryTab='entries';renderCurrent();});
  $('exhibition-tab').onclick=(()=>{entryTab='exhibition';renderCurrent();});
  $('result-tab').onclick=(()=>{entryTab='result';renderCurrent();});
  $('development-tab').onclick=(()=>{entryTab='development';renderCurrent();});
  const water=$('development-water');
  if(water){
    const lane=water.dataset.developmentLane;const key=`${raceKey}/${lane}`;
    water.dataset.raceKey=key;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(water!==previousWater || previousMotion?.key!==key){
    water.setCurrentTime(entryTab==='development'?(previousMotion?.key===key?Math.min(6,previousMotion.time):reduced?6:0):0);
    if(entryTab!=='development' || (previousMotion?.key===key?previousMotion.paused:reduced))water.pauseAnimations();else water.unpauseAnimations();
    }
    const updatePause=()=>{const button=$('development-pause');if(button && $('development-water')===water)button.textContent=water.animationsPaused()||water.getCurrentTime()>=6?'再生する':'一時停止';};updatePause();
    const motion=water.querySelector('animateMotion');if(motion){if(motion._pauseListener)motion.removeEventListener('endEvent',motion._pauseListener);motion._pauseListener=updatePause;motion.addEventListener('endEvent',updatePause);}
    $('development-replay').onclick=(()=>{water.setCurrentTime(0);water.unpauseAnimations();updatePause();});
    $('development-pause').onclick=(()=>{if(water.getCurrentTime()>=6){water.setCurrentTime(0);water.unpauseAnimations();}else if(water.animationsPaused())water.unpauseAnimations();else water.pauseAnimations();updatePause();});
  }
  for(const button of document.querySelectorAll('button[data-development-lane]'))button.onclick=(()=>{developmentLane=Number(button.dataset.developmentLane);renderCurrent();document.querySelector(`[data-development-lane="${developmentLane}"]`)?.focus({preventScroll:true});});
  for(const button of document.querySelectorAll('[data-development-combo]'))button.onclick=(()=>{
    const combo=button.dataset.developmentCombo;
    if(!pool.some(r=>r.combo===combo))return;
    predictionScenario='all';chosenCombos.add(combo);renderCurrent();
    const target=$('related-title');target.tabIndex=-1;target.focus({preventScroll:true});target.closest('.related-bets').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  });
  for(const ids of [['entries-tab','exhibition-tab','development-tab','result-tab'],['probability-tab','value-tab']]){
    const active=ids.length===4?['entries','exhibition','development','result'].indexOf(entryTab):predictionTab==='probability'?0:1;
    ids.forEach((id,i)=>{const button=$(id);if(!button)return;button.tabIndex=i===active?0:-1;button.onkeydown=(event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?ids.length-1:(i+(event.key==='ArrowRight'?1:ids.length-1))%ids.length;$(ids[next]).click();$(ids[next]).focus();}});});
  }
  for (const button of document.querySelectorAll('[data-race]')) button.onclick=( () => {selected = Number(button.dataset.race); renderCurrent();});
  if($('probability-tab'))$('probability-tab').onclick=(()=>{predictionTab='probability';predictionLimit=10;renderCurrent();$('probability-tab').focus();});
  if($('value-tab'))$('value-tab').onclick=(()=>{predictionTab='value';predictionLimit=10;renderCurrent();$('value-tab').focus();});
  for(const button of document.querySelectorAll('[data-scenario]'))button.onclick=(()=>{
    predictionScenario=button.dataset.scenario;predictionLimit=10;renderCurrent();
    document.querySelector(`[data-scenario="${predictionScenario}"]`)?.focus({preventScroll:true});
  });
  if($('clear-bets'))$('clear-bets').onclick=(()=>{chosenCombos.clear();renderCurrent();});
  if($('more-predictions'))$('more-predictions').onclick=(()=>{
    const previous=predictionLimit;predictionLimit+=10;renderCurrent();
    const added=document.querySelectorAll('.prediction-table [data-combo]')[previous];added?.focus({preventScroll:true});
  });
  for(const button of document.querySelectorAll('[data-combo]'))button.onclick=(()=>{
    const combo=button.dataset.combo;
    if(chosenCombos.has(combo))chosenCombos.delete(combo);else chosenCombos.add(combo);
    renderCurrent();document.querySelector(`[data-combo="${combo}"]`)?.focus({preventScroll:true});
  });

}

function renderArchive() {
  if (!archive) return;
  const days = archive.days.filter(day => (day.venue_code || '01') === selectedVenue);
  if (!days.length) {
    $('archive-content').innerHTML = `<div class="empty"><h3>${e(venueName())}の検証記録はまだありません</h3><p>他の場の成績を、この場の成績として表示しません。今日の予想は「今日の予想」から確認できます。</p></div>`;
    return;
  }
  const evaluated = days.reduce((n, d) => n + d.evaluated_races, 0);
  const missing = days.reduce((n, d) => n + d.no_prediction_races.length, 0);
  const summary = [1,3,5,10].map(n => {
    const totals = {top_n:n, evaluated_races:0, hits:0, stake_yen:0, hit_payout_yen:0, refund_yen:0, net_yen:0};
    for (const day of days) for (const key of Object.keys(totals).filter(k => k !== 'top_n')) totals[key] += day.summary.find(s => s.top_n === n)[key];
    totals.return_rate = totals.stake_yen ? (totals.hit_payout_yen + totals.refund_yen)/totals.stake_yen : null;
    return totals;
  });
  const summaryHTML = rows => table(['条件','評価数','的中','仮想投資','払戻','返還','収支','回収率'], rows.map(s => [`上位${s.top_n}点`,`${s.evaluated_races}件`,`${s.hits}件`,yen(s.stake_yen),yen(s.hit_payout_yen),yen(s.refund_yen),`<span class="${s.net_yen < 0 ? 'negative' : 'positive'}">${yen(s.net_yen)}</span>`,pct(s.return_rate)]));
  $('archive-content').innerHTML = `<div class="stats"><article class="stat"><span>評価できた保存予想</span><strong>${evaluated}<small>件</small></strong></article><article class="stat"><span>予想なし・分母から除外</span><strong>${missing}<small>件</small></strong></article><article class="stat"><span>同じ条件での検証日数</span><strong>${days.length}<small>日</small></strong></article></div><article class="archive-card"><h3>累積成績</h3><p>すべて1点100円の仮想計算です。各上位点数は別条件であり、合算しません。</p>${summaryHTML(summary)}</article>`
    + days.map(day => `<article class="archive-card"><h3>${e(day.date)} / ${e(day.venue || venueName())}</h3><p>過去の検証記録です。本日の予想・現在のオッズではありません。</p>${summaryHTML(day.summary)}<details><summary>保存予想と確定結果を確認する</summary><div class="record-list">${day.races.map(r => `<div><strong>${r.race_no}R</strong>　予想保存 ${e(clock(r.prediction_saved_at))}　公式結果 ${e(r.official_result.combo)}　払戻 ${yen(r.official_result.payout_yen_per_100)} / 100円　結果の予想順位 ${r.evaluation.actual_rank}位</div>`).join('')}</div></details></article>`).join('')
    + '<p class="small-note">分類：締切前のローカル保存記録（第三者の時刻証明なし）。少数の検証で将来の収益性やモデルの優位性は結論づけられません。</p>';
}

async function load({forceOdds=false}={}) {
  const version = ++loadVersion;
  const requestedVenue = selectedVenue;
  $('refresh-button').disabled = true;
  $('refresh-button').setAttribute('aria-busy','true');
  $('refresh-button').textContent='更新中…';
  try {
    // Manual refresh reads the shared Cloudflare snapshot directly once connected,
    // preserving the displayed entries and saved proposals if that request fails.
    if(!forceOdds || !liveOdds || !current || current.venue_code!==selectedVenue) {
      const response = await fetch(new URL('./data/current.json', document.baseURI), {cache:'no-store'});
      if (!response.ok) throw Error('開催一覧を読み込めませんでした');
      const nextCatalog = await response.json();
      if (version !== loadVersion) return;
      if (nextCatalog.schema_version !== 1 || !Array.isArray(nextCatalog.venues)
        || nextCatalog.venues.length !== 24 || new Set(nextCatalog.venues.map(v => v.code)).size !== 24
        || nextCatalog.venues.some(v => !/^(0[1-9]|1\d|2[0-4])$/.test(v.code) || typeof v.name !== 'string')) throw Error('開催一覧の形式を確認できませんでした');
      catalog = nextCatalog;
      if (!selectedVenue) {
        const query = new URL(location.href).searchParams.get('venue');
        selectedVenue = catalog.venues.some(v => v.code === query) ? query
          : catalog.venues.find(v => v.meeting_status === 'OPEN' && freshUpdate(v.update,catalog.date))?.code || '01';
        clearCurrent();
      }
      renderVenueOptions();renderOpportunities();
      const code = requestedVenue || selectedVenue;
      let value = catalog;
      if (code !== '01') {
        const result = await fetch(new URL(`./data/venues/${code}.json`, document.baseURI), {cache:'no-store'});
        if (!result.ok) throw Error(`${venueName()}のデータを読み込めませんでした`);
        value = await result.json();
      }
      if (version !== loadVersion || code !== selectedVenue) return;
      if (value.schema_version !== 1 || value.venue_code !== code || value.venue !== venueName() || !Array.isArray(value.races)
        || value.races.some(r => r.date !== value.date || r.venue_code !== code)) throw Error('選んだ場と表示データが一致しません');
      current = value;
    }
    await refreshOdds({force:forceOdds});
    if(version!==loadVersion || requestedVenue && requestedVenue!==selectedVenue)return;
    applyOddsState();renderOpportunities();
    renderCurrent();
  } catch (error) {
    if (version !== loadVersion) return;
    if (current) current = {...current, update:{...current.update,status:'FAILED',message:'表示データの再取得に失敗しました。'}};
    renderCurrent();
    if (!current) {
      $('meeting-title').textContent = `${venueName()}の情報を取得できませんでした`;
      $('meeting-detail').textContent = '時間をおいて再度ご確認ください。';
      $('live-content').textContent = '出走表・オッズ・予想を読み込めませんでした。';
    }
    $('update-status').hidden=false;$('update-status').textContent = '更新に失敗しました';
    $('update-dot').classList.remove('ok');
    notify(error.message + '。公式サイトも確認してください。');
  } finally { if (version === loadVersion) {
    $('refresh-button').disabled = false;
    $('refresh-button').setAttribute('aria-busy','false');
    $('refresh-button').innerHTML='表示を更新 <span>↻</span>';
  } }
}
for(const button of document.querySelectorAll('[data-featured-tab]'))button.addEventListener('click',()=>{featuredTab=button.dataset.featuredTab;renderOpportunities();});
$('clear-venue-filters').addEventListener('click',()=>{for(const key of Object.keys(venueFilters))venueFilters[key]=null;renderVenueFilters();});
$('venue-select').addEventListener('change', () => {
  selectedVenue = $('venue-select').value;
  clearCurrent();
  load();
});
$('live-tab').addEventListener('click', () => showView('live'));
$('archive-tab').addEventListener('click', () => showView('archive'));
$('releases-tab').addEventListener('click',()=>showView('releases'));
const routeView=()=>showView(location.hash==='#releases'?'releases':location.hash==='#archive'?'archive':'live');
window.addEventListener('popstate',routeView);window.addEventListener('hashchange',routeView);routeView();
$('refresh-button').addEventListener('click',()=>load({forceOdds:true}));
await load();
try {
  const response = await fetch(new URL('./data/archive.json', document.baseURI));
  if (!response.ok) throw Error('検証記録を読み込めませんでした');
  archive = await response.json(); renderArchive();
} catch { $('archive-content').textContent = '検証記録を読み込めませんでした。時間をおいて再度ご確認ください。'; }
setInterval(()=>{if(!document.hidden && view==='live')load();}, 300000);
setInterval(async()=>{if(!document.hidden && view==='live'){await refreshOdds();applyOddsState();renderOpportunities();renderCurrent();}}, ODDS_INTERVAL_MS);
document.addEventListener('visibilitychange',()=>{if(!document.hidden && view==='live')load();});
setInterval(() => {if (catalog) {renderVenueOptions();renderOpportunities();}if (view === 'live') renderCurrent();}, 15000);
