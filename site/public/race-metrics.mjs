const finite=Number.isFinite;
export function forecastConfidence(race){
 const rows=race.probabilities||[],mass=Array(6).fill(0),seen=new Set();
 for(const r of rows){const a=String(r.combo).split('-').map(Number);if(a.length!==3||new Set(a).size!==3||a.some(n=>!Number.isInteger(n)||n<1||n>6)||seen.has(r.combo)||!finite(r.probability)||r.probability<=0)return {score:null,kind:'UNAVAILABLE'};seen.add(r.combo);mass[a[0]-1]+=r.probability;}
 if(rows.length!==120||Math.abs(mass.reduce((s,v)=>s+v,0)-1)>1e-6)return {score:null,kind:'UNAVAILABLE'};
 const sorted=[...mass].sort((a,b)=>b-a),entropy=-mass.reduce((s,p)=>s+(p>0?p*Math.log(p):0),0)/Math.log(6);
 const counts=(race.entries||[]).map(e=>Number.isInteger(e.annual_lane?.samples)&&e.annual_lane.samples>=0?e.annual_lane.samples:0),support=counts.length===6?counts.reduce((s,n)=>s+Math.max(0,n)/(Math.max(0,n)+30),0)/6:0;
 const concentration=.65*(1-entropy)+.35*(sorted[0]-sorted[1]);
 return {score:Math.max(0,Math.min(5,Math.round(10*concentration*Math.sqrt(support))/2)),kind:'MODEL_CONCENTRATION_REFERENCE',scale:5,step:.5,
  first_place_probabilities:mass,data_support:support,normalized_entropy:entropy,calibrated:false,
  description:'1着確率の集中度と枠別履歴件数から算出する参考指標。実測の的中率・利益の確率ではありません。'};
}
export const RADAR_AXES=[['枠別実績','枠別1着率'],['ST','枠別ST'],['ST安定度','ST安定度'],['ST順位','枠別スタート順位'],['展示評価','展示順位と着順の差'],['場適性','場・枠別1着傾向']];
export const BOAT_COLORS=['#8b96a4','#253744','#e34747','#1681ca','#e3bc12','#28a76b'];
export function radarData(race){
 const rows=(race.scores||[]).filter(s=>Number.isInteger(s.lane)&&s.lane>=1&&s.lane<=6);
 if(rows.length!==6||new Set(rows.map(s=>s.lane)).size!==6)return [];
 const raw=rows.map(s=>RADAR_AXES.map(([,label])=>{const c=s.history_components?.find(c=>c.label===label),entry=race.entries?.find(e=>e.lane===s.lane);return label==='展示順位と着順の差'&&!finite(entry?.exhibition_time)?null:finite(c?.raw_value)?c.raw_value:null;}));
 return rows.map((s,i)=>({lane:s.lane,name:s.name,color:BOAT_COLORS[s.lane-1],values:raw[i].map((v,j)=>{
  if(v===null)return null;const values=raw.map(row=>row[j]).filter(finite);if(values.length<2)return null;
  return Math.round(100*(values.filter(x=>x<v).length+(values.filter(x=>x===v).length-1)/2)/(values.length-1));
 })}));
}
