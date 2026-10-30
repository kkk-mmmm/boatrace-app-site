import {renderValidation} from './validation-view.mjs';
import {escape,japanDate} from './view.mjs';
import {verificationResponse} from './verification-data.mjs';
const names=['桐生','戸田','江戸川','平和島','多摩川','浜名湖','蒲郡','常滑','津','三国','びわこ','住之江','尼崎','鳴門','丸亀','児島','宮島','徳山','下関','若松','芦屋','福岡','唐津','大村'];
const $=id=>document.getElementById(id),money=n=>Number.isFinite(n)?Math.round(n).toLocaleString('ja-JP')+'円':'—',pct=n=>Number.isFinite(n)?n.toFixed(1)+'%':'—';
const clock=t=>Number.isFinite(Date.parse(t))?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(t)):'未確認';
const params=new URL(location.href).searchParams;
let date=params.get('date'),venue=params.get('venue')||'',api=null,archive=null,displayed=[],data=null,loading=false,sequence=0;
const chooseDate=value=>{date=value;displayed=[];return load(0);};
function draw(){
 $('verification-days').innerHTML=data.days.map(d=>`<button data-verification-date="${d.date}" aria-pressed="${d.date===data.date}">${d.date.slice(5)}<small>${d.recorded_races}件 / 照合${d.evaluated_races}件</small></button>`).join('');
 document.querySelectorAll('[data-verification-date]').forEach(b=>b.onclick=()=>chooseDate(b.dataset.verificationDate));
 const s=data.summary;
 const metric=(label,value,unit='')=>`<div><dt>${escape(label)}</dt><dd>${escape(value)}${unit?`<small>${escape(unit)}</small>`:''}</dd></div>`;
 $('verification-summary').innerHTML=`<p class="small-note">${escape(data.date)} / 記録 ${escape(s.recorded_races)}レース。未照合・除外は損失に含めません。</p><dl class="result-metrics">${metric('照合済み',s.evaluated_races,'レース')}${metric('確率上位の的中',s.evaluated_races?s.probability.hits:'—',s.evaluated_races?'レース':'')}${metric('確率上位の仮想回収率',pct(s.probability.recovery_percent))}${metric('未照合・除外',s.pending_or_excluded,'レース')}</dl><p class="small-note">期待値上位：${escape(s.value.hits)}的中 / 仮想回収率 ${pct(s.value.recovery_percent)}</p>`;
 const strategy=(s,label)=>!s?'':`<p>${label}：${s.hit?'的中':'不的中'} / ${s.points}点 / 仮想購入 ${money(s.stake_yen)} / 払戻 ${money(s.return_yen)} / 回収率 ${pct(s.recovery_percent)}</p>`;
 const bets=(rows,label)=>`<h4>${label}</h4><div class="verification-bets">${(rows||[]).map(r=>`<span><strong>${escape(r.combo)}</strong> 確率 ${(r.probability*100).toFixed(2)}% / 保存オッズ ${r.odds===null?'未取得':r.odds.toFixed(1)+'倍'} / 期待値 ${r.value===null?'未算出':r.value.toFixed(3)+'倍'}</span>`).join('')}</div>`;
 $('verification-records').innerHTML=displayed.length?displayed.map(r=>`<article class="verification-record"><div class="section-heading"><h3>${escape(names[Number(r.venue_code)-1]||r.venue_code)} ${r.race_no}R</h3><span>${r.status==='SETTLED'?'結果照合済み':escape(r.reason||'照合待ち')}</span></div><p>${r.actual_combo?`結果 <strong>${escape(r.actual_combo)}</strong> / 公式払戻 ${money(r.payout_yen_per_100)}（100円あたり）`:'確定買い目・払戻は未照合です。'}</p>${strategy(r.probability_strategy,'確率上位10点')}${strategy(r.value_strategy,'期待値上位最大10点')}<details><summary>保存した買い目と記録を確認</summary><p class="small-note">モデル ${escape(r.model_name||r.model_id||'未確認')} / 保存 ${clock(r.proposal_saved_at)} / オッズ ${clock(r.odds_fetched_at)}<br>${r.cohort==='RECEIPT_BEFORE_CUTOFF'?'収集処理が締切3分前までに受信した記録':'Workerの保存時刻による記録。外部受信による事前保存の証明とは別です。'}</p>${bets(r.probability_top10,'推定確率上位')}${bets(r.value_top10,'保存時の期待値上位')}</details></article>`).join(''):'<p class="verification-empty">この日の保存予想・結果はまだありません。未記録のレースを不的中として扱いません。</p>';
 $('verification-more').hidden=!data.has_more;
 $('verification-method').textContent=data.methodology;
 const u=new URL(location.href);u.searchParams.set('date',data.date);venue?u.searchParams.set('venue',venue):u.searchParams.delete('venue');history.replaceState(null,'',u);
}
async function load(offset=0){
 if(loading)return;loading=true;const id=++sequence;$('verification-status').textContent='日別の保存予想・結果を確認しています。';
 try{
  let next,sourceLabel=api?'Cloudflareの共有記録':'公開時点の保存版';
  if(api){try{const url=new URL(api);if(date)url.searchParams.set('date',date);if(venue)url.searchParams.set('venue',venue);url.searchParams.set('offset',String(offset));url.searchParams.set('limit','20');const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('API '+response.status);next=await response.json();if(next.kind!=='PUBLIC_SAVED_FORECAST_VERIFICATION')throw Error('Invalid API data');}catch{const response=await fetch('./data/verification.json',{cache:'no-store'});if(!response.ok)throw Error('保存版も取得できません');archive=await response.json();next=verificationResponse(archive.records,{date,venue,offset,generated_at:archive.generated_at});sourceLabel='Cloudflareの通信失敗のため公開時点の保存版を表示';}}
  else{if(!archive){const r=await fetch('./data/verification.json',{cache:'no-store'});if(!r.ok)throw Error('保存版を取得できません');archive=await r.json();}next=verificationResponse(archive.records,{date,venue,offset,generated_at:archive.generated_at});}
  if(id!==sequence)return;
  if(next.kind!=='PUBLIC_SAVED_FORECAST_VERIFICATION'||!Array.isArray(next.records)||!Array.isArray(next.days))throw Error('記録の形式を確認できません');
  data=next;date=data.date;displayed=offset?[...displayed,...data.records]:data.records;draw();$('verification-status').textContent=`${sourceLabel} / 更新確認 ${clock(data.served_at)} / 保存版生成 ${clock(data.generated_at)}`;
 }catch(error){$('verification-status').textContent=`記録を取得できません：${error.message}。表示を更新して再確認してください。`;}
 finally{loading=false;}
}
let validationLoading=false;
async function loadValidation(){
 const root=$('validation-quality'),status=$('validation-quality-status');if(!root||validationLoading)return;validationLoading=true;status.textContent='30完了日分の検証集計を確認しています。';
 try{const response=await fetch('./data/validation.json',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('HTTP '+response.status);const report=await response.json();renderValidation(root,report);status.textContent=`公開時点の30完了日集計 / データ集計 ${clock(report.generated_at)} / 画面確認 ${clock(new Date().toISOString())}`;}
 catch{status.textContent=root.querySelector('h2')?'30完了日集計の更新に失敗しました。直前に確認できた集計を表示しています。':'確率・期待値の検証を取得できません。表示を更新して再確認してください。';}
 finally{validationLoading=false;}
}
$('verification-venue').innerHTML='<option value="">全場</option>'+names.map((name,i)=>`<option value="${String(i+1).padStart(2,'0')}">${name}</option>`).join('');$('verification-venue').value=venue;
$('verification-venue').onchange=()=>{venue=$('verification-venue').value;displayed=[];load(0);};$('verification-refresh').onclick=()=>{load(0);loadValidation();};$('verification-more').onclick=()=>load(displayed.length);
try{const response=await fetch('./data/odds-config.json');const config=await response.json();if(config.api_url){const url=new URL(config.api_url);url.pathname='/v1/verification';url.search='';api=url.href;}}catch{}
await Promise.all([load(),loadValidation()]);
