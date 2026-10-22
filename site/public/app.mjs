import {escape as e, raceStatus, safeSource, japanDate, venueTags, filterVenues, venueFilterGroups} from './view.mjs';
import {ODDS_INTERVAL_MS, validateLiveOdds, applyLiveOdds, liveOpportunities} from './odds-live.mjs';
const $ = id => document.getElementById(id);
const yen = n => `${n.toLocaleString('ja-JP')}円`;
const pct = n => n == null ? '—' : `${(n * 100).toFixed(1)}%`;
const clock = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('ja-JP', {timeZone:'Asia/Tokyo', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit'}).format(new Date(value)) : '未確認';
let current = null, archive = null, catalog = null, selected = null, selectedVenue = null, predictionTab = 'probability', view = 'live', entryTab = 'entries', loadVersion = 0;
let oddsConfigPromise=null,liveOdds=null,oddsAttempt=0,oddsRequest=null,oddsFailure=null;
async function refreshOdds() {
  if(!oddsConfigPromise)oddsConfigPromise=(async()=>{
    const response=await fetch(new URL('./data/odds-config.json',document.baseURI),{cache:'no-store'});
    if(!response.ok)throw Error('オッズ更新の設定を読み込めません');
    const config=await response.json();
    if(config.schema_version!==1 || config.interval_seconds!==300)throw Error('オッズ更新の設定が不正です');
    if(config.api_url){const u=new URL(config.api_url);if(u.protocol!=='https:' || u.pathname!=='/v1/odds' || u.search || u.hash || u.username || u.password)throw Error('オッズAPIの接続先が不正です');}
    return config;
  })();
  let config;
  try {config=await oddsConfigPromise;}catch(error){oddsConfigPromise=null;oddsFailure=error.message;return;}
  if(!config.api_url)return;
  if(oddsRequest)return oddsRequest;
  if(Date.now()-oddsAttempt<ODDS_INTERVAL_MS && liveOdds?.date===japanDate(Date.now()))return;
  if(Date.now()-oddsAttempt<ODDS_INTERVAL_MS && oddsFailure)return;
  oddsAttempt=Date.now();
  oddsRequest=(async()=>{
    try {
      const url=new URL(config.api_url);url.searchParams.set('date',japanDate(Date.now()));
      const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('オッズの5分更新を確認できません');
      liveOdds=validateLiveOdds(await response.json(),japanDate(Date.now()));oddsFailure=null;
      if(liveOdds.update?.status==='FAILED')oddsFailure=liveOdds.update.message || 'オッズの取得に失敗しました';
    }catch(error){oddsFailure=error.message;liveOdds=null;}
    finally{oddsRequest=null;}
  })();
  return oddsRequest;
}
function applyOddsState() {
  if(liveOdds && current)current=applyLiveOdds(current,liveOdds);
  if(oddsFailure && current)current={...current,races:current.races.map(r=>({...r,odds_update:{status:'FAILED',message:oddsFailure}}))};
  const latest=liveOdds?.races.reduce((value,r)=>r.status==='OK' && Date.parse(r.fetched_at)>Date.parse(value || '1970-01-01')?r.fetched_at:value,null);
  $('odds-status').textContent=oddsFailure?`オッズ更新失敗：${oddsFailure}`:liveOdds?`オッズ取得：${clock(latest)} / 5分間隔${liveOdds.update?.status==='UPDATING'?'（更新中）':''}`:'';
}
const venueFilters={held:'OPEN',grade:null,day:null,schedule:null};
const shortClock=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'未確認';
const venueName = () => catalog?.venues.find(v => v.code === selectedVenue)?.name || '選んだ場';
const freshUpdate = (update, date) => date === japanDate(Date.now()) && ['OK','PARTIAL'].includes(update?.status)
  && Number.isFinite(Date.parse(update.last_success_at)) && Date.parse(update.last_success_at) <= Date.now() + 60000
  && Date.now() - Date.parse(update.last_success_at) <= 10 * 60000;
function identifyVenue() {
  for (const element of document.querySelectorAll('[data-venue-name]')) element.textContent = venueName();
  document.title = `BOATRACE NOTE | ${venueName()}のモデル予想とオッズ`;
}
function renderVenueOptions() {
  const facts = venue => {
    const sameDay = catalog.date === japanDate(Date.now());
    const held = sameDay && venue.meeting_status === 'OPEN';
    const absent = sameDay && venue.meeting_status === 'NO_MEETING';
    const m = sameDay ? venue.meeting || {} : {};
    const day = m.day_label === '最終日' && m.meeting_day ? `最終日（${m.meeting_day}日目）` : m.day_label || (m.meeting_day ? `${m.meeting_day}日目` : '日次未確認');
    return [held ? '本日開催' : absent ? '非開催' : '開催未確認', ...(absent ? [] : [m.grade || 'グレード未確認',day,m.schedule_type || '時間帯未確認']),
      freshUpdate(venue.update,catalog.date) ? venue.update.status === 'PARTIAL' ? '一部取得失敗' : '取得確認済み' : '更新待ち'];
  };
  $('venue-select').innerHTML = catalog.venues.map(v => `<option value="${e(v.code)}">${e(v.name)} · ${facts(v).map(e).join(' / ')}</option>`).join('');
  $('venue-select').value = selectedVenue;
  const venue = catalog.venues.find(v=>v.code===selectedVenue);
  $('venue-facts').innerHTML = venue ? facts(venue).map(text=>`<span class="pill">${e(text)}</span>`).join('') : '';
  $('venue-title').textContent = catalog.date===japanDate(Date.now()) && venue?.meeting_status === 'OPEN' ? venue.meeting?.title || '' : '';
  const count = catalog.venues.filter(v => venueTags(v,catalog.date).held==='OPEN').length;
  $('venue-summary').textContent = `全${catalog.venues.length}場 / 本日開催 ${count}場`;
  identifyVenue();renderVenueFilters();
}
function renderVenueFilters() {
  const groups=venueFilterGroups(catalog.venues,catalog.date);
  $('venue-filter-tags').innerHTML=groups.map(group=>`<div class="venue-filter-row" role="group" aria-label="${e(group.label)}"><span>${e(group.label)}</span><div class="venue-filter-options"><button data-venue-filter="${group.key}" data-filter-value="" aria-pressed="${!venueFilters[group.key]}">すべて</button>${group.options.map(option=>`<button data-venue-filter="${group.key}" data-filter-value="${e(option.value)}" aria-pressed="${venueFilters[group.key]===option.value}">${e(option.label)}</button>`).join('')}</div></div>`).join('');
  const matches=filterVenues(catalog.venues,venueFilters,catalog.date);
  $('venue-results-count').textContent=`該当 ${matches.length}場 / 全${catalog.venues.length}場`;
  const scroll=$('venue-results').scrollTop;
  $('venue-results').innerHTML=matches.length?matches.map(venue=>{
    const tags=venueTags(venue,catalog.date);
    const details=tags.held==='OPEN'?[tags.grade || 'グレード未確認',tags.final?'最終日':tags.day?`${tags.day}日目`:'日次未確認',tags.schedule || '時間帯未確認']:[tags.held==='NO_MEETING'?'非開催':'開催未確認'];
    return `<button class="venue-result" data-venue-result="${e(venue.code)}" aria-pressed="${selectedVenue===venue.code}"><strong>${e(venue.name)}</strong><span>${details.map(e).join(' / ')}</span></button>`;
  }).join(''):'<p class="venue-filter-empty">この条件に合う場はありません。条件を外すか「絞り込みをクリア」を選んでください。</p>';
  $('venue-results').scrollTop=scroll;
  for(const button of document.querySelectorAll('[data-venue-filter]'))button.addEventListener('click',()=>{
    const key=button.dataset.venueFilter,value=button.dataset.filterValue || null;
    venueFilters[key]=venueFilters[key]===value?null:value;renderVenueFilters();
    document.querySelector(`[data-venue-filter="${key}"][data-filter-value="${value || ''}"]`)?.focus({preventScroll:true});
  });
  for(const button of document.querySelectorAll('[data-venue-result]'))button.addEventListener('click',()=>{
    $('venue-select').value=button.dataset.venueResult;$('venue-select').dispatchEvent(new Event('change'));
  });
}
function clearCurrent() {
  current = null;selected = null;entryTab='entries';identifyVenue();
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
  $('live-view').hidden = name !== 'live';
  $('archive-view').hidden = name !== 'archive';
  $('opportunities-section').hidden = name !== 'live';
  $('live-tab').setAttribute('aria-pressed', String(name === 'live'));
  $('archive-tab').setAttribute('aria-pressed', String(name === 'archive'));
}

function notify(message) { $('message').textContent = message; $('message').hidden = !message; }


function renderOpportunities() {
  const now=Date.now();
  const rows=(oddsFailure?[]:liveOdds?liveOpportunities(liveOdds,now):catalog?.opportunities || []).filter(x=>x.date===japanDate(now) && Date.parse(x.deadline_at)>now
    && ['OK','PARTIAL'].includes(x.update_status) && x.classification==='PRERACE_ODDS_LOCAL_RECORD_UNVERIFIED'
    && [x.fetched_at,x.recorded_at,x.last_success_at].every(t=>Number.isFinite(Date.parse(t)) && Date.parse(t)<=now+60000 && now-Date.parse(t)<=10*60000));
  $('opportunities-content').innerHTML=rows.length?`<div class="opportunity-grid">${rows.slice(0,3).map((x,i)=>`<button class="opportunity-card" data-opportunity-venue="${e(x.venue_code)}" data-opportunity-race="${x.race_no}" title="${e(x.model_name)} / オッズ取得 ${e(clock(x.fetched_at))}"><span class="opportunity-top"><span class="eyebrow">${i+1} / ${e(x.venue)} ${x.race_no}R</span><span>締切 ${e(shortClock(x.deadline_at))}</span></span><span class="opportunity-main"><strong>${e(x.combo)}</strong><span class="opportunity-value"><b>${x.value.toFixed(3)}</b>倍<small>期待値</small></span></span><span class="opportunity-bottom"><span>${pct(x.probability)} × ${x.odds.toFixed(1)}倍</span><span>${x.model_name?.includes('検証中')?'検証中 / ':''}取得 ${e(shortClock(x.fetched_at))}</span></span></button>`).join('')}</div>`
    : '<div class="opportunity-empty">現在、表示条件を満たすレースはありません。新鮮なオッズで期待値1.0超を確認できないためです。オッズ未提供・更新待ち・締切済みのレースも対象から除外します。</div>';
  for(const button of document.querySelectorAll('[data-opportunity-venue]'))button.addEventListener('click',async()=>{
    const code=button.dataset.opportunityVenue,number=Number(button.dataset.opportunityRace);
    showView('live');selectedVenue=code;clearCurrent();await load();
    if(current?.venue_code===code){selected=number;renderCurrent();$('live-view').scrollIntoView({behavior:'smooth',block:'start'});}
  });
}

function renderCurrent() {
  if (!current) return;
  const now = Date.now();
  const today = japanDate(now);
  const name = current.venue;
  const sameDay = current.date === today;
  const successTime = Date.parse(current.update.last_success_at);
  const fresh = sameDay && ['OK','PARTIAL'].includes(current.update.status) && Number.isFinite(successTime)
    && successTime <= now + 60000 && now - successTime <= 10 * 60000;
  $('updated-at').textContent = `公式データの確認：${clock(current.update.last_success_at)}（日本時間）`;
  $('update-status').textContent = fresh ? current.update.status === 'PARTIAL' ? '一部レースの取得に失敗' : '' : '最新データを確認できていません';
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
    $('meeting-title').textContent = next ? `次の締切予定 ${next.race_no}R` : '本日の締切は終了しました';
    $('meeting-detail').textContent = next ? `${clock(next.deadline_at)}（日本時間）` : '保存済みの予想は参考として確認できます。';
  }
  if (!sameDay || current.races.length === 0) {
    $('live-content').innerHTML = `<div class="empty"><div class="empty-mark">≋</div><h3>${fresh && current.meeting_status === 'NO_MEETING' ? '次の開催で、また記録を。' : '本日の予想はまだ表示できません'}</h3><p>${fresh && current.meeting_status === 'NO_MEETING' ? `本日は${e(name)}の開催が確認できていません。保存済みの検証結果がある場合は、検証記録からご覧いただけます。` : '最新の出走表や必須データが確認できたレースから表示します。過去の記録やサンプルを、本日の予想として使うことはありません。'}</p><button id="empty-archive" class="text-button">これまでの検証記録を見る ↗</button></div>`;
    $('empty-archive').addEventListener('click', () => showView('archive'));
    return;
  }
  if (!current.races.some(r => r.race_no === selected)) selected = current.races.find(r => Date.parse(r.deadline_at) > now)?.race_no || current.races[0].race_no;
  const race = current.races.find(r => r.race_no === selected);
  const status = raceStatus(race, current, now);
  const correctionPending=race.model_validation?.selected_lambda===null;
  const displayedModel=correctionPending?'固定式 / 履歴補正は未適用':race.model_name || '固定スコアモデル v1';
  $('model-label').textContent = displayedModel;
  const sources = safeSource(race.input_source_url);
  const oddsMap = new Map((race.odds?.items || []).map(x => [x.combo, x.odds]));
  const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
  const entrySheet = race.entries?.length ? `<div class="table-heading"><span>最新の出走表</span><span class="small-note">取得 ${e(clock(race.entries_fetched_at || race.input_fetched_at))}</span></div><div class="entry-table">${table(['枠','選手','級別','全国勝率','当地勝率','モーター2連率','ボート2連率','平均ST'],race.entries.map(x => [`<span class="lane lane-${x.lane}">${e(x.lane)}</span>`,e(x.name),e(x.class || '—'),numeric(x.national_win_rate),numeric(x.local_win_rate),numeric(x.motor_2rate),numeric(x.boat_2rate),numeric(x.avg_st)]))}</div>` : '';
  const signed=value=>typeof value==='number'&&Number.isFinite(value)?`${value>0?'+':''}${value.toFixed(3)}`:'—';
  const history=new Map((race.history?.lanes || []).map(x=>[x.lane,x]));
  const showGap=(gap,unit)=>gap?.n?`${signed(gap.mean)}${unit}（${gap.n}件）`:'未集計';
  const exhibit = `<div class="table-heading"><span>今回の展示情報</span><span class="small-note">取得 ${e(clock(race.exhibition_fetched_at))}</span></div>${table(['枠','選手','展示タイム','展示順位','展示ST','展示進入'],(race.entries || []).map(x=>{const h=history.get(x.lane);return [e(x.lane),e(x.name),numeric(x.exhibition_time),h?.exhibition_rank==null?'—':e(h.exhibition_rank),numeric(x.exhibition_st),x.exhibition_course==null?'—':e(x.exhibition_course)];}))}
    <div class="table-heading"><span>展示と本番の差（過去の集計）</span></div>${table(['枠','展示順位→本番着順の差','順位差のRMSE','展示ST→本番STの差','ST差のRMSE'],(race.entries || []).map(x=>{const h=history.get(x.lane);return [e(x.lane),e(showGap(h?.exhibition_rank_gap,'着')),numeric(h?.exhibition_rank_gap?.rmse),e(showGap(h?.exhibition_st_gap,'秒')),numeric(h?.exhibition_st_gap?.rmse)];}))}
    <p class="small-note">差＝本番 − 展示。着順の差がマイナスなら展示順位より上位、ST差がプラスなら展示より本番のスタートが遅い傾向です。RMSEは差の大きさの指標です。今回の本番結果はこの欄に取り込まず、比較は過去の集計だけを表示します。</p>
    <div class="table-heading"><span>開催日・レース区分ごとのST傾向</span></div>${table(['枠','本日と同じ日次の平均ST','日次のSTばらつき','同じ区分の平均ST','区分のSTばらつき','勝負掛け'],(race.entries || []).map(x=>{const h=history.get(x.lane);return [e(x.lane),h?.day?.samples?`${numeric(h.day.st_mean)}（${h.day.samples}件）`:'未集計',numeric(h?.day?.st_sd),h?.phase?.samples?`${numeric(h.phase.st_mean)}（${h.phase.samples}件）`:'未集計',numeric(h?.phase?.st_sd),h?.pressure?.status==='CONFIRMED'?`${h.pressure.required_finish}着以内 / ${h.pressure.required_points}点必要`:h?.pressure?.status==='NOT_REQUIRED'?'対象外（確認済み）':'未確認・補正なし'];}))}
    <p class="small-note">STのばらつきは標準偏差で、小さいほど安定した傾向です。少数の集計は全体の傾向へ寄せて補正します。集計対象は${e(race.history?.trained_through || '未取得')}までです。通過条件が確認できない選手を勝負掛け扱いにはしません。</p>`;
  const sheetTabs=`<div class="entry-tabs" role="tablist" aria-label="出走表と展示情報"><button id="entries-tab" role="tab" aria-selected="${entryTab==='entries'}" aria-controls="entries-panel">出走表</button><button id="exhibition-tab" role="tab" aria-selected="${entryTab==='exhibition'}" aria-controls="exhibition-panel">展示情報・過去傾向</button></div><div id="entries-panel" role="tabpanel" aria-labelledby="entries-tab" ${entryTab==='entries'?'':'hidden'}>${entrySheet}</div><div id="exhibition-panel" role="tabpanel" aria-labelledby="exhibition-tab" ${entryTab==='exhibition'?'':'hidden'}>${exhibit}</div>`;
  const scores=`<section class="score-section"><div class="table-heading"><h3>予想のもとになる各スコア</h3></div>${table(['枠','選手','基礎スコア','履歴補正','総合スコア'],(race.scores || []).map(x=>[e(x.lane),e(x.name),numeric(x.base_score),signed(x.history_adjustment),numeric(x.total)]))}<p class="small-note">${race.items.length?'表示中の保存予想に用いた計算値です。最新の出走表とは取得時刻が異なる場合があります。':'出走表から計算した参考スコアです。必須データが欠けるため予想には使用していません。'}スコアは順位付け用で、的中率ではありません。履歴の特徴量は件数が少ない場合に縮小し、検証で採用した係数だけを適用します。</p><details><summary>全国・当地・モーター・ST・枠番と履歴補正の内訳</summary>${table(['枠','全国勝率','当地勝率','モーター','平均ST','枠番'],(race.scores || []).map(x=>[e(x.lane),...(x.base_components || [null,null,null,null,null]).map(numeric)]))}${(race.scores || []).map(x=>`<details><summary>${e(x.lane)}号艇 / 履歴補正の内訳</summary>${table(['項目','補正前の特徴量','適用スコア'],x.history_components.map(c=>[e(c.label),signed(c.raw_value),signed(c.value)]))}</details>`).join('')}</details></section>`;
  const market = race.odds?.items?.length ? `<details class="market-odds"><summary>3連単オッズ一覧（${race.odds.items.length}通り）</summary><p class="small-note">取得 ${e(clock(race.odds.fetched_at))} / ${status.currentOdds ? '締切前・取得時点のオッズ' : '参考オッズ。取得時刻・締切・更新状態を確認してください。'}</p>${table(['買い目','取得時点オッズ'],race.odds.items.map(x=>[e(x.combo),`${x.odds.toFixed(1)}倍`]))}</details>` : '<p class="small-note">3連単オッズは未取得・未提供です。</p>';
  const expectedItems=(race.expected_value_items || []).filter(x=>Number.isFinite(oddsMap.get(x.combo))).sort((a,b)=>b.probability*oddsMap.get(b.combo)-a.probability*oddsMap.get(a.combo)||a.rank-b.rank).slice(0,10);
  const forecastItems=predictionTab==='value'?(status.currentOdds?expectedItems:[]):race.items.slice(0,10);
  const unavailableReason=!status.currentOdds?`期待値上位は表示できません：${status.text}。締切前で新鮮なオッズの取得をお待ちください。`:'期待値を計算できる買い目がありません。';
  const forecast = race.items.length ? `<div class="time-note"><span>予想入力取得：${e(clock(race.input_fetched_at))}</span><span>予想保存：${e(clock(race.prediction_saved_at))}</span><span>オッズ取得：${e(clock(race.odds?.fetched_at))}</span></div>
    <div class="table-heading"><h3>予想 / 上位10点</h3><span class="small-note">${e(displayedModel)}</span></div>
    <div class="entry-tabs prediction-tabs" role="tablist" aria-label="予想の並び順"><button id="probability-tab" role="tab" aria-selected="${predictionTab==='probability'}" aria-controls="prediction-panel">推定確率（的中率）上位</button><button id="value-tab" role="tab" aria-selected="${predictionTab==='value'}" aria-controls="prediction-panel">オッズを含めた期待値上位</button></div>
    <div id="prediction-panel" role="tabpanel" aria-labelledby="${predictionTab==='value'?'value':'probability'}-tab">${forecastItems.length?`<div class="prediction-table">${table(['順位', '買い目', '推定確率', '取得時点オッズ', '期待値（確率 × オッズ）'], forecastItems.map((x,i) => {
      const odds = oddsMap.get(x.combo);
      return [`<span class="rank ${i === 0 ? 'first' : ''}">${i+1}</span>`, e(x.combo), pct(x.probability), odds == null ? '—' : `${odds.toFixed(1)}倍${!status.currentOdds ? '（参考）' : ''}`, status.currentOdds && odds != null ? `${(x.probability * odds).toFixed(3)}倍` : '—'];
    }))}</div>`:`<p class="empty-value" role="status">${e(unavailableReason)}</p>`}</div>
    ${race.model_status==='EXPERIMENTAL'?`<p class="small-note">${correctionPending?'履歴は集計済み・予想への補正は未適用です。表示中の予想は固定式で計算しています。':'履歴補正は検証中です。'}</p>`:''}
    <p class="small-note">各タブは全120通りから上位10点を選びます。推定確率はモデルの計算値で、実測の的中率ではありません。期待値は推定確率 × 取得時点のオッズです。オッズが未提供の買い目は期待値順位の対象外です。オッズは変動します。更新の目安は5分で、処理の遅延が生じる場合があります。</p>`
    : `<div class="empty"><h3>このレースの予想は未取得です</h3><p>${e(race.issue || '必須データが確認できていません。')}</p></div>`;
  $('live-content').innerHTML = `<div class="race-layout"><nav class="race-nav" aria-label="レース選択">${current.races.map(r => `<button data-race="${r.race_no}" aria-pressed="${r.race_no === selected}"><b>${r.race_no}R</b><span>${r.deadline_at ? e(new Date(r.deadline_at).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'})) : '未確認'}</span></button>`).join('')}</nav><article class="race-card"><div class="race-heading"><div><h3>${e(name)} ${race.race_no}R</h3><p>締切予定 ${e(clock(race.deadline_at))}（日本時間）</p></div><span class="status ${status.currentOdds ? '' : status.code === 'CLOSED' ? 'closed' : 'warn'}">${e(status.text)}</span></div>${sheetTabs}${forecast}${scores}${market}${race.issue ? `<p class="small-note">更新状況：${e(race.issue)}</p>` : ''}${sources ? `<a class="source-link" href="${e(sources)}" target="_blank" rel="noopener noreferrer">公式の出走表・締切を確認する ↗</a>` : ''}</article></div>`;
  $('entries-tab').addEventListener('click',()=>{entryTab='entries';renderCurrent();});
  $('exhibition-tab').addEventListener('click',()=>{entryTab='exhibition';renderCurrent();});
  for(const [ids,active] of [[['entries-tab','exhibition-tab'],entryTab==='entries'?0:1],[['probability-tab','value-tab'],predictionTab==='probability'?0:1]]){
    ids.forEach((id,i)=>{const button=$(id);if(!button)return;button.tabIndex=i===active?0:-1;button.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?1:1-i;$(ids[next]).click();$(ids[next]).focus();}});});
  }
  for (const button of document.querySelectorAll('[data-race]')) button.addEventListener('click', () => {selected = Number(button.dataset.race); renderCurrent();});
  $('probability-tab')?.addEventListener('click',()=>{predictionTab='probability';renderCurrent();$('probability-tab').focus();});
  $('value-tab')?.addEventListener('click',()=>{predictionTab='value';renderCurrent();$('value-tab').focus();});
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

async function load() {
  const version = ++loadVersion;
  const requestedVenue = selectedVenue;
  $('refresh-button').disabled = true;
  try {
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
    await refreshOdds();
    if(version!==loadVersion || code!==selectedVenue)return;
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
  } finally { if (version === loadVersion) $('refresh-button').disabled = false; }
}
$('clear-venue-filters').addEventListener('click',()=>{for(const key of Object.keys(venueFilters))venueFilters[key]=null;renderVenueFilters();});
$('venue-select').addEventListener('change', () => {
  selectedVenue = $('venue-select').value;
  clearCurrent();
  load();
});
$('live-tab').addEventListener('click', () => showView('live'));
$('archive-tab').addEventListener('click', () => showView('archive'));
$('refresh-button').addEventListener('click', load);
await load();
try {
  const response = await fetch(new URL('./data/archive.json', document.baseURI));
  if (!response.ok) throw Error('検証記録を読み込めませんでした');
  archive = await response.json(); renderArchive();
} catch { $('archive-content').textContent = '検証記録を読み込めませんでした。時間をおいて再度ご確認ください。'; }
setInterval(()=>{if(!document.hidden && view==='live')load();}, ODDS_INTERVAL_MS);
document.addEventListener('visibilitychange',()=>{if(!document.hidden && view==='live')load();});
setInterval(() => {if (catalog) {renderVenueOptions();renderOpportunities();}if (view === 'live') renderCurrent();}, 15000);
