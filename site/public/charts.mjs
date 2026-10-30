import {forecastConfidence,radarData,RADAR_AXES} from './race-metrics.mjs';
import {escape} from './view.mjs';
const charts=new WeakMap(),laneChoices=new Map();
const raceChartKey=r=>`${r.date}/${r.venue_code}/${r.race_no}`;
function choices(r){const k=raceChartKey(r);if(!laneChoices.has(k)){if(laneChoices.size>300)laneChoices.delete(laneChoices.keys().next().value);laneChoices.set(k,new Set([1,2,3,4,5,6]));}return laneChoices.get(k);}
export function confidenceHTML(race,compact=false){
 const c=forecastConfidence(race);
 if(c.score===null)return `<span class="confidence unavailable">自信度：未算出</span>`;
 return `<span class="confidence${compact?' compact':''}" title="${escape(c.description)}" aria-label="自信度 ${c.score.toFixed(1)} / 5。実測の的中率ではない参考指標"><span class="confidence-stars" aria-hidden="true"><span>★★★★★</span><span class="confidence-fill confidence-step-${c.score*2}">★★★★★</span></span><span>${compact?'':'自信度 '}${c.score.toFixed(1)} / 5</span></span>`;
}
export function radarHTML(race){
 const rows=radarData(race);if(!rows.length)return '';
 const visible=choices(race);
 return `<section class="score-radar" aria-labelledby="radar-title"><h4 id="radar-title">選手スコアを比較</h4><div class="radar-toggles" role="group" aria-label="グラフに表示する艇">${rows.map(r=>`<label class="radar-lane lane-border-${r.lane}"><input type="checkbox" data-radar-lane="${r.lane}"${visible.has(r.lane)?' checked':''}>${r.lane}号艇 ${escape(r.name)}</label>`).join('')}</div><div class="radar-canvas-wrap"><canvas id="score-radar" role="img" aria-label="6艇の選手スコア比較。各軸の数値は下の表でも確認できます"></canvas></div><p id="radar-status" class="small-note" role="status"></p><p class="small-note">各軸は今回の6艇内での相対評価（0〜100）です。50は同値の場合の中間点。的中率ではありません。展示等の未取得項目は空欄とし、ゼロ点で補いません。表示する艇を切り替えて比較できます。</p><details><summary>レーダーの数値を見る</summary><div class="table-wrap"><table><thead><tr><th>艇 / 選手</th>${RADAR_AXES.map(([name])=>`<th>${name}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr><td>${r.lane}号艇 ${escape(r.name)}</td>${r.values.map(v=>`<td>${v===null?'未取得':v}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details></section>`;
}
let chartLibrary=null;
function loadChartLibrary(){
 if(typeof window.Chart==='function')return Promise.resolve(true);
 if(!chartLibrary)chartLibrary=new Promise(resolve=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js';script.integrity='sha384-T/4KgSWuZEPozpPz7rnnp/5lDSnpY1VPJCojf1S81uTHS1E38qgLfMgVsAeRCWc4';script.crossOrigin='anonymous';script.async=true;script.onload=()=>resolve(typeof window.Chart==='function');script.onerror=()=>resolve(false);document.head.append(script);});
 return chartLibrary;
}
export function mountRadar(race){
 const canvas=document.getElementById('score-radar');if(!canvas||document.getElementById('assessment-panel')?.hidden||document.getElementById('race-details-panel')?.hidden)return;
 const status=document.getElementById('radar-status'),rows=radarData(race),visible=choices(race);
 document.querySelectorAll('[data-radar-lane]').forEach(input=>{input.onchange=()=>{const lane=Number(input.dataset.radarLane);input.checked?visible.add(lane):visible.delete(lane);mountRadar(race);};});
 if(typeof window.Chart!=='function'){canvas.hidden=true;canvas.dataset.raceKey=raceChartKey(race);status.textContent='グラフを読み込んでいます。数値の表も確認できます。';loadChartLibrary().then(loaded=>{if(document.getElementById('score-radar')!==canvas||canvas.dataset.raceKey!==raceChartKey(race)||document.getElementById('assessment-panel')?.hidden||document.getElementById('race-details-panel')?.hidden)return;if(loaded)mountRadar(race);else status.textContent='グラフを取得できません。数値の表は引き続き確認できます。';});return;}
 canvas.hidden=false;status.textContent='';
 const datasets=rows.map(r=>({label:`${r.lane}号艇 ${r.name}`,data:r.values,borderColor:r.color,backgroundColor:r.color+'22',pointBackgroundColor:r.color,borderWidth:2,pointRadius:3,hidden:!visible.has(r.lane),spanGaps:false}));
 const signature=JSON.stringify(datasets),old=charts.get(canvas);
 if(old&&old.key===raceChartKey(race)){if(old.signature!==signature){old.chart.data.datasets=datasets;old.chart.update('none');old.signature=signature;}}
 else{old?.chart.destroy();const chart=new window.Chart(canvas,{type:'radar',data:{labels:RADAR_AXES.map(([name])=>name),datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}},scales:{r:{min:0,max:100,ticks:{stepSize:25,font:{size:10}},pointLabels:{font:{size:12}}}}}});charts.set(canvas,{chart,key:raceChartKey(race),signature});}
}
