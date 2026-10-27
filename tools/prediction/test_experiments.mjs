import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {captureProspective} from './prospective.mjs';import {proposalCandidate} from '../../site/public/odds-live.mjs';
import {captureExperiments,captureInventory,experimentSelection,experimentReport,finalizeExperiments,summarizeExperiment,writePublicExperiments} from './experiments.mjs';
import {studyHTML,studyRecordHTML} from '../../site/public/experiments-view.mjs';
const now=Date.parse('2030-01-01T01:00:00Z'),freeze=now+5*60000,end=now+33*86400000;
const definition={id:'test-study',title:'試験',from:'2030-01-01',through:'2030-01-31',registered_at:new Date(now-60000).toISOString(),strategy:'EV_TOP10_FREQUENT_FOUR_BOX_V1',stake_per_combo_yen:100,tie_break:['summed_expected_value','lane_ascending'],venue_codes:Array.from({length:24},(_,i)=>String(i+1).padStart(2,'0'))};
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boatrace-study-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function example({quotes=null}={}){const probabilities=[];for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)if(new Set([a,b,c]).size===3)probabilities.push({combo:`${a}-${b}-${c}`,probability:1/120,rank:probabilities.length+1});
 const entries=Array.from({length:6},(_,i)=>({lane:i+1,racer_id:String(4000+i),name:'選手'})),deadline_at=new Date(now+8*60000).toISOString();
 const target={date:'2030-01-01',venue_code:'01',race_no:1,deadline_at,model_id:'test-model',prediction_saved_at:new Date(now-1000).toISOString(),input_fetched_at:new Date(now-30000).toISOString(),prediction_key:'test-model:'+new Date(now-1000).toISOString(),entries,probabilities,update_status:'OK',last_success_at:new Date(now-1000).toISOString(),context:{grade:'G1'}};
 const quote={...target,status:'OK',items:quotes||probabilities.map(x=>({combo:x.combo,odds:20})),fetched_at:new Date(now-1).toISOString(),source_url:'https://www.boatrace.jp/owpc/pc/race/odds3t?hd=20300101&jcd=01&rno=1'};
 return {date:target.date,venue_code:'01',meeting_status:'OPEN',meeting:{grade:'G1'},races:[{...target,proposal_snapshot:{...proposalCandidate(target,quote,now),frozen_at:new Date(freeze).toISOString()}}]};}
function setup(t){const dir=temp(t),s=example();captureInventory([s],dir,[definition],{now:now-2000});captureProspective([s],dir,{now:freeze+1000});captureExperiments(dir,[definition],{now:freeze+1000});return dir;}
function results(dir,{abnormal=false,payout=2400}={}){const source={url:'https://www1.mbrace.or.jp/od2/K/203001/k300101.lzh',sha256:'a'.repeat(64)},s=example(),rows=[{date:s.date,venue_code:'01',race_no:1,source,entries:s.races[0].entries.map((x,i)=>({...x,finish:i+1,actual_st:.15,actual_st_status:abnormal?'F':'NORMAL',finish_status:'NORMAL'})),payout:{combo:'1-2-3',yen:payout,source_url:source.url,source_sha256:source.sha256}}];fs.mkdirSync(path.join(dir,'results'),{recursive:true});const bytes=JSON.stringify(rows);fs.writeFileSync(path.join(dir,'results/2030-01-01.json'),bytes);fs.writeFileSync(path.join(dir,'results/2030-01-01.sha256'),hash(bytes));}
function source(dir){return JSON.parse(fs.readFileSync(path.join(dir,'snapshots/2030-01-01/01/R1',fs.readdirSync(path.join(dir,'snapshots/2030-01-01/01/R1'))[0])));}
test('頻度・期待値合計・艇番で決定し、4艇BOX24点・全艇1着確率・予想回収率を固定する',t=>{
 const dir=setup(t),s=experimentSelection(source(dir),definition,{now:freeze+1000,activatedAt:new Date(now-2000).toISOString()});
 assert.deepEqual(s.selected_lanes,[1,2,3,4]);assert.equal(s.box.length,24);assert.equal(new Set(s.box.map(x=>x.combo)).size,24);assert.equal(s.projected_box.stake_yen,2400);assert.ok(Math.abs(s.projected_box.hit_probability-.2)<1e-12);assert.ok(Math.abs(s.projected_box.expected_recovery_percent-100/6)<1e-10);assert.ok(Math.abs(s.first_probabilities.reduce((a,x)=>a+x.probability,0)-1)<1e-12);assert.equal(s.in_probability+s.other_probability,1);
 const top=s.value_top10;assert.equal(top.length,10);assert.equal(s.grade,'G1');assert.deepEqual(s.frequency.map(x=>x.lane),[1,2,3,4,5,6]);
 const r=experimentReport(dir,definition,{now:freeze+1000});assert.equal(r.summary.pending,1);assert.equal(r.summary.stake_yen,0);assert.equal(r.summary.recovery_percent,null);
});
test('登録・有効化前、未固定、部分オッズは対象外。結果を見て4艇を変えない',t=>{
 const dir=setup(t),raw=source(dir),at=new Date(freeze).toISOString();assert.throws(()=>experimentSelection(raw,definition,{now:freeze+1000,activatedAt:at}),/登録前/);
 const p=path.join(dir,'experiments/test-study/predictions/2030-01-01/01/R1.json'),before=fs.readFileSync(p,'utf8');results(dir);captureExperiments(dir,[definition],{now:freeze+1000});assert.equal(fs.readFileSync(p,'utf8'),before);
 const changed={...definition,tie_break:['lane_ascending']};assert.throws(()=>captureExperiments(dir,[changed],{now:freeze+1000}),/ルール/);
 const late=temp(t);captureProspective([example()],late,{now:freeze+1000});assert.equal(captureExperiments(late,[definition],{now:freeze+1000}).saved,0);
});
test('公式実払戻でBOX・上位10点と予想との差を計算し、場・G1・確率帯を集計する',t=>{
 const dir=setup(t);results(dir);const r=experimentReport(dir,definition,{now:now+86400000}),s=r.summary;
 assert.equal(s.settled,1);assert.equal(s.hits,1);assert.equal(s.stake_yen,2400);assert.equal(s.return_yen,2400);assert.equal(s.recovery_percent,100);assert.equal(s.top10_recovery_percent,240);assert.equal(s.box_vs_top10_gap_points,-140);assert.ok(Math.abs(s.recovery_gap_points-100*5/6)<1e-10);assert.equal(r.by_grade[0].label,'G1');assert.equal(r.by_venue[0].label,'01');assert.equal(r.by_in_probability[0].label,'30%未満');
 assert.ok(studyHTML(r).includes('24通り'));assert.ok(studyRecordHTML(r.records[0]).includes('1号艇1着'));assert.ok(studyRecordHTML(r.records[0]).includes('1-2-3'));
});
test('欠損・異常結果を損失にせず、結果ハッシュ・予想の改変を拒否する',t=>{
 const dir=setup(t);results(dir,{abnormal:true});assert.equal(experimentReport(dir,definition,{now:now+86400000}).summary.excluded,1);assert.equal(experimentReport(dir,definition,{now:now+86400000}).summary.stake_yen,0);
 fs.appendFileSync(path.join(dir,'results/2030-01-01.json'),' ');assert.throws(()=>experimentReport(dir,definition,{now:end}),/integrity/);
 const missing=temp(t);captureInventory([example()],missing,[definition],{now:now-2000});assert.equal(experimentReport(missing,definition,{now:now+86400000}).summary.missing_prediction,1);assert.equal(experimentReport(missing,definition,{now:now+86400000}).summary.stake_yen,0);
});
test('終了後の記事を一度だけ確定し、7日・30日経過後も保持する',t=>{
 const dir=setup(t);results(dir);finalizeExperiments(dir,[definition],{now:now+86400000});assert.equal(fs.existsSync(path.join(dir,'experiments/test-study/article.json')),false);
 finalizeExperiments(dir,[definition],{now:end});const p=path.join(dir,'experiments/test-study/article.json'),before=fs.readFileSync(p,'utf8');finalizeExperiments(dir,[definition],{now:end+86400000});assert.equal(fs.readFileSync(p,'utf8'),before);const report=experimentReport(dir,definition,{now:end+365*86400000});assert.equal(report.records.length,1);assert.equal(report.status,'COMPLETED');assert.equal(report.summary.recovery_percent,100);assert.ok(report.article_archived_at);
});
test('集計は単純平均でなく投資額による加重回収率、HTMLへ任意の文字を実行させない',()=>{
 const p={status:'SETTLED',box_result:{hit:true,return_yen:10000},top10_result:{return_yen:0},projected_box:{expected_return_yen:3000,hit_probability:.3}},q={...p,box_result:{hit:false,return_yen:0}};assert.equal(summarizeExperiment([p,q]).recovery_percent,10000/4800*100);assert.ok(!studyRecordHTML({date:'<script>alert(1)</script>',venue_code:'01',race_no:1,status:'MISSING_PROPOSAL',grade:'G1'}).includes('<script>'));
});

test('4位の頻度同数は期待値合計で決定し、全120通り未取得を採用しない',t=>{
 const combos=['1-2-3','2-3-4','3-4-5','4-5-6','5-6-1','6-1-2','1-3-2','2-1-3','3-2-1','2-3-1'];
 const quote=example().races[0].proposal_snapshot.odds.items.map(x=>({...x,odds:combos.includes(x.combo)?(x.combo==='4-5-6'?200:['5-6-1','6-1-2'].includes(x.combo)?100:20):1}));
 const dir=temp(t);captureProspective([example({quotes:quote})],dir,{now:freeze+1000});const selected=experimentSelection(source(dir),definition,{now:freeze+1000});assert.deepEqual(selected.selected_lanes,[1,2,3,6]);assert.equal(selected.frequency.find(x=>x.lane===4).count,3);assert.equal(selected.frequency.find(x=>x.lane===6).count,3);
 const partial=temp(t);captureProspective([example({quotes:quote.slice(1)})],partial,{now:freeze+1000});assert.throws(()=>experimentSelection(source(partial),definition,{now:freeze+1000}),/全120/);
 const file=path.join(dir,'snapshots/2030-01-01/01/R1',fs.readdirSync(path.join(dir,'snapshots/2030-01-01/01/R1'))[0]);const tampered=JSON.parse(fs.readFileSync(file));tampered.proposal.probabilities[0].probability=.99;assert.throws(()=>experimentSelection(tampered,definition,{now:freeze+1000}),/変更/);
});

test('公開書き出しは日付単位に分割し、通常の目次へ全買い目を載せない',t=>{
 const dir=setup(t);results(dir);const out=path.join(dir,'public'),data=writePublicExperiments(dir,[definition],out,{now:now+86400000});const study=data.experiments[0];assert.equal(study.records.length,0);assert.equal(study.record_days.length,1);const day=JSON.parse(fs.readFileSync(path.join(out,study.record_days[0].url)));assert.equal(day.records[0].box.length,24);assert.equal(day.records[0].value_top10.length,10);assert.equal(day.experiment_id,definition.id);assert.equal(study.summary.settled,1);
});

test('成績カードを先に表示し、検証条件を初期状態で閉じ、記録と記事を保持する',t=>{
 const dir=setup(t);results(dir);const report=experimentReport(dir,definition,{now:now+86400000}),html=studyHTML(report);
 assert.ok(html.indexOf('class="study-metrics"')<html.indexOf('class="study-method"'));
 const metrics=html.match(/<dl class="study-metrics"[^>]*>([\s\S]*?)<\/dl>/)[1];
 for(const label of ['検証状況','検証中','照合済み','仮想回収率','事前予想との差'])assert.ok(metrics.includes(label));
 assert.match(html,/<details class="study-method">/);assert.doesNotMatch(html,/<details class="study-method"[^>]*\sopen/);
 assert.ok(html.includes('期待値合計→艇番順'));assert.ok(html.includes('両者は同じ照合済みレースで比較します'));
 for(const control of ['data-study-venue','data-study-grade','data-study-date','data-study-records','data-study-more'])assert.ok(html.includes(control));
 const pending=studyHTML(experimentReport(setup(t),definition,{now:freeze+1000}));assert.ok(pending.includes('照合後に表示'));assert.ok(!pending.match(/<dt>仮想回収率<\/dt><dd>0/));
 const archived=studyHTML({...report,status:'COMPLETED',article_archived_at:new Date(end).toISOString()});assert.ok(archived.includes('検証終了・記事アーカイブ'));assert.ok(archived.includes('検証記事・全記録を読む'));assert.match(archived,/<details class="study-results" >/);
});
