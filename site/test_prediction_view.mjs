import {test} from 'node:test';
import assert from 'node:assert/strict';
import {predictionPool, scenarioProbabilities, predictionRanking, sujiCandidates, featuredRaceGroups} from './public/view.mjs';
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
  assert.equal(candidates.length,10);
  assert.ok(candidates.every(row=>row.combo.startsWith('1-')&&row.combo!=='1-2-3'&&/[23]/.test(row.combo.slice(2))));
  const reasons=sujiCandidates(rows,quotes.filter(x=>['1-3-2','1-2-4','1-4-3'].includes(x.combo)),'1-2-3',{currentOdds:true});
  assert.equal(reasons.find(row=>row.combo==='1-3-2').reason,'2・3着入れ替え');
  assert.equal(reasons.find(row=>row.combo==='1-2-4').reason,'2着固定・3着替え');
  assert.equal(reasons.find(row=>row.combo==='1-4-3').reason,'3着固定・2着替え');
  assert.ok(!candidates.some(row=>row.combo==='1-4-5'));
  for(let i=1;i<candidates.length;i++)assert.ok(candidates[i-1].value>=candidates[i].value);
  assert.equal(sujiCandidates(rows,quotes,'1-2-3',{currentOdds:true}).length,10);
  assert.deepEqual(sujiCandidates(rows,quotes,null,{currentOdds:true}),[]);
  assert.deepEqual(sujiCandidates(rows,quotes,'1-2-3',{currentOdds:false}),[]);
  assert.deepEqual(sujiCandidates(rows,quotes,'1-2-3',{scenario:'other',currentOdds:true}),[]);
  assert.ok(sujiCandidates(rows,quotes,'3-2-1',{scenario:'other',currentOdds:true}).every(row=>row.combo.startsWith('3-')));
});

test('複数選択のスジを統合し、選択済み・重複を除いて全体の期待値上位10点を提案する',()=>{
 const selected=['1-2-3','1-3-2','3-2-1','1-2-3'];
 const result=sujiCandidates([...rows,rows[0]],quotes,selected,{currentOdds:true});
 assert.equal(result.length,10);assert.equal(new Set(result.map(r=>r.combo)).size,10);
 const individual=new Map(selected.flatMap(combo=>sujiCandidates(rows,quotes,combo,{currentOdds:true})).filter(r=>!selected.includes(r.combo)).map(r=>[r.combo,r]));
 const expected=[...individual.values()].sort((a,b)=>b.value-a.value||a.combo.localeCompare(b.combo)).slice(0,10);
 assert.deepEqual(result.map(r=>r.combo),expected.map(r=>r.combo));
 for(const r of result){assert.ok(!selected.includes(r.combo));assert.ok(r.based_on.length);assert.ok(r.based_on.every(c=>selected.includes(c)&&c[0]===r.combo[0]));}
 const overlapping=sujiCandidates(rows,quotes.filter(x=>x.combo==='1-2-4'),selected,{currentOdds:true});
 assert.equal(overlapping.length,1);assert.deepEqual(overlapping[0].based_on,['1-2-3','1-3-2']);
 assert.deepEqual(sujiCandidates(rows,quotes,selected,{currentOdds:false}),[]);
 assert.deepEqual(sujiCandidates(rows,quotes,rows.map(r=>r.combo),{currentOdds:true}),[]);
 assert.equal(sujiCandidates(rows,quotes,selected,{currentOdds:true,limit:999}).length,10);
 assert.ok(sujiCandidates(rows,quotes,selected,{scenario:'in',currentOdds:true}).every(r=>r.combo.startsWith('1-')));
});

test('場の過去実績は予想確率と区別し、場・日付が合うときだけ表示する',async()=>{
 const {renderVenueSummary}=await import('./public/view.mjs');
 const race={date:'2030-01-01',venue_code:'24',scores:[{history_components:[{label:'場・枠別1着傾向'}]}],history:{venue:{venue_code:'24',from:'2029-01-01',through:'2029-12-31',national_lane1_win_rate:.55,lanes:[{lane:1,starts:2000,win_rate:.7,escape_rate:.65}]}}};
 const html=renderVenueSummary(race);for(const word of ['70.0%','65.0%','55.0%','予想に反映','今回の予想確率ではありません'])assert.ok(html.includes(word));
 assert.equal(renderVenueSummary({...race,venue_code:'01'}),'');assert.equal(renderVenueSummary({...race,date:'2029-12-31'}),'');
 race.history.venue.from='<script>';assert.doesNotMatch(renderVenueSummary(race),/<script>/);
});

test('結果タブは未確定・失敗と確定を区別し、公式結果とリプレイへ案内する',async()=>{
 const {renderRaceResult}=await import('./public/view.mjs');const race={date:'2030-01-01',venue_code:'24',race_no:1,deadline_at:'2030-01-01T01:00:00Z'};
 assert.match(renderRaceResult(race,Date.parse(race.deadline_at)-1),/レース前/);assert.match(renderRaceResult(race,Date.parse(race.deadline_at)+1),/未確定・取得待ち/);assert.match(renderRaceResult({...race,result:{status:'FAILED'}},Date.parse(race.deadline_at)+1),/取得に失敗/);
 const html=renderRaceResult({...race,result:{status:'CONFIRMED',fetched_at:'2030-01-01T01:10:59Z',kimarite:'差し',entries:[{lane:1,name:'<script>',finish:1,course:2,st:.13,st_status:'NORMAL'}],payouts:[{combo:'1-2-3',payout_yen_per_100:1230}]}});
 assert.match(html,/10:10/);assert.doesNotMatch(html,/\b\d{1,2}:\d{2}:\d{2}\b/);assert.match(html,/0\.13/);
 assert.match(html,/確定結果/);assert.match(html,/1,230円/);assert.match(html,/本番進入/);assert.match(html,/公式リプレイ/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});

test('締切一覧は全場からオッズに依存せず近い5件を選び、期限切れ・別日・重複・不正値を除く',async()=>{
 const {upcomingRaceList}=await import('./public/view.mjs'),now=Date.parse('2030-01-01T01:00:00Z');
 const rows=Array.from({length:8},(_,i)=>({date:'2030-01-01',venue_code:String(i+1).padStart(2,'0'),race_no:2,deadline_at:new Date(now+(8-i)*60000).toISOString(),odds:null}));
 const before=JSON.stringify(rows);assert.deepEqual(upcomingRaceList(rows,now).map(r=>r.venue_code),['08','07','06','05','04']);assert.equal(JSON.stringify(rows),before);
 const bad=[null,{...rows[0],date:'2029-12-31'},{...rows[0],deadline_at:new Date(now).toISOString()},{...rows[0],venue_code:'25'},{...rows[0],race_no:13},{...rows[0],deadline_at:'2030-01-02T00:00:00+09:00'}];assert.deepEqual(upcomingRaceList(bad,now),[]);
 assert.equal(upcomingRaceList([rows[0],rows[0]],now).length,1);assert.equal(upcomingRaceList(rows,now+7*60000).length,1);assert.deepEqual(upcomingRaceList(rows,now+8*60000),[]);
 assert.deepEqual(Object.keys(upcomingRaceList(rows,now)[0]),['date','venue_code','race_no','deadline_at']);
});

test('固定検証の回収条件は50倍・1%以上を抽出し、従来の期待値順を維持する',()=>{
 const probs=[{combo:'1-2-3',probability:.01},{combo:'1-2-4',probability:.0099999},{combo:'2-1-3',probability:.02},{combo:'2-1-4',probability:.025},{combo:'3-1-2',probability:.02},{combo:'4-1-2',probability:.05}];
 const prices=[{combo:'1-2-3',odds:50},{combo:'1-2-4',odds:100},{combo:'2-1-3',odds:49.999},{combo:'2-1-4',odds:50},{combo:'3-1-2',odds:100}];
 const before=JSON.stringify({probs,prices}),ranked=predictionRanking(probs,prices,{tab:'return',currentOdds:true});
 assert.deepEqual(ranked.map(x=>x.combo),['3-1-2','2-1-4','1-2-3']);assert.deepEqual(ranked.map(x=>x.value),[2,1.25,.5]);
 assert.deepEqual(predictionRanking(probs,prices,{tab:'return',currentOdds:false}),[]);
 assert.deepEqual(predictionRanking(probs,prices,{tab:'return',currentOdds:true,scenario:'in'}).map(x=>x.combo),['1-2-3']);
 assert.deepEqual(predictionRanking(probs,prices,{tab:'return',currentOdds:true,scenario:'other'}).map(x=>x.combo),['3-1-2','2-1-4']);
 assert.equal(JSON.stringify({probs,prices}),before);
});

test('回収率上位タブは50倍・1%以上を確率降順へ並べ、固定検証の順序を変更しない',async()=>{
 const {returnProbabilityRanking}=await import('./public/view.mjs');
 const rows=[{combo:'1-2-3',probability:.01},{combo:'2-1-3',probability:.03},{combo:'3-1-2',probability:.02},{combo:'4-1-2',probability:.03},{combo:'5-1-2',probability:.04},{combo:'6-1-2',probability:.009}],quotes=[{combo:'1-2-3',odds:500},{combo:'2-1-3',odds:50},{combo:'3-1-2',odds:100},{combo:'4-1-2',odds:60},{combo:'5-1-2',odds:49.9},{combo:'6-1-2',odds:1000}],before=JSON.stringify({rows,quotes});
 assert.deepEqual(returnProbabilityRanking(rows,quotes,{currentOdds:true}).map(r=>r.combo),['2-1-3','4-1-2','3-1-2','1-2-3']);assert.deepEqual(predictionRanking(rows,quotes,{tab:'return',currentOdds:true}).map(r=>r.combo),['1-2-3','3-1-2','4-1-2','2-1-3']);
 assert.deepEqual(returnProbabilityRanking(rows,quotes,{currentOdds:false}),[]);assert.deepEqual(returnProbabilityRanking(rows,quotes,{currentOdds:true,scenario:'in'}).map(r=>r.combo),['1-2-3']);assert.equal(JSON.stringify({rows,quotes}),before);
});
