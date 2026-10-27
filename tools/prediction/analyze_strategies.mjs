// Retrospective exploration, not an optimizer or prospective confirmation.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {validationObservations,VALIDATION_POLICY} from '../../site/validation-review.mjs';
import {conditionalRanking} from '../../site/public/view.mjs';
export const STRATEGY_RULES=Object.freeze([10,20].flatMap(limit=>['return','value'].flatMap(base=>{
 const make=(suffix,extra={})=>({id:`${base}_${limit}_${suffix}`,limit,base,...extra});
 return [make('all'),...[.3,.5,.6,.7].map(maximum_in=>make(`in_under_${maximum_in}`,{maximum_in})),...[2,3,4,5,6].flatMap(lane=>[.2,.3].flatMap(minimum_first=>['head','any'].map(relation=>make(`lane_${lane}_${minimum_first}_${relation}`,{lane,minimum_first,relation}))))];
})));
export function strategySelection(row,rule){return row.roi_eligible?conditionalRanking(row.probabilities,row.probabilities,{...rule,currentOdds:true}).slice(0,rule.limit):[];}
export function assessStrategy(rows,rule){
 const eligible=rows.filter(r=>r.roi_eligible),daily=new Map();let races=0,tickets=0,hits=0,returned=0,expected=0,predicted=0,largest=0;
 for(const row of eligible){const selected=strategySelection(row,rule);if(!selected.length)continue;
  const hit=Number(selected.some(p=>p.combo===row.actual_combo)),payout=hit*row.payout,stake=selected.length*100;
  races++;tickets+=selected.length;hits+=hit;returned+=payout;largest=Math.max(largest,payout);expected+=selected.reduce((s,p)=>s+p.value*100,0);predicted+=selected.reduce((s,p)=>s+p.probability,0);
  if(!daily.has(row.date))daily.set(row.date,{date:row.date,races:0,tickets:0,hits:0,stake_yen:0,return_yen:0});const d=daily.get(row.date);d.races++;d.tickets+=selected.length;d.hits+=hit;d.stake_yen+=stake;d.return_yen+=payout;
 }
 const stake=tickets*100;return {eligible_races:eligible.length,bought_races:races,bought_days:daily.size,tickets,hits,stake_yen:stake,return_yen:returned,profit_yen:returned-stake,recovery_percent:stake?returned/stake*100:null,hit_rate:races?hits/races:null,predicted_hit_rate:races?predicted/races:null,expected_recovery_percent:stake?expected/stake*100:null,largest_payout_yen:largest,recovery_without_largest_percent:stake?(returned-largest)/stake*100:null,daily:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date))};
}
export function analyzeStrategyGroup({rows,...group}){
 const eligible=rows.filter(r=>r.roi_eligible),days=[...new Set(eligible.map(r=>r.date))].sort(),split=days.length>=2?days[Math.ceil(days.length/2)]:null;
 const earlier=split?eligible.filter(r=>r.date<split):[],later=split?eligible.filter(r=>r.date>=split):[];
 const conditions=STRATEGY_RULES.map(rule=>({rule,earlier:assessStrategy(earlier,rule),later:assessStrategy(later,rule),all:assessStrategy(eligible,rule)}));
 // Selection uses earlier days only; later outcomes cannot choose the earlier winner.
 const trainCandidates=conditions.filter(c=>c.earlier.bought_races>=50&&c.earlier.hits>=5).sort((a,b)=>b.earlier.recovery_percent-a.earlier.recovery_percent||a.rule.id.localeCompare(b.rule.id));
 const chosen=trainCandidates[0]||null;
 const baseline=chosen?conditions.find(c=>c.rule.id===`${chosen.rule.base}_${chosen.rule.limit}_all`):null;
 return {...group,days,split_date:split,conditions,earlier_selected_rule:chosen?.rule.id??null,later_minus_same_limit_baseline_pp:chosen?.later.recovery_percent!==null&&baseline?.later.recovery_percent!=null?chosen.later.recovery_percent-baseline.later.recovery_percent:null,confirmation:{eligible:false,reason:'過去集計を見た後の時系列分割による探索。未使用の将来期間による確認ではない。',minimum_races:VALIDATION_POLICY.minimum_races,minimum_days:VALIDATION_POLICY.minimum_days}};
}
export function analyzeStrategies(directory,{now=Date.now()}={}){
 const data=validationObservations(directory,{now});return {schema_version:1,kind:'CONDITIONAL_STRATEGY_EXPLORATION',generated_at:data.generated_at,from:data.from,through:data.through,inputs_sha256:data.inputs_sha256,coverage:data.coverage,candidate_count:STRATEGY_RULES.length,rules:STRATEGY_RULES,method:{stake_yen_per_ticket:100,split:'係数・受信区分ごとの日付前半/後半。前半50購入レース・5的中以上から前半回収率最大を選び、後半は選択に使わない。',baseline:'同じ係数・受信区分の全対象レース、同じ点数上限・オッズ確率条件で比較。候補ごとに投資額とレースが異なる。',ordering:'期待値降順、同率は買い目辞書順。フィルターしてから最大10/20点。',probabilities:'全120通りから艇ごとの1着確率を合算。イン逃げ想定は1号艇1着であり、決まり手や実際の進入の確率ではない。条件付き確率に再正規化しない。'},decision:{mode:'EXPLORATORY_ONLY',default_rule:'return_10_in_under_0.5',automatic_promotion:false,reason:'導入前の観測比較で改善を確証した条件はない。イン50%未満・50倍以上・1%以上の最大10点を暫定検証用に表示し、利用者が点数や艇条件を切り替える。'},groups:data.groups.map(analyzeStrategyGroup),limitations:['保存済みの締切前予想・オッズと正常な公式払戻がある完了レースのみ。欠損・異常・未照合を不的中扱いしない。過去オッズを確定払戻で代用しない。','受信区分・係数版を合算しない。同一レースの受信区分が重複する。集計対象は保存できたレースに偏る。','100条件の探索。閾値や期間を見た後の比較には選択バイアスがある。前後半の比較も真の未使用期間ではなく、統計的優越性・利益を保証しない。','日付全体を分割し、単一最大払戻を差し引いた感度分析も公開する。少数日・少数的中の回収率を採用根拠にしない。','20点は購入額が最大2倍になる。的中率の上昇と回収率の上昇は別。条件未達のレースは購入なし。','既存の予想係数・保存記録・4艇BOX検証企画は変更しない。今後の保存データで条件を固定して追跡する。']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [directory,output]=process.argv.slice(2);if(!directory||!output)throw Error('Usage: node tools/prediction/analyze_strategies.mjs RECORD_DIRECTORY OUTPUT.json');const report=analyzeStrategies(directory);fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({from:report.from,through:report.through,candidates:report.candidate_count,groups:report.groups.length,decision:report.decision}));}catch(e){console.error(e.message);process.exitCode=1;}
}
