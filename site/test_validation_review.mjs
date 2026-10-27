import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {buildValidationReview,summarizeValidation,dayBootstrap,VALIDATION_POLICY} from './validation-review.mjs';
import {captureProspective} from '../tools/prediction/prospective.mjs';
import {annualTriples} from './public/annual-model.mjs';
const now=Date.parse('2030-02-01T02:00Z'),date='2030-01-31',start=Date.parse(date+'T01:00Z');
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
function setup(t,{quotes=120,payout=2400}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'probability-review-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const entries=Array.from({length:6},(_,i)=>({lane:i+1,racer_id:String(4000+i),name:'選手',finish:i+1,finish_status:'NORMAL',actual_st:.13,actual_st_status:'NORMAL'}));
 const probs=annualTriples([0,0,0,0,0,0]),race={date,venue_code:'01',race_no:1,deadline_at:new Date(start+8*60000).toISOString(),model_id:'test',model_name:'テスト',model_coefficient_id:'annual-coeff-'+'a'.repeat(64),prediction_saved_at:new Date(start-1000).toISOString(),input_fetched_at:new Date(start-60000).toISOString(),history_window:{through:'2030-01-30'},entries,probabilities:probs,odds:{fetched_at:new Date(start-1).toISOString(),source_url:'https://www.boatrace.jp/owpc/pc/race/odds3t?hd=20300131&jcd=01&rno=1',items:probs.slice(0,quotes).map(p=>({combo:p.combo,odds:20}))},odds_update:{status:'OK'}};
 captureProspective([{update:{status:'OK',last_success_at:new Date(start).toISOString()},races:[race]}],dir,{now:start});
 const result={date,venue_code:'01',race_no:1,entries,source:{url:'https://www1.mbrace.or.jp/od2/K/203001/k300131.lzh',sha256:'b'.repeat(64)},settlement_status:'NORMAL'};
 if(payout!==null)result.payout={combo:'1-2-3',yen:payout,source_url:result.source.url,source_sha256:result.source.sha256};
 const writeResult=()=>{fs.mkdirSync(path.join(dir,'results'),{recursive:true});const file=path.join(dir,'results',date+'.json'),bytes=JSON.stringify([result]);fs.writeFileSync(file,bytes);fs.writeFileSync(file.replace('.json','.sha256'),hash(bytes));};writeResult();
 const file=path.join(dir,'snapshots',date,'01','R1',fs.readdirSync(path.join(dir,'snapshots',date,'01','R1'))[0]);
 const addRecord=r=>{const {integrity_sha256,id,...body}=r;body.id=hash({kind:r.kind,proposal:r.proposal});const value={...body};value.integrity_sha256=hash(value);fs.writeFileSync(path.join(path.dirname(file),value.id+'-'+hash(value.received_at).slice(0,8)+'.json'),JSON.stringify(value));return value;};
 return {dir,file,race,result,writeResult,addRecord};
}
test('uniform predictions produce known proper scores and matching EV/official-return denominators',t=>{
 const {dir,file}=setup(t),before=fs.readFileSync(file,'utf8'),report=buildValidationReview(dir,{now}),s=report.groups[0].summary;
 assert.equal(report.from,'2030-01-02');assert.equal(report.through,'2030-01-31');assert.equal(report.coverage.unique_races,1);assert.equal(s.races,1);
 assert.ok(Math.abs(s.log_loss-Math.log(120))<1e-10);assert.ok(Math.abs(s.brier-119/120)<1e-10);
 assert.equal(s.probability_bins.reduce((n,b)=>n+b.observations,0),120);assert.equal(s.probability_bins.reduce((n,b)=>n+b.hits,0),1);
 assert.equal(s.first_place_bins.reduce((n,b)=>n+b.observations,0),6);assert.equal(s.first_place_bins.reduce((n,b)=>n+b.hits,0),1);
 assert.equal(s.top10_bins.reduce((n,b)=>n+b.observations,0),1);assert.equal(s.probability_top10.stake_yen,1000);assert.equal(s.probability_top10.return_yen,2400);assert.equal(s.probability_top10.recovery_percent,240);
 assert.ok(Math.abs(s.probability_top10.expected_recovery_percent-100/6)<1e-10);
 assert.equal(s.value_bins.reduce((n,b)=>n+b.observations,0),120);assert.equal(s.uncertainty.eligible,false);assert.equal(s.uncertainty.value_roi_ci95,null);assert.equal(fs.readFileSync(file,'utf8'),before);
 assert.equal(report.inputs_sha256,buildValidationReview(dir,{now:now+1000}).inputs_sha256);
});
test('missing odds or payout do not become losses and probability evaluation keeps normal finishes',t=>{
 for(const options of [{quotes:10},{payout:null}]){const {dir}=setup(t,options),report=buildValidationReview(dir,{now}),s=report.groups[0].summary;assert.equal(s.races,1);assert.equal(s.roi_races,0);assert.equal(s.probability_top10.recovery_percent,null);assert.equal(s.value_top10.stake_yen,0);assert.equal(s.value_bins.reduce((n,b)=>n+b.observations,0),0);assert.equal(options.quotes?report.coverage.partial_odds:report.coverage.missing_payout,1);}
});
test('deduplicate before observing outcomes; separate coefficients/cohorts, reject corrupt receipt hashes',t=>{
 const {dir,file,addRecord}=setup(t),r=JSON.parse(fs.readFileSync(file));
 addRecord({...r,received_at:new Date(start+1000).toISOString()});
 let report=buildValidationReview(dir,{now});assert.equal(report.coverage.selected,1);assert.equal(report.coverage.duplicates,1);
 addRecord({...r,kind:'WORKER_FROZEN',received_at:new Date(start+9*60000).toISOString(),proposal:{...r.proposal,frozen_at:r.proposal.cutoff_at,model_coefficient_id:'annual-coeff-'+'c'.repeat(64)}});
 report=buildValidationReview(dir,{now});assert.equal(report.coverage.unique_races,1);assert.equal(report.groups.length,2);assert.ok(report.groups.every(g=>g.summary.races===1));
 const changed=JSON.parse(fs.readFileSync(file));changed.proposal.probabilities[0].probability=.99;fs.writeFileSync(file,JSON.stringify(changed));report=buildValidationReview(dir,{now});assert.equal(report.coverage.invalid,1);
});
test('pending results, F/L, mismatched racers and future history never count as misses',t=>{
 const {dir,file,result,writeResult,addRecord}=setup(t);
 fs.rmSync(path.join(dir,'results'),{recursive:true});let report=buildValidationReview(dir,{now});assert.equal(report.coverage.pending,1);assert.equal(report.groups[0].summary.races,0);
 for(const change of [()=>result.entries[5].actual_st_status='F',()=>{result.entries[5].actual_st_status='NORMAL';result.entries[0].racer_id='9999';}]){change();writeResult();report=buildValidationReview(dir,{now});assert.equal(report.coverage.excluded,1);assert.equal(report.groups[0].summary.races,0);}
 result.entries[0].racer_id='4000';writeResult();const r=JSON.parse(fs.readFileSync(file));fs.rmSync(file);addRecord({...r,proposal:{...r.proposal,history_window:{through:date}}});assert.equal(buildValidationReview(dir,{now}).coverage.excluded,1);
});
test('exclude today and future snapshots; altered saved results fail closed',t=>{
 const {dir}=setup(t);assert.equal(buildValidationReview(dir,{now:start+20*60000}).coverage.selected,0);
 fs.appendFileSync(path.join(dir,'results',date+'.json'),' ');assert.throws(()=>buildValidationReview(dir,{now}),/integrity mismatch/);
});
test('bootstrap resamples days, remains deterministic, and withholds money intervals independently',()=>{
 const probabilities=annualTriples([0,0,0,0,0,0]).map(p=>({...p,odds:20}));
 const rows=Array.from({length:2000},(_,i)=>({date:'2030-01-'+String(i%20+1).padStart(2,'0'),log_loss:2,brier:.5,roi_eligible:true,full_odds:true,actual_combo:'1-2-3',payout:2000,probabilities,probability_top10:{hit:true,predicted_hit:1/12,return_yen:1000,expected_return_yen:1000},value_top10:{hit:true,predicted_hit:1/12,return_yen:2000,expected_return_yen:1000}}));
 const interval=dayBootstrap(rows);assert.equal(interval.eligible,true);assert.deepEqual(interval.log_loss_ci95,[2,2]);assert.deepEqual(interval.value_roi_ci95,[200,200]);assert.deepEqual(interval.value_minus_probability_roi_ci95,[100,100]);assert.deepEqual(interval,dayBootstrap([...rows].reverse()));
 assert.equal(dayBootstrap(rows.slice(0,1999)).eligible,false);assert.equal(dayBootstrap(rows.map(r=>({...r,date:'2030-01-01'}))).eligible,false);
 const missing=dayBootstrap(rows.map((r,i)=>({...r,roi_eligible:i<1000})));assert.equal(missing.eligible,true);assert.equal(missing.value_roi_ci95,null);
 const one=summarizeValidation([rows[0]]);assert.equal(one.value_bins.reduce((s,b)=>s+b.races,0)>0,true);
 const clustered=dayBootstrap(rows.map(r=>({...r,value_top10:{...r.value_top10,return_yen:Number(r.date.slice(-2))<=10?0:4000}})));assert.ok(clustered.value_roi_ci95[1]-clustered.value_roi_ci95[0]>80);
 assert.equal(VALIDATION_POLICY.version,'probability-ev-v1');
});

test('coefficient versions within one receipt cohort are never pooled; outcome-independent newest snapshot wins',t=>{
 const {dir,file,result,addRecord}=setup(t),r=JSON.parse(fs.readFileSync(file));
 const other={...r,proposal:{...r.proposal,race_no:2,model_coefficient_id:'annual-coeff-'+'d'.repeat(64),odds:{...r.proposal.odds,source_url:r.proposal.odds.source_url.replace('rno=1','rno=2')}}};addRecord(other);
 const bytes=JSON.stringify([result,{...result,race_no:2}]),output=path.join(dir,'results',date+'.json');fs.writeFileSync(output,bytes);fs.writeFileSync(output.replace('.json','.sha256'),hash(bytes));
 let report=buildValidationReview(dir,{now});assert.equal(report.groups.length,2);assert.ok(report.groups.every(g=>g.summary.races===1));
 addRecord({...r,received_at:new Date(start+1000).toISOString(),proposal:{...r.proposal,proposal_saved_at:new Date(start+1).toISOString(),model_coefficient_id:other.proposal.model_coefficient_id}});
 report=buildValidationReview(dir,{now});assert.equal(report.coverage.unique_races,2);assert.equal(report.groups.length,1);assert.equal(report.groups[0].summary.races,2);
});
test('a source archive for a different date is rejected even when its saved-file digest matches',t=>{
 const {dir,result,writeResult}=setup(t);result.source.url=result.source.url.replace('k300131','k300130');writeResult();assert.equal(buildValidationReview(dir,{now}).coverage.excluded,1);
});
