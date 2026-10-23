import {escape, predictionPool} from './view.mjs';
const developmentStyles=['逃げ','差し','まくり','まくり差し'];
const developmentNumber=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max?value:null;
const developmentClamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function developmentScenarios(race) {
 const rows=predictionPool(race);
 if(rows.length!==120||Math.abs(rows.reduce((s,r)=>s+r.probability,0)-1)>1e-6 || !Array.isArray(race.entries)||race.entries.length!==6
  ||new Set(race.entries.map(e=>e.lane)).size!==6||race.entries.some(e=>!Number.isInteger(e.lane)||e.lane<1||e.lane>6))return [];
 const gaps=new Map((race.history?.lanes||[]).map(h=>[h.lane,h.exhibition_st_gap]));
 const boats=[...race.entries].sort((a,b)=>a.lane-b.lane).map(e=>{
  const stats=e.annual_lane||{},counts=developmentStyles.map(style=>({style,count:developmentNumber(stats.kimarite?.[style],0,1e7)||0}));
  const most=[...counts].sort((a,b)=>b.count-a.count||developmentStyles.indexOf(a.style)-developmentStyles.indexOf(b.style))[0];
  return {lane:e.lane,name:e.name,winRate:developmentNumber(stats.win_rate,0,1),st:developmentNumber(stats.mean_st,0,1)??developmentNumber(e.avg_st,0,1),
   stSource:developmentNumber(stats.mean_st,0,1)!==null?'枠別平均ST':developmentNumber(e.avg_st,0,1)!==null?'出走表の平均ST':'未取得',
   startRank:developmentNumber(stats.mean_start_rank,1,6),exhibitionST:developmentNumber(e.exhibition_st,-1,1),exhibitionTime:developmentNumber(e.exhibition_time,4,10),
   stGap:Number.isFinite(gaps.get(e.lane)?.mean)&&gaps.get(e.lane)?.n?gaps.get(e.lane).mean:null,
   course:Number.isInteger(e.exhibition_course)&&e.exhibition_course>=1&&e.exhibition_course<=6?e.exhibition_course:null,
   style:most.count>0?most.style:null,styleCounts:counts,samples:stats.samples||0};
 });
 const masses=boats.map(b=>({lane:b.lane,probability:rows.filter(r=>r.combo.startsWith(b.lane+'-')).reduce((s,r)=>s+r.probability,0)}));
 return masses.filter(m=>m.lane===1?m.probability>0:m.probability>=.2-1e-12).map(m=>{
  const winner=boats.find(b=>b.lane===m.lane),best=rows.filter(r=>r.combo.startsWith(m.lane+'-')).sort((a,b)=>b.probability-a.probability||a.combo.localeCompare(b.combo))[0];
  return {...m,style:m.lane===1?'逃げ':winner.style,combo:best.combo,ticketProbability:best.probability,boats};
 });
}
export function developmentPaths(scenario) {
 const order=scenario.combo.split('-').map(Number),available=scenario.boats.filter(b=>b.exhibitionTime!==null).map(b=>b.exhibitionTime);
 const baseline=available.length?available.reduce((a,b)=>a+b,0)/available.length:6.8;
 const strength=b=>(.17-(b.st??.17))*8+(3.5-(b.startRank??3.5))*.2+((b.winRate??1/6)-1/6)*.8+(baseline-(b.exhibitionTime??baseline))*2
  +(b.exhibitionST!==null?developmentClamp(.17-(b.exhibitionST+(b.stGap??0)),-.12,.12)*2:0);
 const remaining=scenario.boats.filter(b=>!order.includes(b.lane)).sort((a,b)=>strength(b)-strength(a)||a.lane-b.lane);
 order.push(...remaining.map(b=>b.lane));
 // Exhibition entry is used only when all six courses are confirmed and unique.
 const useCourse=scenario.boats.every(b=>b.course!==null)&&new Set(scenario.boats.map(b=>b.course)).size===6;
 return scenario.boats.map(b=>{
  const position=order.indexOf(b.lane),course=useCourse?b.course:b.lane;
  const y=137+(course-1)*22,x=68-developmentClamp(b.st??.17,0,.6)*100-(b.startRank??3.5)*2;
  const approach=developmentClamp(385+strength(b)*24,350,420),end=90+position*38,back=48+position*12;
  const winner=b.lane===scenario.lane,style=winner?scenario.style:null;
  const outer=style==='まくり'?582:style==='まくり差し'?551:535+position*4;
  const turningY=style==='差し'?135:style==='まくり差し'?180:y;
  const path=`M ${x.toFixed(2)} ${y} L 170 ${y} L ${approach.toFixed(2)} ${turningY} C ${outer} ${turningY} ${outer} ${back} 456 ${back} L ${end} ${back}`;
  return {lane:b.lane,path,finish:position+1};
 });
}
export function renderDevelopment(race,selectedLane=1) {
 const scenarios=developmentScenarios(race),scenario=scenarios.find(s=>s.lane===selectedLane)||scenarios[0];
 if(!scenario)return '<p class="development-empty" role="status">展開予想は、6艇の出走表と全120通りの予想が確認できてから表示します。</p>';
 const percent=n=>(n*100).toFixed(1)+'%',number=n=>n===null?'未取得':n.toFixed(2);
 const colors=['#fff','#253744','#e34747','#1681ca','#ffd747','#28a76b'];
 const paths=developmentPaths(scenario);
 const prices=new Map((race.odds?.items||[]).map(r=>[r.combo,r.odds]));
 return `<div class="development"><p class="small-note">1号艇の展開と、1着確率20%以上の他艇の展開を表示。確率は全120通りのモデル予想を集計し、決まり手別の確率ではありません。</p><div class="development-cases" role="group" aria-label="勝つ艇の展開を選ぶ">${scenarios.map(s=>`<button data-development-lane="${s.lane}" data-first-probability="${s.probability}" aria-pressed="${s.lane===scenario.lane}">${s.lane===1?'逃げ想定':`逃げない・${s.lane}号艇が勝つ場合`}<strong>${percent(s.probability)}</strong></button>`).join('')}</div><h4 id="development-heading">${scenario.lane}号艇が勝つ展開例 / ${escape(scenario.style||'決まり手未判定')}</h4>
 <svg id="development-water" data-development-lane="${scenario.lane}" viewBox="0 0 620 300" role="img" aria-labelledby="development-heading development-desc"><desc id="development-desc">6艇のスタートスリット通過から第1ターンマーク、バックストレッチまでの模式的な展開。${escape(scenario.combo)}の着順を仮定した例。</desc><rect width="620" height="300" rx="12" fill="#e6f5ff"/><path d="M 62 107 H 470 Q 555 107 555 52 H 90" class="development-guide"/><line x1="170" y1="115" x2="170" y2="278" stroke="#4484a7" stroke-dasharray="5 5"/><path d="M 465 112 L 475 112 L 470 96 Z" fill="#ed6b45"/><g class="development-labels"><text x="95" y="291">スタートスリット</text><text x="435" y="94">第1ターンマーク</text><text x="180" y="25">← バックストレッチ</text></g>${paths.map(p=>`<path class="development-track" d="${p.path}" stroke="${colors[p.lane-1]}"/><g class="development-boat" data-development-boat="${p.lane}"><circle r="10" fill="${colors[p.lane-1]}" stroke="#36566d"/><text text-anchor="middle" dy="4" fill="${[2,3,4,6].includes(p.lane)?'#fff':'#152e40'}">${p.lane}</text><animateMotion dur="6s" repeatCount="1" fill="freeze" path="${p.path}"/></g>`).join('')}</svg>
 <div class="development-controls"><button id="development-replay">もう一度再生</button><button id="development-pause">一時停止</button><span>約6秒 / スタート → 第1ターン → バック</span></div>
 <p class="development-ticket">この展開の買い目 <button class="combo-select" data-development-combo="${escape(scenario.combo)}">${escape(scenario.combo)} → スジ候補へ</button><span>推定確率 ${percent(scenario.ticketProbability)}${Number.isFinite(prices.get(scenario.combo))?` / 保存・取得オッズ ${prices.get(scenario.combo).toFixed(1)}倍`:''}</span></p>
 <details class="development-inputs"><summary>展開に使った各艇のデータ・傾向を見る</summary><div class="table-wrap"><table><thead><tr><th>艇 / 選手</th><th>枠別1着率</th><th>平均ST</th><th>ST順位</th><th>展示タイム / ST</th><th>展示→本番ST差</th><th>勝利時の傾向</th></tr></thead><tbody>${scenario.boats.map(b=>`<tr><td>${b.lane} / ${escape(b.name)}</td><td>${b.winRate===null?'未集計':percent(b.winRate)}</td><td>${number(b.st)}<small>${b.stSource}</small></td><td>${number(b.startRank)}</td><td>${number(b.exhibitionTime)} / ${number(b.exhibitionST)}</td><td>${b.stGap===null?'未集計':(b.stGap>=0?'+':'')+b.stGap.toFixed(3)+'秒'}</td><td>${escape(b.style||'未集計')}<small>${b.styleCounts.map(s=>`${s.style} ${s.count}勝`).join(' / ')}</small></td></tr>`).join('')}</tbody></table></div><p class="small-note">枠別1着率・平均ST・ST順位と展示タイム・展示STで描画上の進み方を調整し、照合済みの展示→本番ST差があれば展示STに平均差を加えて描画を調整し、勝利時の決まり手傾向でターン経路を分けます。展示進入は6艇すべて確認できる場合のみ使用。買い目と確率は表示中の保存予想、図の選手情報は表示中の出走表・展示に基づくため、取得時刻が異なる場合があります。</p></details>
 <p class="small-note development-disclaimer">選んだ艇と着順が勝つ場合の模式図です。実際の航跡・所要時間・決まり手を予測する物理シミュレーションではありません。展示未提供の項目は「未取得」と表示し、図は中立値で補います。</p></div>`;
}
