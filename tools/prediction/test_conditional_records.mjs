import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {captureProspective} from './prospective.mjs';import {proposalCandidate} from '../../site/public/odds-live.mjs';
import {captureConditionalRecords,conditionalReport,runConditionalRecords,conditionalSelection} from './conditional_records.mjs';
const now=Date.parse('2030-01-01T01:00Z'),freeze=now+5*60000,date='2030-01-01';
const definition={...JSON.parse(fs.readFileSync(new URL('../../site/conditional-strategies.json',import.meta.url))),registered_at:new Date(now-60000).toISOString()};
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'conditional-records-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function fixture(race_no=1,coefficient='a'){
 const probabilities=[];for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)if(new Set([a,b,c]).size===3)probabilities.push({combo:`${a}-${b}-${c}`,probability:a===1?.02:a===2?.01:.005,rank:probabilities.length+1});
 const entries=Array.from({length:6},(_,i)=>({lane:i+1,racer_id:String(4000+i),name:'選手'}));
 const target={date,venue_code:'01',race_no,deadline_at:new Date(now+8*60000).toISOString(),model_id:'test',model_coefficient_id:'annual-coeff-'+coefficient.repeat(64),prediction_saved_at:new Date(now-1000).toISOString(),input_fetched_at:new Date(now-30000).toISOString(),prediction_key:'test:'+new Date(now-1000).toISOString(),entries,probabilities,update_status:'OK',last_success_at:new Date(now-1000).toISOString()};
 const quote={...target,status:'OK',items:probabilities.map(x=>({combo:x.combo,odds:100})),fetched_at:new Date(now-1).toISOString(),source_url:`https://www.boatrace.jp/owpc/pc/race/odds3t?hd=20300101&jcd=01&rno=${race_no}`};
 return {date,venue_code:'01',races:[{...target,proposal_snapshot:{...proposalCandidate(target,quote,now),frozen_at:new Date(freeze).toISOString()}}]};
}
const root=dir=>path.join(dir,'conditional-strategies/conditional-v1');
const predictionFile=dir=>path.join(root(dir),'predictions/2030-01-01/01/R1.json');
function setup(t){const dir=temp(t);runConditionalRecords(dir,definition,{now:now-2000});captureProspective([fixture()],dir,{now:freeze+1000});runConditionalRecords(dir,definition,{now:freeze+1000});return dir;}
function results(dir,{payout=5000,flying=false}={}){
 const source={url:'https://www1.mbrace.or.jp/od2/K/203001/k300101.lzh',sha256:'a'.repeat(64)},s=fixture().races[0],r={date,venue_code:'01',race_no:1,source,entries:s.entries.map((e,i)=>({...e,finish:i+1,finish_status:'NORMAL',actual_st:.15,actual_st_status:flying?'F':'NORMAL'}))};
 if(payout!==null)r.payout={combo:'1-2-3',yen:payout,source_url:source.url,source_sha256:source.sha256};
 fs.mkdirSync(path.join(dir,'results'),{recursive:true});const bytes=JSON.stringify([r]);fs.writeFileSync(path.join(dir,'results',date+'.json'),bytes);fs.writeFileSync(path.join(dir,'results',date+'.sha256'),hash(bytes));
}
const condition=(review,id='return_10_in_under_0.5',scenario='all')=>review.groups[0].conditions.find(c=>c.id===id&&c.scenario===scenario);
test('22条件×3傾向を固定保存し、条件外・未照合を損失にせず10/20点の実払戻を照合',t=>{
 const dir=setup(t),before=fs.readFileSync(predictionFile(dir),'utf8'),saved=JSON.parse(before);
 assert.equal(saved.conditions.length,66);assert.equal(new Set(saved.conditions.map(c=>c.id+'/'+c.scenario)).size,66);assert.equal(saved.first_probabilities.length,6);
 const pending=conditionalReport(dir,definition,{now:freeze+1000});assert.equal(condition(pending).pending,1);assert.equal(condition(pending).stake_yen,0);assert.equal(condition(pending).recovery_percent,null);
 assert.equal(condition(pending,'return_10_lane_3_0.2_head').no_bet,1);assert.equal(condition(pending,'return_10_lane_3_0.2_head').pending,0);
 const selected=saved.conditions.find(c=>c.id==='return_10_lane_2_0.2_head'&&c.scenario==='other');assert.ok(selected.combos.every(c=>c.startsWith('2-')));assert.ok(selected.combos.length);
 results(dir);runConditionalRecords(dir,definition,{now:now+86400000});const settled=conditionalReport(dir,definition,{now:now+86400000}),ten=condition(settled),twenty=condition(settled,'return_20_in_under_0.5');
 assert.deepEqual([ten.settled_races,ten.hits,ten.tickets,ten.stake_yen,ten.return_yen,ten.recovery_percent],[1,1,10,1000,5000,500]);
 assert.deepEqual([twenty.hits,twenty.tickets,twenty.stake_yen,twenty.return_yen,twenty.recovery_percent],[1,20,2000,5000,250]);assert.equal(fs.readFileSync(predictionFile(dir),'utf8'),before);
 const report=path.join(dir,'reports/conditional-v1.json'),reportBefore=fs.readFileSync(report,'utf8');assert.equal(runConditionalRecords(dir,definition,{now:now+40*86400000}).report_changed,false);assert.equal(fs.readFileSync(report,'utf8'),reportBefore);assert.equal(fs.readFileSync(predictionFile(dir),'utf8'),before);
 assert.ok(fs.existsSync(path.join(root(dir),'reviews',date+'.json')));
});
test('登録前の過去予想を後付けせず、再実行で固定買い目を変えず、係数版を分離する',t=>{
 const late=temp(t);captureProspective([fixture()],late,{now:freeze+1000});const skipped=runConditionalRecords(late,definition,{now:freeze+2000});assert.equal(skipped.records,0);assert.equal(skipped.skipped,1);
 const dir=setup(t);assert.equal(captureConditionalRecords(dir,definition,{now:freeze+2000}).existing,1);
 captureProspective([fixture(2,'b')],dir,{now:freeze+2000});runConditionalRecords(dir,definition,{now:freeze+3000});assert.equal(conditionalReport(dir,definition,{now:freeze+4000}).groups.length,2);
 const changed={...definition,registered_at:new Date(now-50000).toISOString()};assert.throws(()=>runConditionalRecords(dir,changed,{now:freeze+4000}),/上書き/);
});
test('払戻欠損・Fは回収率へ入れず、条件買い目や元予想の改変を検出する',t=>{
 const dir=setup(t);results(dir,{payout:null});let r=conditionalReport(dir,definition,{now:now+86400000});assert.equal(condition(r).pending,1);assert.equal(condition(r).stake_yen,0);assert.equal(condition(r).recovery_percent,null);
 results(dir,{flying:true});r=conditionalReport(dir,definition,{now:now+86400000});assert.equal(condition(r).excluded,1);assert.equal(condition(r).stake_yen,0);
 results(dir);const rf=path.join(dir,'results',date+'.json'),bad=JSON.parse(fs.readFileSync(rf));bad[0].source.url='https://www1.mbrace.or.jp/od2/K/203001/k300102.lzh';bad[0].payout.source_url=bad[0].source.url;const bytes=JSON.stringify(bad);fs.writeFileSync(rf,bytes);fs.writeFileSync(rf.replace('.json','.sha256'),hash(bytes));
 assert.equal(condition(conditionalReport(dir,definition,{now:now+86400000})).excluded,1);results(dir);
 const f=predictionFile(dir),original=fs.readFileSync(f,'utf8'),changed=JSON.parse(original);changed.conditions[0].combos=['6-5-4'];fs.writeFileSync(f,JSON.stringify(changed));assert.throws(()=>conditionalReport(dir,definition,{now:now+86400000}),/変更/);fs.writeFileSync(f,original);
 const saved=JSON.parse(original),sfile=path.join(dir,'snapshots',date,'01','R1',saved.source_snapshot_id+'.json'),source=JSON.parse(fs.readFileSync(sfile));
 assert.throws(()=>conditionalSelection(source,definition,{now:freeze+1000,activatedAt:new Date(now+1000).toISOString()}),/有効化前/);
 source.proposal.probabilities[0].probability=.9;fs.writeFileSync(sfile,JSON.stringify(source));assert.throws(()=>conditionalReport(dir,definition,{now:now+86400000}),/変更/);
});
