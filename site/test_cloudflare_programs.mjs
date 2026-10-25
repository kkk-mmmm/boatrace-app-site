import {test} from 'node:test';import assert from 'node:assert/strict';
import {ANNUAL_ENGINE,ANNUAL_FEATURES,emptyAnnualProfiles,observeAnnual} from './public/annual-model.mjs';
import {annualForecast,annualEntryData} from '../cloudflare/odds/program.mjs';
import {applyLiveOdds,validateLiveOdds,validProgram,proposalCandidate,proposalRace} from './public/odds-live.mjs';
import {cloudflareSnapshots} from './collect-cloudflare.mjs';
const now=Date.parse('2030-01-01T01:00:00Z'),date='2030-01-01';
function example(){
 const entries=Array.from({length:6},(_,i)=>({lane:i+1,name:'選手'+i,racer_id:String(4000+i),finish:i+1,finish_status:'NORMAL',actual_st_status:'NORMAL',actual_st:.1+i*.01,start_rank:i+1,exhibition_time:6.6+i*.01}));
 const profiles=emptyAnnualProfiles();observeAnnual(profiles,{entries,kimarite:'逃げ',context:{meeting_day:1,phase:'QUALIFYING'}});
 const model={schema_version:3,engine_version:ANNUAL_ENGINE,id:'annual-v3-'+'a'.repeat(64),name:'test annual',status:'HISTORICAL_VALIDATED',trained_from:'2029-01-01',trained_through:'2029-12-31',
  profiles,coefficients:ANNUAL_FEATURES.map((_,i)=>i===0?1:0),means:ANNUAL_FEATURES.map(()=>0),scales:ANNUAL_FEATURES.map(()=>1),temperature:1,coverage:{days:365,failures:0,from:'2029-01-01',through:'2029-12-31'},validation:{lambda:.5}};
 const p=annualForecast({date,venue_code:'06',venue:'浜名湖',race_no:1,deadline_at:new Date(now+20*60000).toISOString(),entries_fetched_at:new Date(now-60000).toISOString(),entries,context:{meeting_day:1,phase:'QUALIFYING'}},model,now);
 const calendar={date,venues:Array.from({length:24},(_,i)=>({code:String(i+1).padStart(2,'0'),meeting_status:i===5?'OPEN':'NO_MEETING',meeting:{}}))};
 const quote={date,venue_code:'06',race_no:1,deadline_at:p.deadline_at,prediction_key:p.prediction_key,status:'OK',attempted_at:new Date(now).toISOString(),fetched_at:new Date(now+1).toISOString(),source_url:'https://www.boatrace.jp/owpc/pc/race/odds3t?hd=20300101&jcd=06&rno=1',items:[{combo:'1-2-3',odds:20}]};
 return {p,model,data:{schema_version:1,date,served_at:new Date(now).toISOString(),interval_seconds:60,calendar,programs:[p],races:[quote],update:{status:'COMPLETE'}}};
}
test('CFの1回の共有配信から24場を作り、年次予想・出走表・枠別統計・期待値を連携する',()=>{
 const {p,data}=example();assert.equal(validProgram(p,date,now),true);
 const rows=cloudflareSnapshots(data,now);assert.equal(rows.length,24);const hamana=rows.find(s=>s.venue_code==='06');
 assert.equal(hamana.meeting_status,'OPEN');assert.equal(hamana.races[0].probabilities.length,120);assert.equal(hamana.races[0].entries[0].annual_lane.mean_points,10);
 assert.equal(hamana.races[0].expected_value_items[0].value,hamana.races[0].probabilities.find(r=>r.combo==='1-2-3').probability*20);
 assert.equal(rows.find(s=>s.venue_code==='01').meeting_status,'NO_MEETING');
});
test('別日・壊れた履歴予想・未来の入力を拒否し、締切3分前以降は予想を作り直さない',()=>{
 const {p,model,data}=example();assert.throws(()=>validateLiveOdds({...data,programs:[{...p,date:'2029-12-31'}]},date));
 assert.equal(validProgram({...p,entries_fetched_at:new Date(now+120000).toISOString()},date,now),false);
 assert.equal(annualForecast(p,model,Date.parse(p.deadline_at)-180000),null);
 const old={schema_version:1,date:'2029-12-31',venue_code:'06',venue:'浜名湖',races:[{race_no:12,date:'2029-12-31'}],update:{status:'FAILED'}};
 const merged=applyLiveOdds(old,data,now);assert.equal(merged.date,date);assert.deepEqual(merged.races.map(r=>r.race_no),[1]);
});
test('保存提案は後から新しい年次モデル・出走表が届いても当時の確率を保持する',()=>{
 const {p,data}=example();const cutoff=Date.parse(p.deadline_at)-180000;
 const candidate=proposalCandidate(p,{...data.races[0],fetched_at:new Date(cutoff-300000).toISOString()},cutoff-299990);assert.ok(candidate);
 const saved={...candidate,frozen_at:new Date(cutoff).toISOString()};
 const snapshot={date,venue_code:'06',venue:'浜名湖',races:[{...p,proposal_snapshot:saved}],update:{status:'OK'}};
 const next=applyLiveOdds(snapshot,{...data,programs:[{...p,entries:p.entries.map(e=>({...e,name:'更新後'}))}]},cutoff+1);
 assert.deepEqual(proposalRace(next.races[0],cutoff+1).probabilities,saved.probabilities);
 assert.equal(next.races[0].entries[0].name,'更新後');
});

test('締切後も出走表へ年次統計を追加でき、保存済みの予想は計算し直さない',()=>{
 const {p,model}=example(),closed={...p,deadline_at:new Date(now-1000).toISOString(),model_id:'legacy',prediction_saved_at:'2029-12-31T12:00:00Z'};
 const enriched=annualEntryData(closed,model);assert.equal(enriched.entries[0].annual_lane.samples,1);assert.equal(enriched.history_window.days,365);
 assert.equal(enriched.model_id,'legacy');assert.equal(enriched.prediction_saved_at,closed.prediction_saved_at);assert.deepEqual(enriched.probabilities,closed.probabilities);
 assert.equal(annualForecast(enriched,model,now),null);
});

test('日付変更後の朝の取得待ちは新しい開催日と空の出走表を明示し、前日の予想を混ぜない',()=>{
 const {data}=example();const rows=cloudflareSnapshots({...data,programs:[],races:[],update:{status:'IDLE'}},now,[{date:'2029-12-31',venue_code:'06',races:[{race_no:12}]}]);
 const next=rows.find(s=>s.venue_code==='06');assert.equal(next.date,'2030-01-01');assert.deepEqual(next.races,[]);assert.equal(next.update.status,'PARTIAL');assert.equal(next.update.reason,'INITIAL_COLLECTION_PENDING');assert.match(next.update.message,/取得待ち/);
 const failed=applyLiveOdds(next,{...data,programs:[],races:[],update:{status:'FAILED'}},now);
 assert.equal(failed.update.status,'FAILED');assert.equal(failed.update.reason,null);
});

test('場別v3.1の17項目・場別集計をCloudflareの予想へ渡せる',async()=>{
 const {VENUE_ANNUAL_ENGINE,VENUE_ANNUAL_FEATURES}=await import('./public/annual-model.mjs');const {p,model}=example();
 model.engine_version=VENUE_ANNUAL_ENGINE;model.feature_names=VENUE_ANNUAL_FEATURES;model.coefficients=VENUE_ANNUAL_FEATURES.map((_,i)=>i===14?1:0);model.means=VENUE_ANNUAL_FEATURES.map(()=>0);model.scales=VENUE_ANNUAL_FEATURES.map(()=>1);
 observeAnnual(model.profiles,{...p,kimarite:'逃げ'});const next=annualForecast(p,model,now);
 assert.equal(next.scores[0].history_components.length,17);assert.equal(next.history.venue.applied,true);assert.equal(next.history.venue.venue_code,'06');assert.equal(next.history.venue.lanes[0].starts,1);assert.equal(validProgram(next,date,now),true);
});

test('結果を別データとして反映し、保存予想は保持。別日・別選手・未来の結果は拒否する',async()=>{
 const {p,data}=example(),end=Date.parse(p.deadline_at),later=end+600000;
 const {programResult}=await import('../cloudflare/odds/program.mjs');
 const fs=await import('node:fs');const parsed=programResult(JSON.parse(fs.readFileSync(new URL('../tools/site/fixtures/official-result-20261023.json',import.meta.url))));
 const result={...parsed,date,venue_code:'06',race_no:1,deadline_at:p.deadline_at,attempted_at:new Date(later-60000).toISOString(),fetched_at:new Date(later).toISOString(),source_url:'https://www.boatrace.jp/owpc/pc/race/raceresult?hd=20300101&jcd=06&rno=1',entries:parsed.entries.map(e=>({...e,racer_id:p.entries.find(b=>b.lane===e.lane).racer_id}))};
 const delivery={...data,results:[result],served_at:new Date(later).toISOString()};assert.doesNotThrow(()=>validateLiveOdds(delivery,date,later));
 const old={date,venue_code:'06',venue:'浜名湖',races:[p],update:{status:'OK'}};
 const merged=applyLiveOdds(old,delivery,later).races[0];assert.equal(merged.result.status,'CONFIRMED');assert.deepEqual(merged.probabilities,p.probabilities);assert.equal(merged.prediction_saved_at,p.prediction_saved_at);
 assert.throws(()=>validateLiveOdds({...delivery,results:[{...result,date:'2029-12-31'}]},date,later));assert.throws(()=>validateLiveOdds(delivery,date,end));
 const mismatch={...result,entries:result.entries.map((e,i)=>({...e,racer_id:String(5000+i)}))};assert.equal(applyLiveOdds(old,{...delivery,results:[mismatch]},later).races[0].result,undefined);
});

test('確定買い目を固定提案の全120点と照合し、後から届いた確率・オッズを混ぜない',async()=>{
 const {resultComparison}=await import('./public/odds-live.mjs'),{renderRaceResult}=await import('./public/view.mjs');
 const {p,data}=example(),end=Date.parse(p.deadline_at),cutoff=end-180000,now=end+600000;
 const quotes=p.probabilities.map((r,i)=>({combo:r.combo,odds:10+i}));
 const candidate=proposalCandidate(p,{...data.races[0],items:quotes,fetched_at:new Date(cutoff-1000).toISOString()},cutoff-1000);assert.ok(candidate);
 const saved={...candidate,frozen_at:new Date(cutoff).toISOString(),model_name:'保存モデル <test>'};
 const sorted=[...saved.probabilities].sort((a,b)=>b.probability-a.probability||a.rank-b.rank);
 const result={date:p.date,venue_code:p.venue_code,race_no:p.race_no,deadline_at:p.deadline_at,status:'CONFIRMED',source_url:'https://www.boatrace.jp/owpc/pc/race/raceresult?hd=20300101&jcd=06&rno=1',attempted_at:new Date(end+540000).toISOString(),fetched_at:new Date(now).toISOString(),entries:p.entries.map((e,i)=>({...e,finish:i+1,course:i+1,st:.12})),payouts:[{combo:sorted[9].combo,payout_yen_per_100:99999},{combo:sorted[10].combo,payout_yen_per_100:88888}]};
 const race={...p,proposal_snapshot:saved,result};const before=JSON.stringify(race),comparison=resultComparison(race,now);assert.equal(comparison.status,'OK');assert.deepEqual(comparison.rows.map(r=>r.probability_rank),[10,11]);
 for(const row of comparison.rows){const prob=saved.probabilities.find(p=>p.combo===row.combo).probability,odds=quotes.find(q=>q.combo===row.combo).odds;assert.equal(row.probability,prob);assert.equal(row.odds,odds);assert.equal(row.value,prob*odds);}
 const expected=[...quotes].sort((a,b)=>saved.probabilities.find(p=>p.combo===b.combo).probability*b.odds-saved.probabilities.find(p=>p.combo===a.combo).probability*a.odds);assert.equal(comparison.rows[0].value_rank,expected.findIndex(q=>q.combo===comparison.rows[0].combo)+1);
 const updated={...race,model_name:'最新モデル',probabilities:[...p.probabilities].reverse(),odds:{items:quotes.map(q=>({...q,odds:500}))}};assert.deepEqual(resultComparison(updated,now),comparison);assert.equal(JSON.stringify(race),before);
 const html=renderRaceResult(race,now,comparison);assert.match(html,/10位（上位10点）/);assert.match(html,/11位/);assert.match(html,/保存モデル &lt;test&gt;/);assert.match(html,/実際の購入・的中履歴ではありません/);
 for(const bad of [null,{...saved,race_no:2},{...saved,date:'2029-12-31'},{...saved,prediction_saved_at:new Date(end+1).toISOString()},{...saved,entries:saved.entries.map(e=>({...e,racer_id:'9999'}))}])assert.equal(resultComparison({...race,proposal_snapshot:bad},now).status,'UNAVAILABLE');
 const partial={...saved,odds:{...saved.odds,items:quotes.filter(q=>q.combo!==result.payouts[0].combo)}};const missing=resultComparison({...race,proposal_snapshot:partial},now);assert.equal(missing.status,'OK');assert.equal(missing.rows[0].odds,null);assert.equal(missing.rows[0].value,null);assert.equal(missing.rows[0].value_rank,null);assert.equal(missing.quoted_count,119);
 assert.equal(resultComparison({...race,result:{...result,payouts:[]}},now).status,'UNAVAILABLE');assert.equal(resultComparison({...race,result:{...result,status:'PENDING'}},now).status,'PENDING');
});
