import {fetchText,officialUrl,robotsAllowed,parseOfficialHtml,OFFICIAL_ORIGIN} from './official.mjs';
import {ODDS_INTERVAL_MS,ODDS_MAX_AGE_MS,oddsKey,rankExpectedValue,validQuotes,proposalCandidate,validProposal,oddsRefreshInterval,FAR_ODDS_INTERVAL_MS} from '../../site/public/odds-live.mjs';

const japanDate=now=>new Date(now+9*3600000).toISOString().slice(0,10);
const json=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const stub=env=>env.ODDS.get(env.ODDS.idFromName('all-venues-v1'));
const iso=now=>new Date(now).toISOString();
export const BATCH_SIZE=24; // Each alarm stays below the Free plan's 50 external subrequests.

export function validateTargets(feed, now) {
  if(feed?.schema_version!==1 || feed.date!==japanDate(now) || !Array.isArray(feed.races) || feed.races.length>288
    || !Number.isFinite(Date.parse(feed.generated_at)) || japanDate(Date.parse(feed.generated_at))!==feed.date || Date.parse(feed.generated_at)>now+60000
    || new Set(feed.races.map(oddsKey)).size!==feed.races.length)throw Error('当日の取得対象を確認できません');
  for(const race of feed.races) {
    if(race.date!==feed.date || !/^(0[1-9]|1\d|2[0-4])$/.test(race.venue_code)
      || !Number.isInteger(race.race_no) || race.race_no<1 || race.race_no>12
      || !Number.isFinite(Date.parse(race.deadline_at)) || japanDate(Date.parse(race.deadline_at)-1)!==feed.date
      || !Array.isArray(race.probabilities))throw Error('取得対象の場・日付・レースが不正です');
    if(race.probabilities.length && (race.probabilities.length!==120 || !validQuotes(race.probabilities.map(x=>({...x,odds:1})))
      || race.probabilities.some(x=>!Number.isInteger(x.rank) || x.rank<1 || x.rank>120 || !Number.isFinite(x.probability) || x.probability<=0 || x.probability>1)
      || Math.abs(race.probabilities.reduce((sum,x)=>sum+x.probability,0)-1)>1e-6))throw Error('120通りの確率が不正です');
  }
  return feed.races.filter(race=>Date.parse(race.deadline_at)>now);
}

export function opportunityRows(targets, records, now) {
  const rows=[];
  for(const target of targets) {
    const record=records.get(oddsKey(target));
    if(!record || record.status!=='OK' || record.date!==japanDate(now) || Date.parse(record.deadline_at)<=now
      || now-Date.parse(record.fetched_at)>ODDS_MAX_AGE_MS || Date.parse(record.fetched_at)>now+60000
      || record.prediction_key!==target.prediction_key || !['OK','PARTIAL'].includes(target.update_status)
      || !Number.isFinite(Date.parse(target.last_success_at)) || now-Date.parse(target.last_success_at)>ODDS_MAX_AGE_MS
      || Date.parse(target.last_success_at)>now+60000 || target.issue)continue;
    const best=rankExpectedValue(target.probabilities,record.items)[0];
    if(best?.value>1)rows.push({...best,date:target.date,venue_code:target.venue_code,venue:target.venue,race_no:target.race_no,
      deadline_at:target.deadline_at,model_name:target.model_name,prediction_key:target.prediction_key,
      fetched_at:record.fetched_at,recorded_at:record.fetched_at,classification:'PRERACE_ODDS_LOCAL_RECORD_UNVERIFIED',
      update_status:target.update_status,last_success_at:target.last_success_at});
  }
  return rows.sort((a,b)=>b.value-a.value || a.deadline_at.localeCompare(b.deadline_at) || a.venue_code.localeCompare(b.venue_code)).slice(0,6);
}

export default {
  async scheduled(event,env,ctx) {
    ctx.waitUntil((async()=>{
      const response=await stub(env).fetch('https://internal/start',{method:'POST',body:JSON.stringify({scheduled_at:event.scheduledTime})});
      if(!response.ok)throw Error('定期更新の開始に失敗: '+await response.text());
    })());
  },
  async fetch(request,env) {
    const url=new URL(request.url),origin=request.headers.get('Origin');
    const cors={'Access-Control-Allow-Origin':env.SITE_ORIGIN,'Vary':'Origin','Access-Control-Allow-Methods':'GET, OPTIONS'};
    if(origin && origin!==env.SITE_ORIGIN)return json({error:'許可されていないオリジンです'},403);
    if(url.pathname!=='/v1/odds')return json({error:'Not found'},404,cors);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    if(request.method!=='GET')return json({error:'Method not allowed'},405,{...cors,Allow:'GET, OPTIONS'});
    if([...url.searchParams.keys()].some(key=>!['date','venue','race'].includes(key))
      || [...new Set(url.searchParams.keys())].some(key=>url.searchParams.getAll(key).length!==1))return json({error:'不正なパラメーターです'},400,cors);
    const date=url.searchParams.get('date'),venue=url.searchParams.get('venue'),race=url.searchParams.get('race');
    if(date!==japanDate(Date.now()) || venue && !/^(0[1-9]|1\d|2[0-4])$/.test(venue)
      || race && (!venue || !/^(?:[1-9]|1[0-2])$/.test(race)))return json({error:'当日の場・レースを指定してください'},400,cors);
    try {
      const result=await stub(env).fetch('https://internal/snapshot'+url.search);
      const headers=new Headers(result.headers);for(const [key,value] of Object.entries(cors))headers.set(key,value);
      return new Response(result.body,{status:result.status,headers});
    } catch {return json({error:'オッズの共有記録を取得できません'},503,cors);}
  }
};

export class OddsCoordinator {
  constructor(ctx,env) {this.ctx=ctx;this.env=env;this.serial=Promise.resolve();}
  exclusive(fn) {const next=this.serial.then(fn);this.serial=next.catch(()=>{});return next;}
  async fetch(request) {
    const url=new URL(request.url);
    if(url.pathname==='/start' && request.method==='POST') {
      const input=await request.json().catch(()=>({}));
      return this.exclusive(()=>this.start(input.scheduled_at));
    }
    if(url.pathname==='/snapshot' && request.method==='GET')return this.snapshot(url);
    return json({error:'Not found'},404);
  }
  async start(scheduledAt=Date.now()) {
    const now=Date.now(),date=japanDate(now),storage=this.ctx.storage;
    if(!Number.isFinite(scheduledAt))return json({error:'定期実行の時刻が不正です'},400);
    const slot=Math.floor(scheduledAt/ODDS_INTERVAL_MS);
    let work=await storage.get('work');
    if(work?.running && now-work.started_ms<15*60000)return json({status:'ALREADY_RUNNING'},202);
    const previousSlot=work?.scheduled_slot ?? Math.floor(work?.started_ms/ODDS_INTERVAL_MS);
    if(work?.date===date && slot<=previousSlot)return json({status:'NOT_DUE'},202);
    try {
      if(work?.date===date)await this.freezeDue(now);
      const feed=JSON.parse(await fetchText(this.env.TARGETS_URL,fetch,5*1024*1024));
      const targets=validateTargets(feed,now);
      const cachedRobots=await storage.get('robots'),reuseRobots=cachedRobots && now-cachedRobots.checked_at<300000;
      const robots=targets.length?(reuseRobots?cachedRobots.text:await fetchText(OFFICIAL_ORIGIN+'/robots.txt',fetch,128*1024)):'';
      if(targets.some(r=>!robotsAllowed(robots,officialUrl(r))))throw Error('robots.txtで取得対象外のページです');
      if(work?.date!==date)await storage.deleteAll();
      if(targets.length)await storage.put('robots',{text:robots,checked_at:reuseRobots?cachedRobots.checked_at:now});
      targets.sort((a,b)=>a.deadline_at.localeCompare(b.deadline_at));
      const keys=[];
      for(let i=0;i<targets.length;i+=64) {
        const values={};for(const target of targets.slice(i,i+64)){const key=oddsKey(target);keys.push(key);values['target:'+key]=target;}
        if(work?.date!==date || work.feed_generated_at!==feed.generated_at)await storage.put(values);
      }
      work={date,scheduled_slot:slot,started_ms:now,started_at:iso(now),feed_generated_at:feed.generated_at,keys,cursor:0,
        running:keys.length>0,status:keys.length?'UPDATING':'IDLE',message:null,completed_at:keys.length?null:iso(now)};
      await storage.put('work',work);
      if(keys.length)await storage.setAlarm(now+1);
      return json({status:work.status,targets:keys.length},202);
    } catch(error) {
      if(work?.date!==date)await storage.deleteAll();
      await storage.put('work',{...(work?.date===date?work:{}),date,scheduled_slot:slot,started_ms:now,started_at:iso(now),
        running:false,status:'FAILED',message:String(error.message).slice(0,200)});
      console.error(JSON.stringify({event:'odds_refresh_start_failed',date,message:error.message}));
      return json({error:error.message},503);
    }
  }
  async alarm() {return this.exclusive(()=>this.processBatch());}
  async processBatch() {
    const storage=this.ctx.storage,work=await storage.get('work'),now=Date.now();
    if(!work?.running)return;
    if(work.date!==japanDate(now) || now-work.started_ms>=15*60000) {
      await storage.put('work',{...work,running:false,status:'FAILED',message:'更新処理が日付または制限時間を超えました'});return;
    }
    // Arm recovery before network work. At-least-once alarms also obey per-race attempt times.
    await storage.setAlarm(now+90000);
    const keys=work.keys.slice(work.cursor,work.cursor+BATCH_SIZE);
    const targets=await storage.get(keys.map(key=>'target:'+key));
    const previous=await storage.get(keys.map(key=>'race:'+key));
    const queue=keys.map(key=>({key,target:targets.get('target:'+key),previous:previous.get('race:'+key)}));
    for(const item of queue) {
      const attempted=Date.parse(item.previous?.attempted_at);
      // A retried alarm must not repeat attempts made by this same cycle.
      item.skip=!item.target || Date.parse(item.target.deadline_at)<=Date.now() || attempted>=work.started_ms;
      item.interval=oddsRefreshInterval(item.target || {},now);
      item.due=Number.isFinite(attempted)?attempted+item.interval:Date.now();
      if(item.interval===FAR_ODDS_INTERVAL_MS && item.due-now>1000)item.skip=true;
    }
    let nextStart=Date.now();const venues=new Map();
    const waitTurn=async venue=>{
      while(true) {
        const current=Date.now(),due=Math.max(nextStart,venues.get(venue)||0);
        if(due>current){await new Promise(resolve=>setTimeout(resolve,due-current));continue;}
        nextStart=current+250;venues.set(venue,current+1000);return;
      }
    };
    const run=async()=>{
      while(queue.length) {
        const item=queue.shift();if(item.skip)continue;
        const target=item.target;
        if(item.due>=Date.parse(target.deadline_at))continue;
        // Keep the previous successful quote available while waiting for its
        // refresh interval, rather than dropping the race for another cycle.
        while(item.due>Date.now())await new Promise(resolve=>setTimeout(resolve,item.due-Date.now()));
        await waitTurn(target.venue_code);
        const attempted=Date.now();
        if(attempted>=Date.parse(target.deadline_at))continue;
        const base={date:work.date,venue_code:target.venue_code,race_no:target.race_no,deadline_at:target.deadline_at,
          prediction_key:target.prediction_key,attempted_at:iso(attempted),source_url:officialUrl(target)};
        try {
          await storage.put('race:'+item.key,{...item.previous,...base,status:'FAILED',items:item.previous?.items || [],
            message:'取得中または前回の取得が中断されました'});
          const text=await fetchText(base.source_url),fetched=Date.now();
          const items=await parseOfficialHtml(text);
          const status=fetched>=Date.parse(target.deadline_at)?'CLOSED':items.length?'OK':'UNAVAILABLE';
          const record={...base,status,items,fetched_at:iso(fetched),message:status==='UNAVAILABLE'?'公式オッズは未提供です':null};
          await storage.put('race:'+item.key,record);
          const candidate=proposalCandidate(target,record,Date.now());
          if(candidate && !await storage.get('proposal:'+item.key))await storage.put('proposal-candidate:'+item.key,candidate);
        } catch(error) {
          await storage.put('race:'+item.key,{...item.previous,...base,status:'FAILED',items:item.previous?.items || [],message:String(error.message).slice(0,200)});
        }
      }
    };
    await Promise.all(Array.from({length:6},()=>run()));
    await this.freezeDue(Date.now());
    work.cursor+=keys.length;work.running=work.cursor<work.keys.length;
    work.status=work.running?'UPDATING':'COMPLETE';if(!work.running)work.completed_at=iso(Date.now());
    await storage.put('work',work);
    if(work.running)await storage.setAlarm(Date.now()+1000);else await storage.deleteAlarm();
    console.log(JSON.stringify({event:'odds_refresh_batch',date:work.date,completed:work.cursor,total:work.keys.length,running:work.running}));
  }
  async freezeDue(now) {
    const storage=this.ctx.storage,candidates=await storage.list({prefix:'proposal-candidate:'}),saved=await storage.list({prefix:'proposal:'});
    for(const candidate of candidates.values()) {
      const key='proposal:'+oddsKey(candidate);
      if(saved.has(key) || candidate.date!==japanDate(now) || Date.parse(candidate.cutoff_at)>now)continue;
      const frozen={...candidate,frozen_at:iso(now)};
      if(validProposal(frozen,candidate.date,now))await storage.put(key,frozen);
    }
  }
  async snapshot(url) {
    const now=Date.now(),date=url.searchParams.get('date'),storage=this.ctx.storage,work=await storage.get('work');
    const records=await storage.list({prefix:'race:'}),targets=await storage.list({prefix:'target:'});
    const currentTargets=(work?.date===date?work.keys || []:[]).map(key=>targets.get('target:'+key)).filter(Boolean);
    const currentKeys=new Set(currentTargets.map(oddsKey));
    const allRecords=new Map([...records.values()].filter(r=>r.date===date && currentKeys.has(oddsKey(r))).map(r=>[oddsKey(r),r]));
    const venue=url.searchParams.get('venue'),race=Number(url.searchParams.get('race'));
    const saved=await storage.list({prefix:'proposal:'});
    const proposals=[...saved.values()].filter(p=>validProposal(p,date,now) && (!venue || p.venue_code===venue) && (!race || p.race_no===race));
    const rows=[...allRecords.values()].filter(r=>(!venue || r.venue_code===venue) && (!race || r.race_no===race));
    return json({schema_version:1,date,interval_seconds:60,far_interval_seconds:300,fast_window_minutes:30,proposal_lead_seconds:180,served_at:iso(now),
      update:{status:work?.date===date?work.status:'UNAVAILABLE',started_at:work?.date===date?work.started_at:null,
        completed_at:work?.date===date?work.completed_at:null,message:work?.date===date?work.message:'当日のオッズは更新待ちです'},
      races:rows,proposals,opportunities:work?.status==='FAILED'?[]:opportunityRows(currentTargets,allRecords,now)});
  }
}
