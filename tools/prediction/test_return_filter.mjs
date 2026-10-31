import test from 'node:test';import assert from 'node:assert/strict';
import {assessReturnFilter,RETURN_FILTER_CANDIDATES} from './analyze_return_filter.mjs';
import {predictionRanking} from '../../site/public/view.mjs';
const probs=[];for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)if(new Set([a,b,c]).size===3)probs.push({combo:`${a}-${b}-${c}`,probability:a===1?.025:.005,odds:50});
const row={date:'2030-01-01',roi_eligible:true,payout:5000,actual_combo:'1-2-3',probabilities:probs};
test('導入時の固定条件の分析は従来の期待値順10点を各100円で評価し、実払戻と推定回収率を区別する',()=>{
 const r=assessReturnFilter([row],RETURN_FILTER_CANDIDATES[0]);assert.equal(r.tickets,10);assert.equal(r.bought_races,1);assert.equal(r.hits,1);assert.equal(r.stake_yen,1000);assert.equal(r.return_yen,5000);assert.equal(r.recovery_percent,500);assert.ok(Math.abs(r.expected_recovery_percent-125)<1e-10);
 const selected=predictionRanking(probs,probs.map(p=>({combo:p.combo,odds:p.odds})),{tab:'return',currentOdds:true}).slice(0,10);assert.equal(r.tickets,selected.length);assert.ok(selected.some(p=>p.combo===row.actual_combo));assert.equal(r.daily[0].stake_yen,r.stake_yen);
});
test('該当なしは購入ゼロ・回収率未集計、欠損結果は損失にしない',()=>{
 const none=assessReturnFilter([row],{minimum_odds:100,minimum_probability:.01,minimum_value:0});assert.equal(none.bought_races,0);assert.equal(none.stake_yen,0);assert.equal(none.recovery_percent,null);assert.equal(none.hit_rate_when_bought,null);
 const missing=assessReturnFilter([{...row,roi_eligible:false}],RETURN_FILTER_CANDIDATES[0]);assert.equal(missing.eligible_races,0);assert.equal(missing.return_yen,0);assert.equal(missing.recovery_percent,null);
});
