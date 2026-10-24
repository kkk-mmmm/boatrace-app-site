import {scenarioProbabilities} from '../../site/public/view.mjs';
import {parseProgramHtml,programEntries,programDeadlines,programContext,programExhibition,dataActions,annualForecast,programCalendar,annualEntryData,programResult,resultDue} from './program.mjs';
import {validateAnnualModel} from '../../site/public/annual-model.mjs';
import {fetchText,officialUrl,robotsAllowed,parseOfficialHtml,OFFICIAL_ORIGIN} from './official.mjs';
import {ODDS_INTERVAL_MS,ODDS_MAX_AGE_MS,oddsKey,rankExpectedValue,validQuotes,proposalCandidate,validProposal,oddsRefreshInterval,FAR_ODDS_INTERVAL_MS} from '../../site/public/odds-live.mjs';

const japanDate=now=>new Date(now+9*3600000).toISOString().slice(0,10);
const json=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const stub=env=>env.ODDS.get(env.ODDS.idFromName('all-venues-v1'));
const iso=now=>new Date(now).toISOString();
export const BATCH_SIZE=12; // Each alarm stays below the Free plan's 50 external subrequests.

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

export function opportunityRows(targets, records, now, {featured=false}={}) {
  const rows=[];
  for(const target of targets) {
    const record=records.get(oddsKey(target));
    if(Date.parse(target.deadline_at)>now+3600000 || !record || record.status!=='OK' || record.date!==japanDate(now) || Date.parse(record.deadline_at)<=now
      || now-Date.parse(record.fetched_at)>ODDS_MAX_AGE_MS || Date.parse(record.fetched_at)>now+60000
      || record.prediction_key!==target.prediction_key || !['OK','PARTIAL'].includes(target.update_status)
      || !Number.isFinite(Date.parse(target.last_success_at)) || target.source_kind!=='CLOUDFLARE_SCHEDULED_PROGRAM' && now-Date.parse(target.last_success_at)>ODDS_MAX_AGE_MS
      || Date.parse(target.last_success_at)>now+60000 || target.issue)continue;
    const best=rankExpectedValue(target.probabilities,record.items)[0];
    if(best && (featured || best.value>1))rows.push({...best,date:target.date,venue_code:target.venue_code,venue:target.venue,race_no:target.race_no,
      scenario_probabilities:scenarioProbabilities(target.probabilities),deadline_at:target.deadline_at,model_name:target.model_name,prediction_key:target.prediction_key,
      fetched_at:record.fetched_at,recorded_at:record.fetched_at,classification:'PRERACE_ODDS_LOCAL_RECORD_UNVERIFIED',
      update_status:target.update_status,last_success_at:target.source_kind==='CLOUDFLARE_SCHEDULED_PROGRAM'?record.fetched_at:target.last_success_at});
  }
  return rows.sort((a,b)=>b.value-a.value || a.deadline_at.localeCompare(b.deadline_at) || a.venue_code.localeCompare(b.venue_code)).slice(0,featured?288:6);
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
  constructor(ctx,env) {this.ctx=ctx;this.env=env;this.serial=Promise.resolve();this.annualModel=null;}
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
      let feed;try{feed=JSON.parse(await fetchText(this.env.TARGETS_URL,fetch,5*1024*1024));}catch{feed={schema_version:1,date,generated_at:iso(now),races:[]};}
      const cachedRobots=await storage.get('robots'),reuseRobots=cachedRobots && now-cachedRobots.checked_at<300000;
      const robots=reuseRobots?cachedRobots.text:await fetchText(OFFICIAL_ORIGIN+'/robots.txt',fetch,128*1024);
      if(work?.date!==date)await storage.deleteAll();
      await storage.put('robots',{text:robots,checked_at:reuseRobots?cachedRobots.checked_at:now});
      let calendar=null;
      if(this.env.PLAYER_MODEL_URL){try{calendar=await this.loadCalendar(date,robots,now);}catch(error){console.error('calendar: '+error.message);}}
      if(feed.date!==date)feed={schema_version:1,date,generated_at:iso(now),races:[]};
      let targets=validateTargets(feed,now);
      await this.loadAnnualModel(feed,date,now);
      if(calendar){
        const bootstrap=await this.bootstrapPrograms(calendar,date,robots,now);
        const map=new Map(targets.map(t=>[oddsKey(t),t]));
        for(const target of bootstrap)if(!map.has(oddsKey(target)))map.set(oddsKey(target),target);
        targets=[...map.values()].filter(t=>Date.parse(t.deadline_at)>now);
      }
      if(targets.some(r=>!robotsAllowed(robots,officialUrl(r))))throw Error('robots.txtで取得対象外のページです');
      targets.sort((a,b)=>a.deadline_at.localeCompare(b.deadline_at));
      const keys=[],knownTargets=this.env.PLAYER_MODEL_URL?await storage.list({prefix:'target:'}):null;
      for(let i=0;i<targets.length;i+=64) {
        const values={};for(const target of targets.slice(i,i+64)){const key=oddsKey(target);keys.push(key);if(!knownTargets || JSON.stringify(knownTargets.get('target:'+key))!==JSON.stringify(target))values['target:'+key]=target;}
        if(Object.keys(values).length && (work?.date!==date || work.feed_generated_at!==feed.generated_at || knownTargets))await storage.put(values);
      }
      // Keep closed races in the alarm queue for bounded, shared result collection.
      if(this.env.PLAYER_MODEL_URL){
        const agendas=await storage.list({prefix:'agenda:'}),results=await storage.list({prefix:'result:'});
        for(const agenda of agendas.values())for(const target of agenda)if(target.date===date&&resultDue(target,results.get('result:'+oddsKey(target)),now)){
          const key=oddsKey(target);if(!keys.includes(key)){keys.push(key);await storage.put('target:'+key,target);}
        }
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
      item.closed=!!item.target&&Date.parse(item.target.deadline_at)<=Date.now();
      item.skip=!item.target || (!item.closed&&attempted>=work.started_ms) || (item.closed&&!this.env.PLAYER_MODEL_URL);
      item.interval=oddsRefreshInterval(item.target || {},now);
      item.due=Number.isFinite(attempted)?attempted+item.interval:Date.now();
      item.oddsDue=!(item.interval===FAR_ODDS_INTERVAL_MS && item.due-now>1000);
      if(!item.oddsDue && !this.env.PLAYER_MODEL_URL)item.skip=true;
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
        let target=item.target;
        if(item.closed){await this.refreshResult(target,waitTurn);continue;}
        if(this.env.PLAYER_MODEL_URL){target=await this.refreshProgram(target,waitTurn);item.target=target;}
        if(!item.oddsDue)continue;
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
  async loadCalendar(date,robots,now){
    const storage=this.ctx.storage,previous=await storage.get('calendar');
    if(previous?.date===date)return previous;
    const url=`${OFFICIAL_ORIGIN}/owpc/pc/race/index?hd=${date.replaceAll('-','')}`;
    if(!robotsAllowed(robots,url))throw Error('開催一覧はrobots.txtで取得対象外です');
    const page=await parseProgramHtml(await fetchText(url));
    const calendar={date,venues:programCalendar(page,date),fetched_at:iso(Date.now()),source_url:url};
    await storage.put('calendar',calendar);return calendar;
  }
  async loadAnnualModel(feed,date,now){
    if(!this.env.PLAYER_MODEL_URL)return;
    if(this.annualModel && this.annualModel.trained_through<date && this.modelCheckedDate===date && (!feed.annual_model_id || this.annualModel.id===feed.annual_model_id) && (!feed.exhibition_st_through || this.annualModel.exhibition_st_profiles?.through===feed.exhibition_st_through))return;
    try{
      const model=validateAnnualModel(JSON.parse(await fetchText(this.env.PLAYER_MODEL_URL,fetch,8*1024*1024)),date);
      if(Date.parse(model.created_at)>now+60000)throw Error('未来の履歴モデルです');
      this.annualModel=model;this.modelCheckedDate=date;
      const cached=await this.ctx.storage.list({prefix:'program:'});
      for(const [key,program] of cached)if(program.date===date&&program.entries?.length===6&&(program.history_model_id!==model.id || program.history_exhibition_st_through!==(model.exhibition_st_profiles?.through||null)))await this.ctx.storage.put(key,annualEntryData(program,model));
      await this.ctx.storage.put('annual-model-status',{status:'OK',model_id:model.id,engine_version:model.engine_version,venue_profiles:Object.keys(model.profiles.venues||{}).length,coverage:model.coverage,history_data:{recent_days:model.profiles.windows?.recent_days||[],through:model.profiles.windows?.through||null,course_profiles:Object.values(model.profiles.players).filter(p=>Object.keys(p).some(k=>/^c[1-6]$/.test(k))).length},exhibition_st:{through:model.exhibition_st_profiles?.through||null,paired_starts:model.exhibition_st_profiles?.paired_starts||0,players:Object.keys(model.exhibition_st_profiles?.players||{}).length},checked_at:iso(now)});
    }catch(error){await this.ctx.storage.put('annual-model-status',{status:'FAILED',message:String(error.message).slice(0,200),checked_at:iso(now)});}
  }
  async bootstrapPrograms(calendar,date,robots,now){
    let calendarChanged=false;
    const targets=[],storage=this.ctx.storage,hour=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Tokyo',hour:'2-digit',hourCycle:'h23'}).format(new Date(now)));
    if(hour<7||!calendar)return targets;
    for(const venue of calendar.venues.filter(v=>v.meeting_status==='OPEN')){
      let agenda=await storage.get('agenda:'+venue.code);
      if(!agenda){
        const attempt=await storage.get('bootstrap:'+venue.code);if(attempt && now-attempt<300000)continue;
        await storage.put('bootstrap:'+venue.code,now);
        const target={date,venue_code:venue.code,race_no:1,venue:venue.name||venue.code,context:venue.meeting,probabilities:[]};
        const url=`${OFFICIAL_ORIGIN}/owpc/pc/race/racelist?hd=${date.replaceAll('-','')}&jcd=${venue.code}&rno=1`;
        try{
          if(!robotsAllowed(robots,url))throw Error('出走表はrobots.txtで取得対象外です');
          const page=await parseProgramHtml(await fetchText(url));
          agenda=programDeadlines(page,date).filter(r=>r.deadline_at).map(r=>({...target,...r}));
          await storage.put('agenda:'+venue.code,agenda);
          const first=agenda.find(r=>r.race_no===1);
          if(first){let p={...first,entries:programEntries(page),context:programContext(page,venue.meeting),entries_fetched_at:iso(Date.now()),input_source_url:url,entries_30m_done:Date.parse(first.deadline_at)-Date.now()<=1800000};
            if(p.context.meeting_day&&venue.meeting.meeting_day!==p.context.meeting_day){venue.meeting={...venue.meeting,meeting_day:p.context.meeting_day};calendarChanged=true;}
            if(this.annualModel)p=annualEntryData(p,this.annualModel);const forecast=this.annualModel?annualForecast(p,this.annualModel,Date.now()):null;if(forecast)p={...p,...forecast};await storage.put('program:'+oddsKey(p),p);}
        }catch(error){await storage.put('bootstrap-issue:'+venue.code,{message:String(error.message).slice(0,200),attempted_at:iso(now)});}
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      if(agenda)targets.push(...agenda);
    }
    if(calendarChanged)await storage.put('calendar',calendar);
    return targets;
  }
  async refreshResult(target,waitTurn){
    const storage=this.ctx.storage,key='result:'+oddsKey(target),now=Date.now(),previous=await storage.get(key);
    if(!resultDue(target,previous,now))return;
    const source_url=`${OFFICIAL_ORIGIN}/owpc/pc/race/raceresult?hd=${target.date.replaceAll('-','')}&jcd=${target.venue_code}&rno=${target.race_no}`;
    const base={date:target.date,venue_code:target.venue_code,race_no:target.race_no,deadline_at:target.deadline_at,source_url,attempted_at:iso(now)};
    await storage.put(key,{...base,status:'PENDING'});
    try{
      const robots=(await storage.get('robots'))?.text;if(!robotsAllowed(robots,source_url))throw Error('結果はrobots.txtで取得対象外です');
      await waitTurn(target.venue_code);
      const result=programResult(await parseProgramHtml(await fetchText(source_url)));
      const program=await storage.get('program:'+oddsKey(target));
      if(result&&program?.entries?.some(e=>result.entries.find(r=>r.lane===e.lane)?.racer_id!==e.racer_id))throw Error('結果と出走表の選手が一致しません');
      await storage.put(key,{...base,...(result||{status:'PENDING'}),fetched_at:iso(Date.now())});
    }catch(error){await storage.put(key,{...base,status:'FAILED',message:String(error.message).slice(0,200)});}
  }
  async refreshProgram(target,waitTurn){
    const storage=this.ctx.storage,key=oddsKey(target),now=Date.now();let program=await storage.get('program:'+key);
    const identity={date:target.date,venue_code:target.venue_code,venue:target.venue,race_no:target.race_no,deadline_at:target.deadline_at,context:target.context};
    const actions=dataActions(program,target.deadline_at,now);let changed=false,dirty=false;
    const robots=(await storage.get('robots'))?.text||'User-agent: *\nDisallow: /';
    if(actions.entries && (!program?.entries_last_attempt || now-Date.parse(program.entries_last_attempt)>=300000)){
      const url=`${OFFICIAL_ORIGIN}/owpc/pc/race/racelist?hd=${target.date.replaceAll('-','')}&jcd=${target.venue_code}&rno=${target.race_no}`;
      await waitTurn(target.venue_code);program={...identity,...program,entries_last_attempt:iso(Date.now())};dirty=true;
      try{if(!robotsAllowed(robots,url))throw Error('出走表はrobots.txtで取得対象外です');const page=await parseProgramHtml(await fetchText(url));program={...program,entries:programEntries(page).map(e=>({...program?.entries?.find(old=>old.lane===e.lane&&old.racer_id===e.racer_id),...e})),context:programContext(page,target.context||program.context),entries_fetched_at:iso(Date.now()),input_source_url:url,entries_30m_done:Date.parse(target.deadline_at)-Date.now()<=1800000,entries_issue:null};changed=true;}
      catch(error){program.entries_issue=String(error.message).slice(0,200);}
    }
    if(actions.exhibition){
      const url=`${OFFICIAL_ORIGIN}/owpc/pc/race/beforeinfo?hd=${target.date.replaceAll('-','')}&jcd=${target.venue_code}&rno=${target.race_no}`;
      await waitTurn(target.venue_code);program={...identity,...program,exhibition_last_attempt:iso(Date.now())};dirty=true;
      try{if(!robotsAllowed(robots,url))throw Error('展示はrobots.txtで取得対象外です');const display=programExhibition(await parseProgramHtml(await fetchText(url)));
        program.entries=(program.entries||[]).map(e=>({...e,...display.find(x=>x.lane===e.lane)}));program.exhibition_fetched_at=iso(Date.now());program.exhibition_source_url=url;program.exhibition_available=display.length===6&&display.every(e=>e.participation_status==='WITHDRAWN'||[e.exhibition_time,e.exhibition_st,e.exhibition_course].every(Number.isFinite));program.exhibition_issue=null;changed=true;
        if(Date.parse(target.deadline_at)-now<=300000)program.exhibition_5m_done=true;else program.exhibition_10m_done=true;
      }catch(error){program.exhibition_issue=String(error.message).slice(0,200);}
    }
    if(program?.entries?.some(e=>e.participation_status==='WITHDRAWN'))program={...program,issue:'欠場あり：6艇を前提とする予想を停止しています',update_status:'PARTIAL'};
    if(program?.entries?.length===6 && this.annualModel && (changed||program.history_model_id!==this.annualModel.id||program.history_exhibition_st_through!==(this.annualModel.exhibition_st_profiles?.through||null))){
      try{program=annualEntryData(program,this.annualModel);dirty=true;}catch(error){program.model_issue=String(error.message).slice(0,200);}
    }
    if(program && this.annualModel && (changed||program.model_id!==this.annualModel.id)){
      try{const forecast=annualForecast(program,this.annualModel,Date.now());if(forecast){program={...program,...forecast};dirty=true;}}
      catch(error){program.model_issue=String(error.message).slice(0,200);}
    }
    if(program && (dirty||changed))await storage.put('program:'+key,program);
    return program?.probabilities?.length===120?{...program,source_kind:'CLOUDFLARE_SCHEDULED_PROGRAM'}:target;
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
    const records=await storage.list({prefix:'race:'}),targets=await storage.list({prefix:'target:'}),programMap=await storage.list({prefix:'program:'});
    const currentTargets=(work?.date===date?work.keys || []:[]).map(key=>{const p=programMap.get('program:'+key);return p?.probabilities?.length===120?{...p,source_kind:'CLOUDFLARE_SCHEDULED_PROGRAM'}:targets.get('target:'+key);}).filter(Boolean);
    const currentKeys=new Set(currentTargets.map(oddsKey));
    const allRecords=new Map([...records.values()].filter(r=>r.date===date && currentKeys.has(oddsKey(r))).map(r=>[oddsKey(r),r]));
    const venue=url.searchParams.get('venue'),race=Number(url.searchParams.get('race'));
    const saved=await storage.list({prefix:venue?'proposal:'+venue+'-':'proposal:'});
    const proposals=[...saved.values()].filter(p=>(!venue || p.venue_code===venue) && (!race || p.race_no===race) && validProposal(p,date,now));
    const rows=[...allRecords.values()].filter(r=>(!venue || r.venue_code===venue) && (!race || r.race_no===race));
    return json({schema_version:1,date,interval_seconds:60,far_interval_seconds:300,fast_window_minutes:30,proposal_lead_seconds:180,served_at:iso(now),
      update:{status:work?.date===date?work.status:'UNAVAILABLE',started_at:work?.date===date?work.started_at:null,
        completed_at:work?.date===date?work.completed_at:null,message:work?.date===date?work.message:'当日のオッズは更新待ちです'},
      calendar:await storage.get('calendar'),annual_model:await storage.get('annual-model-status'),programs:[...programMap.values()].filter(p=>p.entries?.length===6&&p.date===date&&(!venue||p.venue_code===venue)&&(!race||p.race_no===race)),
      results:[...(await storage.list({prefix:'result:'})).values()].filter(r=>r.date===date&&(!venue||r.venue_code===venue)&&(!race||r.race_no===race)),
      races:rows,proposals,featured_races:work?.status==='FAILED'?[]:opportunityRows(currentTargets,allRecords,now,{featured:true}),opportunities:work?.status==='FAILED'?[]:opportunityRows(currentTargets,allRecords,now)});
  }
}
