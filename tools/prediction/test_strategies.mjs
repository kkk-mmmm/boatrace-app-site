import test from 'node:test';import assert from 'node:assert/strict';
import {assessStrategy,strategySelection,analyzeStrategyGroup,STRATEGY_RULES} from './analyze_strategies.mjs';
import {firstPlaceProbabilities,conditionalRanking} from '../../site/public/view.mjs';
const probabilities=[];for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)if(new Set([a,b,c]).size===3)probabilities.push({combo:`${a}-${b}-${c}`,probability:a===1?.02:a===2?.01:.005,odds:100});
const row={date:'2030-01-01',roi_eligible:true,actual_combo:'1-2-3',payout:5000,probabilities};
const rule={base:'return',limit:10,maximum_in:.5};
test('10/20点は同じ順位から切り出し、購入額・的中・回収率と最大配当依存を正しく算出',()=>{
 const rows=[row,{...row,date:'2030-01-02',actual_combo:'1-5-4'}];
 const before=JSON.stringify(rows),ten=assessStrategy(rows,rule),twenty=assessStrategy(rows,{...rule,limit:20});
 assert.deepEqual([ten.tickets,ten.stake_yen,ten.hits,ten.return_yen,ten.recovery_percent],[20,2000,1,5000,250]);
 assert.deepEqual([twenty.tickets,twenty.stake_yen,twenty.hits,twenty.return_yen,twenty.recovery_percent],[40,4000,2,10000,250]);
 assert.equal(ten.recovery_without_largest_percent,0);assert.equal(twenty.recovery_without_largest_percent,125);
 assert.deepEqual(strategySelection(row,rule).map(p=>p.combo),strategySelection(row,{...rule,limit:20}).slice(0,10).map(p=>p.combo));
 assert.equal(twenty.daily.reduce((s,d)=>s+d.stake_yen,0),twenty.stake_yen);assert.equal(JSON.stringify(rows),before);
});
test('艇の確率は全120点から合算し、閾値・1着固定・含む条件・シナリオを交差して扱う',()=>{
 const mass=firstPlaceProbabilities(probabilities);assert.ok(Math.abs(mass[0]-.4)<1e-9);assert.ok(Math.abs(mass[1]-.2)<1e-9);
 assert.deepEqual(conditionalRanking(probabilities,probabilities,{maximum_in:mass[0],currentOdds:true}),[]);
 const quotes=probabilities.map(p=>({...p,odds:p.combo.startsWith('2-')?1000:100}));
 const head=conditionalRanking(probabilities,quotes,{lane:2,minimum_first:mass[1],currentOdds:true});assert.equal(head.length,20);assert.ok(head.every(p=>p.combo.startsWith('2-')));assert.ok(head.every(p=>p.probability===.01));
 assert.deepEqual(conditionalRanking(probabilities,quotes,{lane:2,minimum_first:mass[1]+1e-8,currentOdds:true}),[]);
 const any=conditionalRanking(probabilities,quotes,{lane:2,relation:'any',currentOdds:true});assert.ok(any.length>head.length);assert.ok(any.every(p=>p.combo.split('-').includes('2')));
 assert.deepEqual(conditionalRanking(probabilities,quotes,{lane:2,scenario:'in',currentOdds:true}),[]);
 const partial=probabilities.slice(1);assert.equal(firstPlaceProbabilities(partial),null);assert.deepEqual(conditionalRanking(partial,quotes,{currentOdds:true}),[]);
 assert.deepEqual(conditionalRanking(probabilities,quotes,{currentOdds:false}),[]);assert.deepEqual(conditionalRanking(probabilities,quotes,{base:'probability',currentOdds:true}),[]);
 assert.equal(assessStrategy([{...row,roi_eligible:false}],rule).recovery_percent,null);assert.equal(assessStrategy([row],{...rule,maximum_in:.3}).recovery_percent,null);
});
test('前半で選んだ条件は後半の結果を変えても変わらず、日付単位で分割し未確認扱いにする',()=>{
 const rows=Array.from({length:120},(_,i)=>({...row,date:`2030-01-0${Math.floor(i/30)+1}`}));
 const a=analyzeStrategyGroup({cohort:'TEST',rows}),b=analyzeStrategyGroup({cohort:'TEST',rows:rows.map(r=>r.date>='2030-01-03'?{...r,actual_combo:'6-5-4',payout:100000}:r)});
 assert.equal(a.split_date,'2030-01-03');assert.equal(a.earlier_selected_rule,b.earlier_selected_rule);assert.ok(a.earlier_selected_rule);assert.equal(a.confirmation.eligible,false);
 assert.equal(a.conditions[0].earlier.bought_races,60);assert.equal(a.conditions[0].later.bought_races,60);assert.equal(b.conditions[0].later.hits,0);
 assert.equal(STRATEGY_RULES.length,100);assert.equal(new Set(STRATEGY_RULES.map(r=>r.id)).size,100);
 const none=analyzeStrategyGroup({rows:[row]});assert.equal(none.split_date,null);assert.equal(none.earlier_selected_rule,null);
});
