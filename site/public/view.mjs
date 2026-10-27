export const MAX_ODDS_AGE_MS = 10 * 60000;
export const japanDate = now => new Date(now + 9 * 3600000).toISOString().slice(0, 10);
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function raceStatus(race, snapshot, now = Date.now()) {
  if (race.date !== japanDate(now)) return {code: 'ARCHIVE', text: '過去の記録', currentOdds: false};
  if(race.entries?.some(e=>e.participation_status==='WITHDRAWN'))return {code:'WITHDRAWN',text:'欠場あり・6艇予想は停止',currentOdds:false};
  const deadline = Date.parse(race.deadline_at);
  if (!Number.isFinite(deadline)) return {code: 'INVALID', text: '締切未確認', currentOdds: false};
  if (now >= deadline) return {code: 'CLOSED', text: '締切済み', currentOdds: false};
  if (!race.items?.length) return {code: 'UNAVAILABLE', text: '予想データ未取得', currentOdds: false};
  if (!race.odds) return {code: 'NO_ODDS', text: 'オッズ未取得', currentOdds: false};
  const fetched = Date.parse(race.odds.fetched_at);
  const recorded = Date.parse(race.odds.recorded_at);
  if (!Number.isFinite(fetched) || !Number.isFinite(recorded) || fetched > now + 60000 || recorded > now + 60000) {
    return {code: 'INVALID', text: 'オッズ時刻を確認できません', currentOdds: false};
  }
  if (race.odds.classification !== 'PRERACE_ODDS_LOCAL_RECORD_UNVERIFIED') return {code: 'REFERENCE', text: '参考オッズ', currentOdds: false};
  if (race.odds_update && race.odds_update.status!=='OK') return {code:'FAILED',text:'オッズの更新を確認できません',currentOdds:false};
  if (!['OK', 'PARTIAL'].includes(snapshot.update.status) || race.issue) return {code: 'FAILED', text: '更新を確認できません', currentOdds: false};
  if (now - fetched > MAX_ODDS_AGE_MS || now - recorded > MAX_ODDS_AGE_MS) return {code: 'STALE', text: 'オッズの更新待ち', currentOdds: false};
  return {code: 'OPEN', text: '締切前・取得時点オッズ', currentOdds: true};
}

export function safeSource(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'www.boatrace.jp' ? url.href : null; }
  catch { return null; }
}

export function venueTags(venue,date,now=Date.now()) {
  const held=date===japanDate(now)?venue.meeting_status:'UNKNOWN';
  const meeting=held==='OPEN'?venue.meeting || {}:{};
  return {held,grade:meeting.grade || null,day:meeting.meeting_day || null,
    final:meeting.day_label==='最終日',schedule:meeting.schedule_type || null};
}
export function filterVenues(venues,filters,date,now=Date.now()) {
  return venues.filter(venue=>{
    const tags=venueTags(venue,date,now);
    return (!filters.held || tags.held===filters.held)
      && ['grade','schedule'].every(key=>!filters[key] || (tags.held==='OPEN' && (filters[key]==='UNKNOWN'?tags[key]===null:tags[key]===filters[key])))
      && (!filters.day || (tags.held==='OPEN' && (filters.day==='FINAL'?tags.final:filters.day==='UNKNOWN'?tags.day===null:tags.day===Number(filters.day))));
  });
}
export function venueFilterGroups(venues,date,now=Date.now()) {
  const tags=venues.map(v=>venueTags(v,date,now)).filter(t=>t.held==='OPEN');
  const options=(key,order)=>[...new Set(tags.map(t=>t[key]).filter(Boolean))].sort((a,b)=>order.indexOf(a)-order.indexOf(b)).map(value=>({value,label:value}));
  const grades=options('grade',['SG','PG1','G1','G2','G3','一般']);
  const days=[...new Set(tags.map(t=>t.day).filter(Boolean))].sort((a,b)=>a-b).map(n=>({value:String(n),label:n===1?'初日':`${n}日目`}));
  if(tags.some(t=>t.final))days.push({value:'FINAL',label:'最終日'});
  const times=options('schedule',['モーニング','デイ','サマータイム','ナイター','ミッドナイト']);
  for(const [key,list] of [['grade',grades],['day',days],['schedule',times]])if(tags.some(t=>t[key]===null))list.push({value:'UNKNOWN',label:'未確認'});
  return [{key:'held',label:'開催',options:[{value:'OPEN',label:'本日開催'},{value:'NO_MEETING',label:'非開催'},{value:'UNKNOWN',label:'開催未確認'}]},
    {key:'grade',label:'グレード',options:grades},{key:'day',label:'開催日',options:days},{key:'schedule',label:'時間帯',options:times}];
}

// Scenario probabilities always use the original, unconditional distribution.
export const matchesPredictionScenario = (combo, scenario) => scenario === 'in' ? combo.startsWith('1-') : scenario === 'other' ? !combo.startsWith('1-') : true;
export function predictionPool(race) {
  const rows = race.probabilities?.length ? race.probabilities : race.items || [];
  const unique = new Map();
  for (const row of rows) {
    if (!/^[1-6]-[1-6]-[1-6]$/.test(row.combo) || new Set(row.combo.split('-')).size !== 3
      || !Number.isFinite(row.probability) || row.probability < 0 || row.probability > 1) continue;
    if (!unique.has(row.combo)) unique.set(row.combo, {...row});
  }
  return [...unique.values()];
}
export function scenarioProbabilities(rows) {
  const total = rows.reduce((sum, row) => sum + row.probability, 0);
  if (rows.length !== 120 || new Set(rows.map(row => row.combo)).size !== 120 || Math.abs(total - 1) > 1e-6) return null;
  return {in: rows.filter(row => row.combo.startsWith('1-')).reduce((sum, row) => sum + row.probability, 0),
    other: rows.filter(row => !row.combo.startsWith('1-')).reduce((sum, row) => sum + row.probability, 0)};
}
export function predictionRanking(rows, quotes, {scenario = 'all', tab = 'probability', currentOdds = false} = {}) {
  const prices = new Map(quotes.filter(row => Number.isFinite(row.odds) && row.odds > 0).map(row => [row.combo, row.odds]));
  if (tab === 'value' && !currentOdds) return [];
  return rows.filter(row => matchesPredictionScenario(row.combo, scenario))
    .map(row => ({...row, odds: prices.get(row.combo) ?? null, value: currentOdds && prices.has(row.combo) ? row.probability * prices.get(row.combo) : null}))
    .filter(row => tab !== 'value' || row.value !== null)
    .sort((a, b) => (tab === 'value' ? b.value - a.value : b.probability - a.probability) || a.combo.localeCompare(b.combo));
}

// Each selected ticket contributes a relationship; rank the union only once.
export function sujiCandidates(rows, quotes, selectedCombos, {scenario = 'all', currentOdds = false, limit = 10} = {}) {
  const selected = new Set(Array.isArray(selectedCombos) ? selectedCombos : selectedCombos ? [selectedCombos] : []);
  const anchors = predictionPool({probabilities:rows}).filter(row => selected.has(row.combo) && matchesPredictionScenario(row.combo, scenario));
  if (!anchors.length) return [];
  return predictionRanking(predictionPool({probabilities:rows}), quotes, {scenario, tab: 'value', currentOdds})
    .filter(row => !selected.has(row.combo))
    .map(row => {
      const [first, second, third] = row.combo.split('-'), relationships = [];
      for (const anchor of anchors) {
        const [a, b, c] = anchor.combo.split('-');
        if (first !== a) continue;
        const reason = second === c && third === b ? '2・3着入れ替え'
          : second === b ? '2着固定・3着替え' : third === c ? '3着固定・2着替え'
          : third === b ? '2着の相手を3着へ' : second === c ? '3着の相手を2着へ' : null;
        if (reason) relationships.push({combo:anchor.combo, reason});
      }
      return {...row, reason:[...new Set(relationships.map(x=>x.reason))].join(' / '), based_on:relationships.map(x=>x.combo)};
    }).filter(row => row.based_on.length).slice(0, Math.max(0,Math.min(10,limit)));
}

export const FEATURED_IN_HIGH = .7;
export const FEATURED_IN_LOW = .3;
// Classify before limiting so one race can belong to only one group.
export function featuredRaceGroups(candidates, now=Date.now()) {
  const unique=new Map(), groups={value:[],high:[],low:[]};
  for (const row of candidates || []) {
    const mass=row?.scenario_probabilities;
    if (!row || row.date!==japanDate(now) || !/^(0[1-9]|1\d|2[0-4])$/.test(row.venue_code)
      || !Number.isInteger(row.race_no) || row.race_no<1 || row.race_no>12
      || !Number.isFinite(Date.parse(row.deadline_at)) || Date.parse(row.deadline_at)<=now || Date.parse(row.deadline_at)>now+3600000
      || !['OK','PARTIAL'].includes(row.update_status) || row.classification!=='PRERACE_ODDS_LOCAL_RECORD_UNVERIFIED'
      || ![row.fetched_at,row.recorded_at,row.last_success_at].every(t=>Number.isFinite(Date.parse(t)) && Date.parse(t)<=now+60000 && now-Date.parse(t)<=MAX_ODDS_AGE_MS)
      || !mass || ![mass.in,mass.other].every(n=>Number.isFinite(n)&&n>=0&&n<=1) || Math.abs(mass.in+mass.other-1)>1e-6
      || !/^[1-6]-[1-6]-[1-6]$/.test(row.combo) || new Set(row.combo.split('-')).size!==3
      || !Number.isFinite(row.probability) || row.probability<0 || row.probability>1 || !Number.isFinite(row.odds) || row.odds<=0
      || !Number.isFinite(row.value) || Math.abs(row.value-row.probability*row.odds)>1e-6) continue;
    const key=`${row.date}/${row.venue_code}/${row.race_no}`, old=unique.get(key);
    if (!old || Date.parse(row.fetched_at)>Date.parse(old.fetched_at)) unique.set(key,row);
  }
  for (const row of unique.values()) {
    const probability=row.scenario_probabilities.in;
    if(probability>=FEATURED_IN_HIGH-1e-12)groups.high.push(row);
    else if(probability<=FEATURED_IN_LOW+1e-12)groups.low.push(row);
    else if(row.value>1)groups.value.push(row);
  }
  const tie=(a,b)=>a.deadline_at.localeCompare(b.deadline_at)||a.venue_code.localeCompare(b.venue_code)||a.race_no-b.race_no;
  groups.value.sort((a,b)=>b.value-a.value||tie(a,b));
  groups.high.sort((a,b)=>b.scenario_probabilities.in-a.scenario_probabilities.in||b.value-a.value||tie(a,b));
  groups.low.sort((a,b)=>a.scenario_probabilities.in-b.scenario_probabilities.in||b.value-a.value||tie(a,b));
  return Object.fromEntries(Object.entries(groups).map(([key,rows])=>[key,rows.slice(0,3)]));
}

export function raceEntryAlerts(race,now=Date.now()) {
 const entries=race.entries||[],absent=entries.filter(e=>e.participation_status==='WITHDRAWN'),active=entries.filter(e=>e.participation_status!=='WITHDRAWN');
 const known=active.filter(e=>Number.isInteger(e.exhibition_course)&&e.exhibition_course>=1&&e.exhibition_course<=6);
 const unique=new Set(known.map(e=>e.exhibition_course)).size===known.length;
 const changes=unique?known.filter(e=>e.exhibition_course!==e.lane):[];
 const complete=entries.length===6&&active.length>0&&active.every(e=>[e.exhibition_time,e.exhibition_st,e.exhibition_course].every(Number.isFinite));
 const due=Date.parse(race.deadline_at)-600000,left=Date.parse(race.deadline_at)-now;
 const state=complete?'AVAILABLE':race.exhibition_issue?'FAILED':now<due?'SCHEDULED':race.exhibition_fetched_at?'PARTIAL':'WAITING';
 return {absent,changes,courseStatus:changes.length?'CHANGED':unique&&known.length===active.length&&active.length>0?'UNCHANGED':'UNKNOWN',state,due,
  retryAt:left>300000?Date.parse(race.deadline_at)-300000:null};
}

export function renderVenueSummary(race){
 const h=race.history?.venue,one=h?.lanes?.find(l=>l.lane===1),valid=n=>Number.isFinite(n)&&n>=0&&n<=1;
 if(!h||h.venue_code!==race.venue_code||!(h.through<race.date)||!Number.isInteger(one?.starts)||one.starts<1||!valid(one.win_rate)||!valid(one.escape_rate))return '';
 const percent=n=>(n*100).toFixed(1)+'%',used=race.scores?.some(s=>s.history_components?.some(c=>c.label==='場・枠別1着傾向'));
 return `<details class="venue-history"><summary>この場の過去の傾向${used?'・予想に反映':''}</summary><p class="small-note">${escape(h.from)}〜${escape(h.through)} / 1枠 ${one.starts.toLocaleString('ja-JP')}走</p><p>1枠1着率 <strong>${percent(one.win_rate)}</strong>${valid(h.national_lane1_win_rate)?`（全国の1枠 ${percent(h.national_lane1_win_rate)}）`:''} / 1枠の逃げ率 <strong>${percent(one.escape_rate)}</strong></p><p class="small-note">過去の実績で、今回の予想確率ではありません。1着率と決まり手が逃げの割合は別集計です。場別項目の適用値は各艇のスコア内訳で確認できます。</p></details>`;
}

export function renderResultComparison(comparison) {
 if(comparison?.status!=='OK')return `<section class="result-comparison"><h4>保存予想との比較</h4><p>${escape(comparison?.reason||'締切前に固定した保存提案がないため比較できません。')}</p></section>`;
 const clock=value=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
 const rank=n=>n===null?'未取得':`${n}位${n<=10?'（上位10点）':''}`;
 return `<section class="result-comparison"><h4>保存予想との比較</h4><p class="small-note">モデル：${escape(comparison.model_name)}<br>予想保存 ${clock(comparison.prediction_saved_at)} / オッズ取得 ${clock(comparison.odds_fetched_at)}<br>固定基準 ${clock(comparison.cutoff_at)}</p><div class="table-wrap"><table><thead><tr><th>確定買い目</th><th>確率順位</th><th>保存時の推定確率</th><th>保存時オッズ</th><th>保存時期待値</th><th>期待値順位</th></tr></thead><tbody>${comparison.rows.map(r=>`<tr><td><strong>${escape(r.combo)}</strong></td><td>${rank(r.probability_rank)}</td><td>${(r.probability*100).toFixed(2)}%</td><td>${r.odds===null?'未取得':r.odds.toFixed(1)+'倍'}</td><td>${r.value===null?'算出不可':r.value.toFixed(3)+'倍'}</td><td>${rank(r.value_rank)}</td></tr>`).join('')}</tbody></table></div><p class="small-note">確率順位は全120点、期待値順位は保存時にオッズを取得できた${comparison.quoted_count}点内で比較します。上位10点の表示は保存予想の順位照合であり、実際の購入・的中履歴ではありません。期待値は保存時の推定確率×オッズです。確定払戻は上の結果欄に表示し、比較値の計算には使いません。</p></section>`;
}
export function renderRaceResult(race,now=Date.now(),comparison=null) {
 const result=race.result,end=Date.parse(race.deadline_at);
 const source=`https://www.boatrace.jp/owpc/pc/race/raceresult?hd=${encodeURIComponent(race.date.replaceAll('-',''))}&jcd=${encodeURIComponent(race.venue_code)}&rno=${encodeURIComponent(race.race_no)}`;
 const link=`<a href="${escape(source)}" target="_blank" rel="noopener noreferrer">公式結果を確認 ↗</a> / <a href="https://race.boatcast.jp/?jo=${encodeURIComponent(race.venue_code)}" target="_blank" rel="noopener noreferrer">この場の公式リプレイ ↗</a>`;
 if(result?.status!=='CONFIRMED')return `<div class="race-result"><p role="status">${now<end?'レース前のため、結果はまだありません。':result?.status==='FAILED'?'結果の取得に失敗しました。次回の定期取得で再試行します。':'結果は未確定・取得待ちです。'}</p><p class="small-note">締切5分後から5分間隔で確定結果を確認します。取得した当日の結果を表示します。</p>${link}</div>`;
 const time=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date(result.fetched_at));
 const tableRows=[...result.entries].sort((a,b)=>(a.finish??99)-(b.finish??99)||a.lane-b.lane).map(e=>`<tr><td>${escape(e.finish??e.finish_status??'—')}</td><td><span class="lane lane-${e.lane}">${e.lane}</span> ${escape(e.name)}</td><td>${e.course??'—'}</td><td>${e.st===null?escape(e.st_status||'未取得'):(e.st_status==='F'?'F':'')+Math.abs(e.st).toFixed(2)}</td><td>${escape(e.race_time||'—')}</td></tr>`).join('');
 return `<div class="race-result"><p><strong>確定結果</strong> / 決まり手：${escape(result.kimarite||'未取得')}</p><div class="table-wrap"><table><thead><tr><th>着順</th><th>艇 / 選手</th><th>本番進入</th><th>本番ST</th><th>レースタイム</th></tr></thead><tbody>${tableRows}</tbody></table></div><div class="result-payouts">${result.payouts.length?result.payouts.map(p=>`<p>3連単 <strong>${escape(p.combo)}</strong> / 払戻 <strong>${p.payout_yen_per_100.toLocaleString('ja-JP')}円</strong><small>（100円あたり）</small></p>`).join(''):'<p>3連単の払戻は未取得です。返還・不成立等は公式結果をご確認ください。</p>'}</div>${renderResultComparison(comparison)}<p class="small-note">結果取得 ${time}。締切前に保存した予想・確率は結果で書き換えません。</p>${link}</div>`;
}

export function upcomingRaceList(rows,now=Date.now(),limit=5) {
 const date=japanDate(now),seen=new Set();
 return (Array.isArray(rows)?rows:[]).filter(r=>{
  if(!r)return false;
  const time=Date.parse(r.deadline_at),key=r.venue_code+'-'+r.race_no;
  if(r.date!==date||!/^(0[1-9]|1\d|2[0-4])$/.test(r.venue_code)||!Number.isInteger(r.race_no)||r.race_no<1||r.race_no>12||!Number.isFinite(time)||time<=now||japanDate(time)!==date||seen.has(key))return false;
  seen.add(key);return true;
 }).sort((a,b)=>Date.parse(a.deadline_at)-Date.parse(b.deadline_at)||a.venue_code.localeCompare(b.venue_code)||a.race_no-b.race_no).slice(0,limit).map(({date,venue_code,race_no,deadline_at})=>({date,venue_code,race_no,deadline_at}));
}

export function renderEnvironment(race){
 const env=race.environment;if(!env)return '<p class="small-note">風・波高・予測潮位は直前情報の取得待ちです。</p>';
 const numeric=(v,unit)=>Number.isFinite(v)?escape(v)+unit:'未取得',tide=env.tide,code=env.wind_direction_code;
 const time=value=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'未確認';
 const direction=env.wind_speed_mps===0?'無風・風向なし':Number.isInteger(code)&&code>=1&&code<=16?`<span class="wind-direction wind-code-${code}" aria-hidden="true">↑</span><span>公式図の方向 ${code}</span>`:'風向未取得';
 return `<section class="race-environment"><h4>風・水面と予測潮位</h4><div class="condition-values"><span>風速 <strong>${numeric(env.wind_speed_mps,'m/s')}</strong></span><span>${direction}</span><span>波高 <strong>${numeric(env.wave_height_cm,'cm')}</strong></span></div><p class="small-note">${escape(env.measurement_label||'水面気象情報')} / 取得 ${time(env.fetched_at)}。風向は公式水面図を基準に表示します。取得時刻が気象の観測時刻とは限りません。</p>${tide?.status==='OK'?`<p>気象庁の参考予測潮位：<strong>${numeric(tide.height_cm,'cm')}</strong> / ${escape(tide.station_name)} / ${tide.trend==='RISING'?'上げ潮':tide.trend==='FALLING'?'下げ潮':'潮止まり付近'}（${numeric(tide.change_cm_per_hour,'cm/時')}）</p><p class="small-note">出典：気象庁「潮位表」を加工（毎時値から補間）。基準：${escape(tide.datum)}。締切予定時刻の予測値を毎時値から補間。近隣地点の天文潮位で、場内の実測水位ではありません。高潮・風による吹き寄せ等は含みません。取得 ${time(tide.fetched_at)}。<br>満潮 ${(tide.high_tides||[]).map(v=>escape(v.time)).join('・')||'該当なし'} / 干潮 ${(tide.low_tides||[]).map(v=>escape(v.time)).join('・')||'該当なし'}</p>`:`<p class="small-note">予測潮位：${escape(tide?.reason||'未取得・未対応です')}。波高を潮位として代用しません。</p>`}<p class="small-note">${['wind_speed','wind_direction','tide','tide_trend'].some(k=>race.history?.context_usage?.[k])?'学習済みの条件係数と取得済みの入力だけを使用します。今回の反映量はスコアの内訳をご確認ください。':'風・潮位の確率補正は記録の蓄積・検証中のため未適用です。現在の予想係数を維持しています。'}</p></section>`;
}
export function renderCourse2(race){
 const s=race.history?.course2_escape;if(!s)return '';
 const pct=v=>Number.isFinite(v)?(v*100).toFixed(1)+'%':'未集計',two=race.entries?.find(e=>e.racer_id===s.player_id);
 return `<section class="course2-escape"><h4>2コース選手の逃がし率</h4><p>${escape(two?.name||s.player_id||'選手未確認')}（${escape(s.basis)}） / ${s.samples||0}走</p><p>過去の割合 <strong>${pct(s.escape_rate)}</strong> / 少数例を補正した割合 <strong>${pct(s.smoothed_escape_rate)}</strong></p><p class="small-note">実進入2コースの選手ごとに、1号艇が実進入1コースから「逃げ」で勝った割合を集計します。正常6艇レースが対象です。アシストの因果関係や、差しに行った回数を示すものではありません。2コース選手自身の差し決着率（少数例補正後）：${pct(s.sashi_rate)}。${race.history.context_usage?.course2_escape?'このモデルの評価因子に使用。':'集計を表示。現行モデルの係数にはまだ追加していません。'}</p></section>`;
}
