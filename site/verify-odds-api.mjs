import {branding} from './seo.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {validateLiveOdds,ODDS_MAX_AGE_MS} from './public/odds-live.mjs';

const api='https://boatrace-odds.kazu80504.workers.dev/v1/odds';
const observe=process.env.ODDS_OBSERVE_UPDATE==='true';
const output=process.env.SITE_VERIFY_OUTPUT || '/tmp/boatrace-odds-check';
const date=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const started=Date.now();let baseline=null,idleBaseline=null,lastState=null,verified=false;
try {
  while(Date.now()-started<12*60000) {
    const url=new URL(api);url.searchParams.set('date',date());
    const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(20000),headers:{Origin:new URL(branding.base_url).origin}});
    assert.equal(response.status,200,'WorkerのHTTP応答');
    assert.equal(response.headers.get('access-control-allow-origin'),new URL(branding.base_url).origin,'Pages向けCORS');
    const data=validateLiveOdds(await response.json(),date()),now=Date.now();
    const records=data.races.filter(r=>r.status==='OK' && r.items.length && Number.isFinite(Date.parse(r.fetched_at))
      && Date.parse(r.fetched_at)<=now+60000 && now-Date.parse(r.fetched_at)<=ODDS_MAX_AGE_MS && Date.parse(r.deadline_at)>now+60000);
    const state=JSON.stringify({update:data.update,statuses:data.races.reduce((counts,r)=>(counts[r.status]=(counts[r.status] || 0)+1,counts),{}),live:records.length});
    if(state!==lastState){console.log('::notice title=Cloudflare odds status::'+state);lastState=state;}
    if(data.update.status==='FAILED')throw Error(data.update.message || 'Cloudflareの定期取得が失敗しました');
    if(data.update.status==='COMPLETE' && data.races.length && data.races.every(r=>r.status==='FAILED'))
      throw Error('全レースの取得に失敗: '+data.races.slice(0,3).map(r=>r.message).join(' / '));
    // After racing ends, verify the scheduler separately. This is not proof
    // of a real race's acquisition interval and must be reported as such.
    if(!records.length && !data.races.length && data.update.status==='IDLE') {
      const cycle=Date.parse(data.update.started_at);
      if(Number.isFinite(cycle) && !idleBaseline)idleBaseline=cycle;
      const gap=cycle-idleBaseline;
      if(!observe || Number.isFinite(cycle) && gap>=60000 && gap<=120000) {
        const report={checked_at:new Date().toISOString(),api_url:api,date:data.date,interval_seconds:data.interval_seconds,
          mode:'IDLE_SCHEDULER',update:data.update,record_count:0,live_records:0,saved_proposals:data.proposals?.length || 0,
          repeated_scheduler_observed:!!observe,scheduler_interval_seconds:observe?gap/1000:null,
          live_race_interval_verified:false,reason:'締切前の取得対象がないため定期処理のみ確認。実レースの1分取得間隔は未計測。'};
        fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'odds-api.json'),JSON.stringify(report,null,2)+'\n');
        console.log('::notice title=Cloudflare odds verification::'+JSON.stringify(report));verified=true;break;
      }
      if(gap>120000)idleBaseline=cycle;
    }
    if(records.length && !baseline) {
      baseline={started_at:data.update.started_at,records:new Map(records.map(r=>[`${r.venue_code}-${r.race_no}`,r]))};
    }
    const changed=baseline && records.filter(r=>{
      const before=baseline.records.get(`${r.venue_code}-${r.race_no}`);
      const interval=before && Date.parse(r.attempted_at)-Date.parse(before.attempted_at);
      return before && Date.parse(r.fetched_at)>Date.parse(before.fetched_at) && interval>=(data.interval_seconds===60?60000:300000) && interval<=(data.interval_seconds===60?120000:420000);
    });
    // Start a fresh measurement after a long gap; do not accept ten-minute updates.
    if(observe && baseline)for(const record of records) {
      const key=`${record.venue_code}-${record.race_no}`,before=baseline.records.get(key);
      if(!before || Date.parse(record.attempted_at)-Date.parse(before.attempted_at)>(data.interval_seconds===60?120000:420000))baseline.records.set(key,record);
    }
    if(records.length && (!observe || changed.length)) {
      const selected=(observe?changed:records).sort((a,b)=>Date.parse(b.deadline_at)-Date.parse(a.deadline_at))[0];
      const report={checked_at:new Date().toISOString(),api_url:api,date:data.date,interval_seconds:data.interval_seconds,update:data.update,
        record_count:data.races.length,live_records:records.length,failed_records:data.races.filter(r=>r.status==='FAILED').length,
        live_venues:[...new Set(records.map(r=>r.venue_code))],opportunities:data.opportunities?.length || 0,
        selected:{venue_code:selected.venue_code,race_no:selected.race_no,quotes:selected.items.length,fetched_at:selected.fetched_at,
          attempted_at:selected.attempted_at,deadline_at:selected.deadline_at},
        repeated_update_observed:!!(observe && changed.length),
        previous_attempted_at:observe?baseline.records.get(`${selected.venue_code}-${selected.race_no}`).attempted_at:null,
        attempt_interval_seconds:observe?(Date.parse(selected.attempted_at)-Date.parse(baseline.records.get(`${selected.venue_code}-${selected.race_no}`).attempted_at))/1000:null};
      fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'odds-api.json'),JSON.stringify(report,null,2)+'\n');
      console.log('::notice title=Cloudflare odds verification::'+JSON.stringify(report));verified=true;break;
    }
    await new Promise(resolve=>setTimeout(resolve,20000));
  }
  assert.ok(verified,'制限時間内に締切前の最新オッズと必要な更新を確認できませんでした');
} catch(error) {
  const message=String(error.stack || error).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');
  console.error('::error title=Cloudflare odds verification::'+message);process.exitCode=1;
}
