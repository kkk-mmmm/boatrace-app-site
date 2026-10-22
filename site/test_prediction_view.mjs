import {test} from 'node:test';
import assert from 'node:assert/strict';
import {predictionPool, scenarioProbabilities, predictionRanking, sujiCandidates} from './public/view.mjs';
const rows=[];
for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)if(new Set([a,b,c]).size===3)rows.push({combo:`${a}-${b}-${c}`,probability:a===1?.025:.005});
const quotes=rows.map((row,i)=>({combo:row.combo,odds:i+1}));

test('全120点から1号艇1着20点とそれ以外100点の確率を集計し、不完全な分布は集計しない',()=>{
  const pool=predictionPool({probabilities:rows,items:rows.slice(0,10)}),mass=scenarioProbabilities(pool);
  assert.equal(pool.length,120);assert.ok(Math.abs(mass.in-.5)<1e-12);assert.ok(Math.abs(mass.other-.5)<1e-12);
  for(const incomplete of [pool.slice(0,10),[...pool.slice(1),pool[1]],pool.map(row=>({...row,probability:.02}))])assert.equal(scenarioProbabilities(incomplete),null);
  assert.equal(predictionPool({items:[rows[0],rows[0],{combo:'1-1-2',probability:.2},{combo:'<script>',probability:1},{combo:'1-2-4',probability:NaN}]}).length,1);
});
test('確率順・期待値順の全候補を絞り込み、表示点数を増やしても元の確率を再正規化しない',()=>{
  const before=JSON.stringify(rows);
  for(const [scenario,count] of [['in',20],['other',100],['all',120]])for(const tab of ['probability','value']){
    const ranked=predictionRanking(rows,quotes,{scenario,tab,currentOdds:true});
    assert.equal(ranked.length,count);assert.equal(new Set(ranked.map(row=>row.combo)).size,count);
    assert.equal(ranked.slice(0,10).length,10);assert.equal(ranked.slice(0,20).length,20);
    assert.ok(ranked.every(row=>scenario==='all'||row.combo.startsWith('1-')===(scenario==='in')));
    for(const row of ranked){assert.equal(row.probability,rows.find(r=>r.combo===row.combo).probability);assert.equal(row.value,row.probability*row.odds);}
    for(let i=1;i<ranked.length;i++)assert.ok(tab==='value'?ranked[i-1].value>=ranked[i].value:ranked[i-1].probability>=ranked[i].probability);
  }
  assert.equal(JSON.stringify(rows),before);
});
test('期待値順位は全120点から作り、未提供・無効オッズと古いオッズを除外する',()=>{
  const prices=[{combo:'6-5-4',odds:10000},{combo:'1-2-3',odds:0},{combo:'1-2-4',odds:-10},{combo:'1-2-5',odds:Infinity}];
  const ranked=predictionRanking(rows,prices,{tab:'value',currentOdds:true});
  assert.equal(ranked.length,1);assert.equal(ranked[0].combo,'6-5-4');assert.equal(ranked[0].value,50);
  assert.deepEqual(predictionRanking(rows,prices,{tab:'value',currentOdds:false}),[]);
  assert.ok(predictionRanking(rows,prices,{currentOdds:false}).every(row=>row.value===null));
});
test('スジは1着を固定し相手を1艇以上残す候補に限定して、選択買い目を除き期待値順にする',()=>{
  const candidates=sujiCandidates(rows,quotes,'1-2-3',{scenario:'in',currentOdds:true,limit:100});
  assert.equal(candidates.length,13);
  assert.ok(candidates.every(row=>row.combo.startsWith('1-')&&row.combo!=='1-2-3'&&/[23]/.test(row.combo.slice(2))));
  assert.equal(candidates.find(row=>row.combo==='1-3-2').reason,'2・3着入れ替え');
  assert.equal(candidates.find(row=>row.combo==='1-2-4').reason,'2着固定・3着替え');
  assert.equal(candidates.find(row=>row.combo==='1-4-3').reason,'3着固定・2着替え');
  assert.ok(!candidates.some(row=>row.combo==='1-4-5'));
  for(let i=1;i<candidates.length;i++)assert.ok(candidates[i-1].value>=candidates[i].value);
  assert.equal(sujiCandidates(rows,quotes,'1-2-3',{currentOdds:true}).length,5);
  assert.deepEqual(sujiCandidates(rows,quotes,null,{currentOdds:true}),[]);
  assert.deepEqual(sujiCandidates(rows,quotes,'1-2-3',{currentOdds:false}),[]);
  assert.deepEqual(sujiCandidates(rows,quotes,'1-2-3',{scenario:'other',currentOdds:true}),[]);
  assert.ok(sujiCandidates(rows,quotes,'3-2-1',{scenario:'other',currentOdds:true}).every(row=>row.combo.startsWith('3-')));
});
