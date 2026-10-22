import assert from 'node:assert/strict';import crypto from 'node:crypto';import fs from 'node:fs';
import {validateAnnualModel} from './public/annual-model.mjs';
import {validateLiveOdds} from './public/odds-live.mjs';
const date=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10),base='https://kkk-mmmm.github.io/boatrace-app-site/';
const get=async url=>{const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(20000)});assert.equal(r.status,200);return r.json();};
let report,lastError;
for(let n=0;n<18;n++){
 try{
  const model=validateAnnualModel(await get(base+'data/player-model.json'),date());
  const {id,...body}=model;assert.equal(id,'annual-v3-'+crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex'));
  const data=validateLiveOdds(await get('https://boatrace-odds.kazu80504.workers.dev/v1/odds?date='+date()),date());
  assert.equal(data.annual_model?.status,'OK',JSON.stringify(data.annual_model));assert.equal(data.annual_model.model_id,id);
  assert.equal(data.calendar?.date,date());assert.equal(data.calendar.venues.length,24);
  assert.notEqual(data.update?.status,'FAILED',data.update?.message);
  assert.ok((data.opportunities||[]).every(p=>Date.parse(p.deadline_at)>Date.now()&&Date.parse(p.deadline_at)<=Date.now()+3600000));
  const programs=data.programs||[];assert.ok(programs.every(p=>p.entries.length===6));
  const annual=programs.filter(p=>p.probabilities?.length===120&&p.model_id===id),stats=programs.filter(p=>p.entries.some(e=>e.annual_lane?.samples));
  if(programs.length)assert.ok(stats.length>0,'枠別統計の配信は更新待ちです');
  report={checked_at:new Date().toISOString(),date:data.date,model_id:id,coverage:model.coverage,validation:model.validation,
   calendar_venues:data.calendar.venues.length,held_venues:data.calendar.venues.filter(v=>v.meeting_status==='OPEN').length,
   program_count:programs.length,annual_prediction_count:annual.length,lane_statistics_programs:stats.length,
   exhibition_programs:programs.filter(p=>p.exhibition_available).length,saved_proposals:data.proposals?.length||0,update:data.update,
   examples:programs.slice(0,2).map(p=>({venue_code:p.venue_code,race_no:p.race_no,entries_fetched_at:p.entries_fetched_at,exhibition_fetched_at:p.exhibition_fetched_at,
    deadline_at:p.deadline_at,model_id:p.model_id,history_window:p.history_window,entries:p.entries.map(e=>({lane:e.lane,racer_id:e.racer_id,annual_lane:e.annual_lane}))})),
   live_prediction_verified:annual.some(p=>Date.parse(p.deadline_at)>Date.now()),note:annual.length?'年次予想の配信を確認。':'新モデルは締切3分前より前に計算できるレースから適用。締切後の予想は作り直していません。'};
  break;
 }catch(error){lastError=error;if(n<17)await new Promise(r=>setTimeout(r,15000));}
}
if(!report){console.error('::error title=Annual production verification::'+String(lastError?.message).replaceAll('\n','%0A'));process.exitCode=1;}
else{fs.writeFileSync('/tmp/annual-production.json',JSON.stringify(report,null,2)+'\n');console.log('::notice title=Annual production verification::'+JSON.stringify(report));}
