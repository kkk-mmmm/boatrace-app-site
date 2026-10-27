// Exploratory audit only. Do not optimize filters or reconstruct pre-race prices from payouts.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {validationObservations} from '../../site/validation-review.mjs';
import {predictionRanking,RETURN_CANDIDATE_RULE} from '../../site/public/view.mjs';
export const RETURN_FILTER_CANDIDATES=[
 {id:'requested',...RETURN_CANDIDATE_RULE,minimum_value:0},
 {id:'requested_ev_at_least_one',...RETURN_CANDIDATE_RULE,minimum_value:1},
 {id:'odds30_probability1',minimum_odds:30,minimum_probability:.01,minimum_value:0},
 {id:'odds100_probability1',minimum_odds:100,minimum_probability:.01,minimum_value:0},
 {id:'odds50_probability2',minimum_odds:50,minimum_probability:.02,minimum_value:0},
];
export function assessReturnFilter(rows,rule){
 const eligible=rows.filter(r=>r.roi_eligible),daily=new Map();let tickets=0,bought=0,hits=0,returned=0,expected=0,probability=0;
 for(const r of eligible){const selection=predictionRanking(r.probabilities,r.probabilities.map(p=>({combo:p.combo,odds:p.odds})),{tab:'value',currentOdds:true}).filter(p=>p.odds>=rule.minimum_odds&&p.probability>=rule.minimum_probability&&p.value>=rule.minimum_value).slice(0,10);
  if(!selection.length)continue;const hit=Number(selection.some(p=>p.combo===r.actual_combo)),stake=selection.length*100,payout=hit*r.payout;
  tickets+=selection.length;bought++;hits+=hit;returned+=payout;expected+=selection.reduce((s,p)=>s+p.value*100,0);probability+=selection.reduce((s,p)=>s+p.probability,0);
  if(!daily.has(r.date))daily.set(r.date,{date:r.date,races:0,tickets:0,hits:0,stake_yen:0,return_yen:0});const d=daily.get(r.date);d.races++;d.tickets+=selection.length;d.hits+=hit;d.stake_yen+=stake;d.return_yen+=payout;
 }
 const stake=tickets*100;return {rule,eligible_races:eligible.length,eligible_days:new Set(eligible.map(r=>r.date)).size,bought_races:bought,bought_days:daily.size,tickets,hits,stake_yen:stake,return_yen:returned,profit_yen:returned-stake,hit_rate_when_bought:bought?hits/bought:null,ticket_hit_rate:tickets?hits/tickets:null,predicted_hit_rate_when_bought:bought?probability/bought:null,recovery_percent:stake?returned/stake*100:null,expected_recovery_percent:stake?expected/stake*100:null,daily:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date))};
}
export function analyzeReturnFilter(directory,{now=Date.now()}={}){
 const data=validationObservations(directory,{now});return {schema_version:1,kind:'RETURN_FILTER_EXPLORATORY_AUDIT',generated_at:data.generated_at,from:data.from,through:data.through,inputs_sha256:data.inputs_sha256,coverage:data.coverage,selection:'期待値降順、同率は買い目辞書順、最大10点、各100円。条件未達のレースは購入なし。',decision:{adopted_rule:RETURN_FILTER_CANDIDATES[0],alternative_adopted:false,reason:'保存済みの締切前予想・オッズによる探索集計。代替条件を事後選択せず、指定条件を維持する。条件を変更するには未使用期間での比較が必要。'},groups:data.groups.map(({rows,...g})=>({...g,conditions:RETURN_FILTER_CANDIDATES.map(rule=>assessReturnFilter(rows,rule))})),limitations:['当日を除く直近30完了日の保存記録だけを使用。保存していない過去の予想・オッズは復元しない。','係数版と受信区分は分離。全120通りのオッズと正常な公式払戻が揃うレースのみ。F/L・欠場・異常結果・欠損の扱いは通常の確率・期待値検証と同じ。','候補ごとに購入するレース数・点数・購入額が異なる。少数の高配当だけで回収率は大きく変わり、見かけの最高回収率を採用条件にしない。','推定確率1%は実測の的中率の下限ではない。オッズ50倍・推定確率1%では推定期待値は0.5倍。的中や利益は保証しない。','現行データは導入前の記録を含む観測監査。条件の有効性・優越性を確定するものではない。']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [directory,output]=process.argv.slice(2);if(!directory||!output)throw Error('Usage: node tools/prediction/analyze_return_filter.mjs 保存記録ディレクトリ 出力JSON');const report=analyzeReturnFilter(directory);fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({from:report.from,through:report.through,groups:report.groups.length,decision:report.decision}));}catch(e){console.error(e.message);process.exitCode=1;}
}
