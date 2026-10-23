import {escape, predictionPool} from './view.mjs';
const developmentStyles=['逃げ','差し','まくり','まくり差し'];
const developmentNumber=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max?value:null;
const developmentClamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function developmentScenarios(race) {
 const rows=predictionPool(race);
 if(rows.length!==120||Math.abs(rows.reduce((s,r)=>s+r.probability,0)-1)>1e-6 || !Array.isArray(race.entries)||race.entries.length!==6
  ||new Set(race.entries.map(e=>e.lane)).size!==6||race.entries.some(e=>!Number.isInteger(e.lane)||e.lane<1||e.lane>6))return [];
 const scores=new Map((race.scores||[]).map(s=>[s.lane,s.total]));
 const gaps=new Map((race.history?.lanes||[]).map(h=>[h.lane,h.exhibition_st_gap]));
 const boats=[...race.entries].sort((a,b)=>a.lane-b.lane).map(e=>{
  const stats=e.annual_lane||{},counts=developmentStyles.map(style=>({style,count:developmentNumber(stats.kimarite?.[style],0,1e7)||0}));
  const most=[...counts].sort((a,b)=>b.count-a.count||developmentStyles.indexOf(a.style)-developmentStyles.indexOf(b.style))[0];
  return {lane:e.lane,name:e.name,score:developmentNumber(scores.get(e.lane),-100,100),winRate:developmentNumber(stats.win_rate,0,1),st:developmentNumber(stats.mean_st,0,1)??developmentNumber(e.avg_st,0,1),
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
 const knownScores=scenario.boats.map(b=>b.score).filter(Number.isFinite),meanScore=knownScores.length?knownScores.reduce((a,b)=>a+b,0)/knownScores.length:0;
 const strength=b=>(.17-(b.st??.17))*8+(3.5-(b.startRank??3.5))*.2+((b.winRate??1/6)-1/6)*.8+(baseline-(b.exhibitionTime??baseline))*2
  +(b.exhibitionST!==null?developmentClamp(.17-(b.exhibitionST+(b.stGap??0)),-.12,.12)*2:0)+(Number.isFinite(b.score)?(b.score-meanScore)*.35:0);
 const remaining=scenario.boats.filter(b=>!order.includes(b.lane)).sort((a,b)=>strength(b)-strength(a)||a.lane-b.lane);
 order.push(...remaining.map(b=>b.lane));
 const useCourse=scenario.boats.every(b=>b.course!==null)&&new Set(scenario.boats.map(b=>b.course)).size===6;
 const geometry=scenario.boats.map(b=>{
  const course=useCourse?b.course:b.lane,style=b.lane===scenario.lane?scenario.style:b.style;
  const weights={'逃げ':-.3,'差し':-.8,'まくり':1,'まくり差し':.35};
  const total=b.styleCounts.reduce((sum,s)=>sum+s.count,0);
  // The selected winner is conditional; the other five boats retain their own tendencies.
  const bias=b.lane===scenario.lane&&style?weights[style]:total?b.styleCounts.reduce((sum,s)=>sum+s.count*weights[s.style],0)/total:0;
  const y=160+(course-1)*22,x=developmentClamp(68-developmentClamp(b.st??.17,0,.6)*100-(b.startRank??3.5)*2,22,68);
  const power=strength(b),radius=developmentClamp(78+bias*38+(course-3.5)*2,46,118);
  return {lane:b.lane,finish:order.indexOf(b.lane)+1,course,style,bias,power,radius,x,y,
   desiredBack:developmentClamp(75-bias*27-(course-3.5)*8,32,118)};
 });
 // Group near-equal inputs without arbitrary rounding-boundary separations.
 // These are intermediate backstretch positions, independent of the ticket order.
 const forward=[...geometry].sort((a,b)=>b.power-a.power||a.lane-b.lane),groups=[];
 for(const g of forward){const group=groups.at(-1);if(!group||group[0].power-g.power>.08+1e-12)groups.push([g]);else group.push(g);}
 for(const group of groups){const mean=group.reduce((sum,g)=>sum+g.power,0)/group.length;
  for(const g of group)g.end=210-130*Math.tanh(mean*.85);
 }
 // Keep parallel hulls visible without using the ticket's finishing order for lateral lanes.
 const lateral=[...geometry].sort((a,b)=>a.desiredBack-b.desiredBack||b.course-a.course);
 for(let i=0;i<lateral.length;i++)lateral[i].back=Math.max(lateral[i].desiredBack,i?lateral[i-1].back+14:32);
 lateral.at(-1).back=Math.min(118,lateral.at(-1).back);
 for(let i=lateral.length-2;i>=0;i--)lateral[i].back=Math.min(lateral[i].back,lateral[i+1].back-14);
 return geometry.map(g=>{
  const approach=developmentClamp(385+g.power*24,350,420),turningY=Math.max(160,g.y-Math.max(0,-g.bias)*(g.y-160)*.7),outer=470+g.radius;
  const path=`M ${g.x.toFixed(2)} ${g.y} L 170 ${g.y} L ${approach.toFixed(2)} ${turningY.toFixed(2)} C ${outer.toFixed(2)} ${turningY.toFixed(2)} ${outer.toFixed(2)} ${g.back.toFixed(2)} 456 ${g.back.toFixed(2)} L ${g.end.toFixed(2)} ${g.back.toFixed(2)}`;
  return {lane:g.lane,path,finish:g.finish,turnRadius:g.radius,backX:g.end,backY:g.back,power:g.power,style:g.style};
 });
}
export function renderDevelopment(race,selectedLane=1) {
 const scenarios=developmentScenarios(race),scenario=scenarios.find(s=>s.lane===selectedLane)||scenarios[0];
 if(!scenario)return '<p class="development-empty" role="status">展開予想は、6艇の出走表と全120通りの予想が確認できてから表示します。</p>';
 const percent=n=>(n*100).toFixed(1)+'%',number=n=>n===null?'未取得':n.toFixed(2);
 const colors=['#fff','#253744','#e34747','#1681ca','#ffd747','#28a76b'];
 const paths=developmentPaths(scenario);
 const poles=[126,284].map(y=>`<g class="development-start-pole" aria-label="白黒のスタートポール"><rect x="165" y="${y}" width="10" height="22" rx="1" fill="#fff" stroke="#253744"/>${[0,10,20].map(d=>`<rect x="165" y="${y+d}" width="10" height="${Math.min(5,22-d)}" fill="#253744"/>`).join('')}</g>`).join('');
 // A shared SVG timeline keeps the revealed wake exactly behind each moving hull.
 const tracks=paths.map(p=>`<path class="development-track" d="${p.path}" stroke="${colors[p.lane-1]}" pathLength="100" stroke-dasharray="100 100" stroke-dashoffset="100"><animate attributeName="stroke-dashoffset" from="100" to="0" dur="6s" calcMode="linear" fill="freeze"/></path>`).join('');
 const boats=paths.map(p=>`<g class="development-boat" data-development-boat="${p.lane}" aria-label="${p.lane}号艇"><title>${p.lane}号艇</title><path class="development-hull" d="M -14 -6 Q 4 -8 17 0 Q 4 8 -14 6 L -11 0 Z" fill="${colors[p.lane-1]}" stroke="#36566d" stroke-width="1.2"/><path d="M -6 -3 L 4 -3 L 8 0 L 4 3 L -6 3 Z" fill="#dceaf1" stroke="#36566d" stroke-width=".7"/><path d="M -3 -2 L 2 -2 L 2 2 L -3 2 Z" fill="#36566d"/><animateMotion dur="6s" repeatCount="1" calcMode="paced" rotate="auto" fill="freeze" path="${p.path}"/></g>`).join('');
 const prices=new Map((race.odds?.items||[]).map(r=>[r.combo,r.odds]));
 return `<div class="development"><p class="small-note">1号艇の展開と、1着確率20%以上の他艇の展開を表示。確率は全120通りのモデル予想を集計し、決まり手別の確率ではありません。</p><div class="development-cases" role="group" aria-label="勝つ艇の展開を選ぶ">${scenarios.map(s=>`<button data-development-lane="${s.lane}" data-first-probability="${s.probability}" aria-pressed="${s.lane===scenario.lane}">${s.lane===1?'逃げ想定':`逃げない・${s.lane}号艇が勝つ場合`}<strong>${percent(s.probability)}</strong></button>`).join('')}</div><h4 id="development-heading">${scenario.lane}号艇が勝つ展開例 / ${escape(scenario.style||'決まり手未判定')}</h4>
 <svg id="development-water" data-development-lane="${scenario.lane}" viewBox="0 0 620 320" role="img" aria-labelledby="development-heading development-desc"><desc id="development-desc">6艇のスタートスリット通過から第1ターンマーク、バックストレッチまでの模式的な展開。${escape(scenario.combo)}を着順候補とする途中経過。</desc><rect width="620" height="320" rx="12" fill="#e6f5ff"/><path d="M 62 140 H 470 Q 555 140 555 65 H 90" class="development-guide"/><line x1="170" y1="126" x2="170" y2="306" stroke="#4484a7" stroke-dasharray="5 5"/><path d="M 465 146 L 475 146 L 470 130 Z" fill="#ed6b45"/><g class="development-labels"><text x="95" y="314">スタートスリット</text><text x="435" y="314">第1ターンマーク</text><text x="180" y="25">← バックストレッチ</text></g>${poles}${tracks}${boats}</svg>
 <div class="development-controls"><button id="development-replay">もう一度再生</button><button id="development-pause">一時停止</button><span>約6秒 / スタート → 第1ターン → バック</span></div>
 <p class="development-ticket">この展開からの買い目候補 <button class="combo-select" data-development-combo="${escape(scenario.combo)}">${escape(scenario.combo)} → スジ候補へ</button><span>推定確率 ${percent(scenario.ticketProbability)}${Number.isFinite(prices.get(scenario.combo))?` / 保存・取得オッズ ${prices.get(scenario.combo).toFixed(1)}倍`:''}</span></p>
 <details class="development-inputs"><summary>展開に使った各艇のデータ・傾向を見る</summary><div class="table-wrap"><table><thead><tr><th>艇 / 選手</th><th>枠別1着率</th><th>総合スコア</th><th>平均ST</th><th>ST順位</th><th>展示タイム / ST</th><th>展示→本番ST差</th><th>勝利時の傾向</th></tr></thead><tbody>${scenario.boats.map(b=>`<tr><td>${b.lane} / ${escape(b.name)}</td><td>${b.winRate===null?'未集計':percent(b.winRate)}</td><td>${number(b.score)}</td><td>${number(b.st)}<small>${b.stSource}</small></td><td>${number(b.startRank)}</td><td>${number(b.exhibitionTime)} / ${number(b.exhibitionST)}</td><td>${b.stGap===null?'未集計':(b.stGap>=0?'+':'')+b.stGap.toFixed(3)+'秒'}</td><td>${escape(b.style||'未集計')}<small>${b.styleCounts.map(s=>`${s.style} ${s.count}勝`).join(' / ')}</small></td></tr>`).join('')}</tbody></table></div><p class="small-note">総合スコア・枠別1着率・平均ST・ST順位と展示タイム・展示STで描画上の艇間差を調整し、照合済みの展示→本番ST差があれば展示STに平均差を加えて描画を調整し、全艇それぞれの決まり手傾向でターン半径とバックへの出口を分けます。まくり寄りは外、差し寄りは内を回る描画です。展示進入は6艇すべて確認できる場合のみ使用。買い目と確率は表示中の保存予想、図の選手情報は表示中の出走表・展示に基づくため、取得時刻が異なる場合があります。</p></details>
 <p class="small-note development-disclaimer">バックの位置は途中経過で、表示買い目の最終着順を固定する図ではありません。描画上の差が小さい艇は並走させます。選んだ艇が勝つ場合を想定した模式図です。実際の航跡・所要時間・決まり手を予測する物理シミュレーションではありません。展示未提供の項目は「未取得」と表示し、図は中立値で補います。</p></div>`;
}
