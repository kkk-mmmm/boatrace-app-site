// Observational evaluation of immutable, pre-result forecasts. Never fits or promotes a model.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {validateRecord} from '../tools/prediction/prospective.mjs';
import {verifiedResults,archiveResult} from './public-verification.mjs';
import {validResult} from './public/odds-live.mjs';
import {predictionRanking} from './public/view.mjs';
export const VALIDATION_POLICY=Object.freeze({version:'probability-ev-v1',introduced_on:'2026-10-27',evidence_type:'OBSERVATIONAL_SAVED_FORECAST_AUDIT',days:30,minimum_races:2000,minimum_days:20,bootstrap_samples:1000,seed:20261027,probability_edges:[0,.005,.01,.02,.05,.1,.2,.5,1],value_edges:[0,.5,.8,1,1.2,1.5,2,5,null]});
const walk=d=>!fs.existsSync(d)?[]:fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):e.isFile()&&e.name.endsWith('.json')?[path.join(d,e.name)]:[]);
const day=n=>new Date(n+9*3600000).toISOString().slice(0,10),key=p=>`${p.date}/${p.venue_code}/${p.race_no}`;
const average=(a,k)=>a.length?a.reduce((s,r)=>s+r[k],0)/a.length:null;
const bins=edges=>edges.slice(0,-1).map((from,i)=>({from,to:edges[i+1],observations:0,races:0,probability_sum:0,hits:0,expected_return_sum:0,return_yen:0}));
const binIndex=(edges,n)=>{const index=edges.findIndex((x,i)=>i<edges.length-1&&n>=x&&(edges[i+1]===null||n<edges[i+1]||i===edges.length-2&&n===edges[i+1]));return index<0?edges.length-2:index;};
function addBin(target,i,p,hit,ev,payout,touched){const b=target[i];b.observations++;b.probability_sum+=p;b.hits+=hit;b.expected_return_sum+=ev;b.return_yen+=hit*payout;touched.add(i);}
const closeBins=(list,money=false)=>list.map(({expected_return_sum,return_yen,...b})=>({...b,mean_probability:b.observations?b.probability_sum/b.observations:null,actual_frequency:b.observations?b.hits/b.observations:null,...(money?{expected_return_sum,return_yen,expected_recovery_percent:b.observations?expected_return_sum/b.observations*100:null,recovery_percent:b.observations?return_yen/(b.observations*100)*100:null}:{})}));
function strategy(list,type){const stake=list.length*1000,returned=list.reduce((s,r)=>s+r[type].return_yen,0),expected=list.reduce((s,r)=>s+r[type].expected_return_yen,0),hits=list.reduce((s,r)=>s+r[type].hit,0);return {races:list.length,hits,stake_yen:stake,return_yen:returned,expected_return_yen:expected,hit_rate:list.length?hits/list.length:null,predicted_hit_rate:list.length?list.reduce((s,r)=>s+r[type].predicted_hit,0)/list.length:null,recovery_percent:stake?returned/stake*100:null,expected_recovery_percent:stake?expected/stake*100:null};}
function compactSummary(rows){const monetary=rows.filter(r=>r.roi_eligible);return {races:rows.length,days:new Set(rows.map(r=>r.date)).size,log_loss:average(rows,'log_loss'),brier:average(rows,'brier'),complete_odds_races:rows.filter(r=>r.full_odds).length,roi_races:monetary.length,probability_top10:strategy(monetary,'probability_top10'),value_top10:strategy(monetary,'value_top10')};}
export function summarizeValidation(rows){
 const summary=compactSummary(rows),prob=bins(VALIDATION_POLICY.probability_edges),value=bins(VALIDATION_POLICY.value_edges),lane=bins([0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1]),coverage=bins([0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1]);
 for(const r of rows){
  const touched=new Set(),evTouched=new Set(),laneTouched=new Set();
  const laneProbability=Array(6).fill(0);
  for(const p of r.probabilities){const hit=Number(p.combo===r.actual_combo);laneProbability[Number(p.combo[0])-1]+=p.probability;addBin(prob,binIndex(VALIDATION_POLICY.probability_edges,p.probability),p.probability,hit,0,0,touched);
   if(r.roi_eligible)addBin(value,binIndex(VALIDATION_POLICY.value_edges,p.probability*p.odds),p.probability,hit,p.probability*p.odds,r.payout,evTouched);
  }
  for(let i=0;i<6;i++)addBin(lane,binIndex([0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1],laneProbability[i]),laneProbability[i],Number(i+1===Number(r.actual_combo[0])),0,0,laneTouched);
  const top=r.probability_top10;const ci=binIndex([0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1],top.predicted_hit);addBin(coverage,ci,top.predicted_hit,Number(top.hit),0,0,new Set());coverage[ci].races++;
  for(const i of touched)prob[i].races++;for(const i of evTouched)value[i].races++;for(const i of laneTouched)lane[i].races++;
 }
 return {...summary,uniform_reference:{log_loss:Math.log(120),brier:119/120},probability_bins:closeBins(prob),first_place_bins:closeBins(lane),top10_bins:closeBins(coverage),value_bins:closeBins(value,true),uncertainty:dayBootstrap(rows)};
}
export function dayBootstrap(rows){
 const byDay=new Map();for(const r of rows){if(!byDay.has(r.date))byDay.set(r.date,[]);byDay.get(r.date).push(r);}
 const days=[...byDay.keys()].sort(),complete=rows.filter(r=>r.roi_eligible),eligible=rows.length>=VALIDATION_POLICY.minimum_races&&days.length>=VALIDATION_POLICY.minimum_days;
 const base={method:'PAIRED_DAY_BLOCK_PERCENTILE',level:.95,samples:VALIDATION_POLICY.bootstrap_samples,eligible,reason:eligible?null:'2,000レース・20完了日以上を蓄積するまで区間推定を保留',log_loss_ci95:null,brier_ci95:null,value_roi_ci95:null,value_minus_probability_roi_ci95:null,top10_probability_gap_ci95:null,value_expected_gap_ci95:null};
 if(!eligible)return base;
 const daily=days.map(d=>{const list=byDay.get(d),money=list.filter(r=>r.roi_eligible);return {n:list.length,loss:list.reduce((s,r)=>s+r.log_loss,0),brier:list.reduce((s,r)=>s+r.brier,0),money:money.length,value:money.reduce((s,r)=>s+r.value_top10.return_yen,0),probability:money.reduce((s,r)=>s+r.probability_top10.return_yen,0),expected:money.reduce((s,r)=>s+r.value_top10.expected_return_yen,0),calibration:list.reduce((s,r)=>s+Number(r.probability_top10.hit)-r.probability_top10.predicted_hit,0)};});
 let seed=VALIDATION_POLICY.seed;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},loss=[],brier=[],roi=[],delta=[],calibration=[],expectedGap=[];
 for(let b=0;b<VALIDATION_POLICY.bootstrap_samples;b++){let n=0,l=0,br=0,stake=0,v=0,p=0,ex=0,cal=0;for(let i=0;i<daily.length;i++){const d=daily[Math.floor(random()*daily.length)];n+=d.n;l+=d.loss;br+=d.brier;stake+=d.money*1000;v+=d.value;p+=d.probability;ex+=d.expected;cal+=d.calibration;}loss.push(l/n);brier.push(br/n);calibration.push(cal/n*100);if(stake){roi.push(v/stake*100);delta.push((v-p)/stake*100);expectedGap.push((v-ex)/stake*100);}}
 const interval=a=>{a.sort((a,b)=>a-b);return a.length?[a[Math.floor((a.length-1)*.025)],a[Math.ceil((a.length-1)*.975)]]:null;};
 const moneyEligible=complete.length>=VALIDATION_POLICY.minimum_races&&new Set(complete.map(r=>r.date)).size>=VALIDATION_POLICY.minimum_days;
 return {...base,log_loss_ci95:interval(loss),brier_ci95:interval(brier),value_roi_ci95:moneyEligible?interval(roi):null,value_minus_probability_roi_ci95:moneyEligible?interval(delta):null,top10_probability_gap_ci95:interval(calibration),value_expected_gap_ci95:moneyEligible?interval(expectedGap):null,roi_reason:moneyEligible?null:'完全オッズの件数・日数が不足しています'};
}
function scoredRow(record,settled){
 const p=record.proposal,quote=new Map(p.odds.items.map(o=>[o.combo,o.odds])),probabilities=p.probabilities.map(x=>({...x,odds:quote.get(x.combo)??null})),actual=settled.actual_combo;
 const ordered=predictionRanking(probabilities,p.odds.items,{tab:'probability',currentOdds:true});
 const values=predictionRanking(probabilities,p.odds.items,{tab:'value',currentOdds:true});
 const strategy=a=>{const selected=a.slice(0,10);return {hit:selected.some(p=>p.combo===actual),predicted_hit:selected.reduce((s,p)=>s+p.probability,0),return_yen:settled.payout_yen_per_100===null?null:selected.some(p=>p.combo===actual)?settled.payout_yen_per_100:0,expected_return_yen:selected.every(p=>p.odds!==null)?selected.reduce((s,p)=>s+p.probability*p.odds*100,0):null};};
 return {date:p.date,venue_code:p.venue_code,grade:p.context?.grade||'未確認',actual_combo:actual,payout:settled.payout_yen_per_100,probabilities,full_odds:quote.size===120,roi_eligible:quote.size===120&&settled.payout_yen_per_100!==null,log_loss:-Math.log(probabilities.find(p=>p.combo===actual).probability),brier:probabilities.reduce((s,p)=>s+(p.probability-Number(p.combo===actual))**2,0),probability_top10:strategy(ordered),value_top10:strategy(values)};
}
function probabilityOutcome(p,r,now){
 if(!r||r.status!=='CONFIRMED')return {status:'MISSING_RESULT'};
 if(r.source_conflict)return {status:'EXCLUDED'};
 const compact=p.date.replaceAll('-',''),archive=r.kind==='OFFICIAL_ARCHIVE'&&r.source_url===`https://www1.mbrace.or.jp/od2/K/${compact.slice(0,6)}/k${compact.slice(2)}.lzh`&&/^[a-f0-9]{64}$/.test(r.source_sha256||'');
 if(!archive&&!validResult(r,r.date,now))return {status:'EXCLUDED'};
 const identity=entries=>entries?.length===6&&new Set(entries.map(e=>e.lane)).size===6&&new Set(entries.map(e=>e.racer_id)).size===6&&entries.every(e=>Number.isInteger(e.lane)&&e.lane>=1&&e.lane<=6&&/^\d{4}$/.test(e.racer_id));
 if(key(p)!==key(r)||p.deadline_at!==r.deadline_at||!identity(p.entries)||!identity(r.entries)||p.entries.some(e=>!r.entries.some(a=>a.lane===e.lane&&a.racer_id===e.racer_id))||p.history_window?.through!==undefined&&(typeof p.history_window.through!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.history_window.through)||p.history_window.through>=p.date)||r.settlement_status&&r.settlement_status!=='NORMAL')return {status:'EXCLUDED'};
 const order=[...r.entries].sort((a,b)=>a.finish-b.finish);
 if(!order.every((e,i)=>e.finish===i+1&&(!e.finish_status||e.finish_status==='NORMAL'||String(e.finish_status)===String(e.finish))&&Number.isFinite(e.st)&&e.st>=0&&e.st_status==='NORMAL'))return {status:'EXCLUDED'};
 const actual_combo=order.slice(0,3).map(e=>e.lane).join('-'),payouts=r.payouts||[];
 if(payouts.length>1||payouts.length===1&&(payouts[0].combo!==actual_combo||!Number.isSafeInteger(payouts[0].payout_yen_per_100)||payouts[0].payout_yen_per_100<=0))return {status:'EXCLUDED'};
 return {status:'SETTLED',actual_combo,payout_yen_per_100:payouts[0]?.payout_yen_per_100??null};
}
export function validationObservations(directory,{now=Date.now()}={}){
 const through=day(now-86400000),from=day(now-VALIDATION_POLICY.days*86400000),selected=new Map(),coverage={snapshot_files:0,invalid:0,duplicates:0,selected:0,settled:0,pending:0,excluded:0,partial_odds:0,missing_payout:0},groups=new Map();
 const root=path.join(directory,'snapshots');
 for(const date of !fs.existsSync(root)?[]:fs.readdirSync(root).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>=from&&d<=through))for(const f of walk(path.join(root,date))){coverage.snapshot_files++;try{
  const r=validateRecord(JSON.parse(fs.readFileSync(f)),now),p=r.proposal;if(p.date!==date)throw Error('Snapshot date mismatch');
  const cohort=r.kind==='COLLECTOR_PRERACE'?'RECEIPT_BEFORE_CUTOFF':'WORKER_REPORTED_ONLY',k=`${key(p)}/${cohort}`,old=selected.get(k);
  if(old)coverage.duplicates++;
  if(!old||Date.parse(p.proposal_saved_at)>Date.parse(old.proposal.proposal_saved_at)||Date.parse(p.proposal_saved_at)===Date.parse(old.proposal.proposal_saved_at)&&(Date.parse(r.received_at)<Date.parse(old.received_at)||Date.parse(r.received_at)===Date.parse(old.received_at)&&r.id<old.id))selected.set(k,r);
 }catch{coverage.invalid++;}}
 const results=verifiedResults(directory,{from,through,now});
 for(const [k,record] of [...selected].sort(([a],[b])=>a.localeCompare(b))){
  coverage.selected++;const p=record.proposal,cohort=k.endsWith('/RECEIPT_BEFORE_CUTOFF')?'RECEIPT_BEFORE_CUTOFF':'WORKER_REPORTED_ONLY',coefficient=/^annual-coeff-[a-f0-9]{64}$/.test(p.model_coefficient_id||'')?p.model_coefficient_id:`UNKNOWN:${p.model_id}`,id=`${cohort}/${coefficient}`;
  if(!groups.has(id))groups.set(id,{id,cohort,coefficient_id:coefficient,model_name:p.model_name||p.model_id,last_observed_date:p.date,selected:0,pending:0,excluded:0,rows:[]});
  const g=groups.get(id);g.selected++;if(p.date>g.last_observed_date)g.last_observed_date=p.date;const result=results.get(key(p));const settled=probabilityOutcome(p,result?archiveResult(result,p):null,now);
  if(settled?.status==='SETTLED'){const row=scoredRow(record,settled);g.rows.push(row);coverage.settled++;if(!row.full_odds)coverage.partial_odds++;if(row.payout===null)coverage.missing_payout++;}
  else if(settled?.status==='MISSING_RESULT'){coverage.pending++;g.pending++;}else{coverage.excluded++;g.excluded++;}
 }
 return {schema_version:1,kind:'PRIVATE_VALIDATION_OBSERVATIONS',inputs_sha256:crypto.createHash('sha256').update(JSON.stringify([VALIDATION_POLICY,[...selected.values()].map(r=>[r.id,r.integrity_sha256,results.get(key(r.proposal))||null])])).digest('hex'),generated_at:new Date(now).toISOString(),from,through,policy:VALIDATION_POLICY,coverage:{...coverage,unique_races:new Set([...selected.values()].map(r=>key(r.proposal))).size},groups:[...groups.values()]};
}
export function buildValidationReview(directory,options={}){
 const observations=validationObservations(directory,options);
 return {...observations,kind:'PROBABILITY_EV_VALIDATION',groups:observations.groups.map(({rows,...g})=>({...g,summary:summarizeValidation(rows),by_venue:[...new Set(rows.map(r=>r.venue_code))].sort().map(label=>({label,...compactSummary(rows.filter(r=>r.venue_code===label))})),by_grade:[...new Set(rows.map(r=>r.grade))].sort().map(label=>({label,...compactSummary(rows.filter(r=>r.grade===label))}))})).sort((a,b)=>Number(a.cohort!=='RECEIPT_BEFORE_CUTOFF')-Number(b.cohort!=='RECEIPT_BEFORE_CUTOFF')||Number(a.coefficient_id.startsWith('UNKNOWN:'))-Number(b.coefficient_id.startsWith('UNKNOWN:'))||b.last_observed_date.localeCompare(a.last_observed_date)||b.summary.races-a.summary.races||a.id.localeCompare(b.id)),limitations:['当日を除く直近30完了日。保存予想のあるレースだけの観測で、全開催レースを網羅する保証はありません。','受信で締切前保存を確認できる記録とWorkerの自己申告時刻に依存する記録、係数版は混ぜません。','払戻未取得でも正常着順は確率検証に使い、払戻が確認できるまで回収率には使いません。','期待値検証は全120通りの保存オッズがある正常レースのみ。同じレースで確率上位10点と期待値上位10点を各100円で仮想比較します。','確率帯・期待値帯は方式v1で固定。既存記録の初回集計は観測的な監査で、未知期間の確認的試験ではありません。120買い目を独立した120レースとは扱いません。区間は日ごとに再標本化する参考値です。日をまたぐ依存や市場の変化を完全に補正せず、将来の収益の保証や有効性判定ではありません。','対数損失・Brierは小さいほど良い指標。一様確率は最低限の参考であり、オッズ市場や他モデルより優れることを意味しません。','検証画面から係数の再学習・自動採用は行いません。複数の条件別比較は探索的で、後から良い条件だけ選ばないでください。']};
}
