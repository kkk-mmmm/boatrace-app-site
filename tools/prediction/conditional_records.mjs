// Frozen conditional tickets are separate from outcomes. Never backfill before activation.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {validateRecord} from './prospective.mjs';
import {conditionalRanking,firstPlaceProbabilities} from '../../site/public/view.mjs';
import {verifiedResults,archiveResult} from '../../site/public-verification.mjs';
import {verificationRow} from '../../site/public/verification-data.mjs';
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const seal=body=>({...body,integrity_sha256:digest(body)});
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const day=now=>new Date(now+9*3600000).toISOString().slice(0,10);
const walk=dir=>!fs.existsSync(dir)?[]:fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.name.endsWith('.json')?[path.join(dir,e.name)]:[]);
function immutable(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});try{fs.writeFileSync(file,JSON.stringify(value)+'\n',{flag:'wx'});return true;}catch(e){if(e.code!=='EEXIST')throw e;assert(JSON.stringify(read(file))===JSON.stringify(value),'条件記録の上書きを拒否: '+file);return false;}}
export function validateConditionalDefinition(d){
 assert(d?.schema_version===1&&d.id==='conditional-v1'&&d.selector_version==='conditional-ranking-v1'&&Number.isFinite(Date.parse(d.registered_at))&&d.minimum_odds===50&&d.minimum_probability===.01&&d.stake_per_ticket_yen===100&&JSON.stringify(d.scenarios)===JSON.stringify(['all','in','other']),'未対応の条件定義');
 const ids=new Set();assert(d.rules?.length===22,'22条件が必要です');for(const r of d.rules){assert(/^[a-z0-9_.]+$/.test(r.id)&&!ids.has(r.id)&&r.base==='return'&&[10,20].includes(r.limit)&&(r.maximum_in===.5&&r.lane===undefined&&r.relation===undefined&&r.minimum_first===undefined||r.maximum_in===undefined&&Number.isInteger(r.lane)&&r.lane>=2&&r.lane<=6&&r.minimum_first===.2&&['head','any'].includes(r.relation)),'条件定義が不正');assert(r.id===(r.maximum_in===.5?`return_${r.limit}_in_under_0.5`:`return_${r.limit}_lane_${r.lane}_0.2_${r.relation}`),'条件IDと内容が一致しません');ids.add(r.id);}
 const combinations=new Set(d.rules.map(r=>JSON.stringify([r.limit,r.maximum_in??null,r.lane??null,r.relation??null])));assert(combinations.size===22,'条件の重複があります');return d;
}
export function rootFor(directory,d){return path.join(directory,'conditional-strategies',d.id);}
function sourceFile(directory,r){assert(/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&/^(0[1-9]|1\d|2[0-4])$/.test(r.venue_code)&&Number.isInteger(r.race_no)&&r.race_no>=1&&r.race_no<=12&&/^[a-f0-9]{64}$/.test(r.source_snapshot_id),'条件記録の参照先が不正');return path.join(directory,'snapshots',r.date,r.venue_code,`R${r.race_no}`,r.source_snapshot_id+'.json');}
export function conditionalSelection(source,d,{now=Date.now(),activatedAt}={}){
 validateConditionalDefinition(d);validateRecord(source,now);const p=source.proposal;
 assert(source.kind==='WORKER_FROZEN','固定済み提案だけを記録します');
 assert(Number.isFinite(Date.parse(activatedAt))&&Date.parse(p.proposal_saved_at)>=Date.parse(activatedAt)&&Date.parse(p.cutoff_at)>=Date.parse(activatedAt),'条件記録の有効化前です');
 const lanes=firstPlaceProbabilities(p.probabilities),complete=p.odds.items.length===120&&lanes&&p.entries?.length===6&&new Set(p.entries.map(e=>e.lane)).size===6&&p.entries.every(e=>Number.isInteger(e.lane)&&e.lane>=1&&e.lane<=6)&&new Set(p.entries.map(e=>e.racer_id)).size===6&&p.entries.every(e=>/^\d{4}$/.test(e.racer_id||'')&&e.participation_status!=='WITHDRAWN');
 const conditions=d.rules.flatMap(rule=>d.scenarios.map(scenario=>{
  const ranked=complete?conditionalRanking(p.probabilities,p.odds.items,{...rule,scenario,currentOdds:true}).slice(0,rule.limit):[];
  return {id:rule.id,scenario,status:!complete?'INPUT_INCOMPLETE':ranked.length?'SELECTED':'NO_BET',combos:ranked.map(p=>p.combo)};
 }));
 return seal({schema_version:1,kind:'FROZEN_CONDITIONAL_SELECTION',definition_sha256:digest(d),activated_at:activatedAt,date:p.date,venue_code:p.venue_code,race_no:p.race_no,deadline_at:p.deadline_at,cutoff_at:p.cutoff_at,proposal_saved_at:p.proposal_saved_at,odds_fetched_at:p.odds.fetched_at,frozen_at:p.frozen_at,received_at:source.received_at,cohort:'WORKER_REPORTED_ONLY',model_id:p.model_id,model_coefficient_id:p.model_coefficient_id||null,grade:p.context?.grade||'未確認',source_snapshot_id:source.id,source_integrity_sha256:source.integrity_sha256,first_probabilities:lanes,conditions});
}
function validateSelection(directory,r,d,activatedAt,now){
 const {integrity_sha256,...body}=r;assert(integrity_sha256===digest(body)&&r.definition_sha256===digest(d)&&r.activated_at===activatedAt,'条件記録の変更を検出しました');
 const source=validateRecord(read(sourceFile(directory,r)),now);assert(source.integrity_sha256===r.source_integrity_sha256&&JSON.stringify(conditionalSelection(source,d,{now,activatedAt}))===JSON.stringify(r),'条件記録と元の保存予想が一致しません');return source;
}
export function captureConditionalRecords(directory,definition,{now=Date.now()}={}){
 const d=validateConditionalDefinition(definition),root=rootFor(directory,d),definitionFile=path.join(root,'definition.json'),activationFile=path.join(root,'activation.json');
 assert(now>=Date.parse(d.registered_at),'登録前には有効化できません');immutable(definitionFile,d);
 if(!fs.existsSync(activationFile))immutable(activationFile,{activated_at:new Date(now).toISOString(),definition_sha256:digest(d)});
 const activation=read(activationFile);assert(activation.definition_sha256===digest(d)&&Date.parse(activation.activated_at)>=Date.parse(d.registered_at)&&Date.parse(activation.activated_at)<=now,'条件の有効化記録が不正');
 const report={activated_at:activation.activated_at,saved:0,existing:0,skipped:0},candidates=new Map();
 const snapshots=path.join(directory,'snapshots');
 for(const date of fs.existsSync(snapshots)?fs.readdirSync(snapshots).filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>=day(Date.parse(activation.activated_at))&&date<=day(now)):[])for(const file of walk(path.join(snapshots,date))){
  const source=validateRecord(read(file),now),p=source.proposal;
  if(source.kind!=='WORKER_FROZEN'||Date.parse(p.proposal_saved_at)<Date.parse(activation.activated_at)||Date.parse(p.cutoff_at)<Date.parse(activation.activated_at)){report.skipped++;continue;}
  const key=`${p.date}/${p.venue_code}/R${p.race_no}`,old=candidates.get(key);if(!old||Date.parse(p.proposal_saved_at)>Date.parse(old.proposal.proposal_saved_at)||Date.parse(p.proposal_saved_at)===Date.parse(old.proposal.proposal_saved_at)&&source.id<old.id)candidates.set(key,source);
 }
 for(const [key,source] of candidates){const file=path.join(root,'predictions',key+'.json');if(fs.existsSync(file)){validateSelection(directory,read(file),d,activation.activated_at,now);report.existing++;continue;}
  immutable(file,conditionalSelection(source,d,{now,activatedAt:activation.activated_at}));report.saved++;
 }
 return report;
}
const counters=()=>({observations:0,no_bet:0,input_incomplete:0,pending:0,excluded:0,settled_races:0,tickets:0,hits:0,stake_yen:0,return_yen:0});
const finish=s=>({...s,profit_yen:s.return_yen-s.stake_yen,recovery_percent:s.stake_yen?s.return_yen/s.stake_yen*100:null,hit_rate:s.settled_races?s.hits/s.settled_races:null});
export function conditionalReport(directory,definition,{now=Date.now()}={}){
 const d=validateConditionalDefinition(definition),root=rootFor(directory,d);
 if(!fs.existsSync(path.join(root,'activation.json')))return {schema_version:1,kind:'CONDITIONAL_STRATEGY_REVIEW',definition:d,activated_at:null,records:0,groups:[],days:[],coverage:{status:'NOT_ACTIVATED'}};
 assert(JSON.stringify(read(path.join(root,'definition.json')))===JSON.stringify(d),'条件定義の変更を検出しました');const activation=read(path.join(root,'activation.json'));
 assert(activation.definition_sha256===digest(d)&&Date.parse(activation.activated_at)>=Date.parse(d.registered_at)&&Date.parse(activation.activated_at)<=now,'条件の有効化記録が不正');
 const files=walk(path.join(root,'predictions')),selections=files.map(read),dates=[...new Set(selections.map(r=>r.date))].sort();
 const results=dates.length?verifiedResults(directory,{from:dates[0],through:dates.at(-1),now}):new Map(),groups=new Map(),days=new Map();
 for(const r of selections){const source=validateSelection(directory,r,d,activation.activated_at,now),p=source.proposal,result=results.get(`${r.date}/${r.venue_code}/${r.race_no}`),official=result?archiveResult(result,p):null;
  let evaluated=verificationRow(p,official,now);
  const normal=official?.entries?.length===6&&[...official.entries].sort((a,b)=>a.finish-b.finish).every((e,i)=>e.finish===i+1&&(!e.finish_status||e.finish_status==='NORMAL'||String(e.finish_status)===String(e.finish))&&Number.isFinite(e.st)&&e.st>=0&&e.st_status==='NORMAL')&&(!official.settlement_status||official.settlement_status==='NORMAL');
  const compact=p.date.replaceAll('-',''),archiveMatches=official?.kind!=='OFFICIAL_ARCHIVE'||official.source_url===`https://www1.mbrace.or.jp/od2/K/${compact.slice(0,6)}/k${compact.slice(2)}.lzh`;
  if(evaluated.status==='SETTLED'&&(!normal||!archiveMatches))evaluated={...evaluated,status:'EXCLUDED',reason:'異常着順・返還・出典日付の不一致は通常評価から除外します'};
  if(evaluated.status==='EXCLUDED'&&normal&&archiveMatches&&!official.source_conflict&&official.payouts?.length===0)evaluated={...evaluated,status:'MISSING_PAYOUT',reason:'公式払戻の照合待ちです'};
  const coefficient=r.model_coefficient_id||'UNKNOWN:'+r.model_id,gid=r.cohort+'/'+coefficient;if(!groups.has(gid))groups.set(gid,{cohort:r.cohort,coefficient_id:coefficient,model_ids:new Set(),conditions:new Map()});const group=groups.get(gid);group.model_ids.add(r.model_id);
  if(!days.has(r.date))days.set(r.date,[]);const outcome={date:r.date,venue_code:r.venue_code,race_no:r.race_no,grade:r.grade,exhibition_complete:p.entries?.length===6&&p.entries.every(e=>Number.isFinite(e.exhibition_time)&&Number.isFinite(e.exhibition_st)&&Number.isInteger(e.exhibition_course)),source_snapshot_id:r.source_snapshot_id,coefficient_id:coefficient,cohort:r.cohort,status:evaluated.status,reason:evaluated.reason,actual_combo:evaluated.actual_combo||null,payout_yen_per_100:evaluated.payout_yen_per_100||null,result_source_url:evaluated.result_source_url||null,conditions:[]};
  for(const c of r.conditions){const key=c.id+'/'+c.scenario;if(!group.conditions.has(key))group.conditions.set(key,{id:c.id,scenario:c.scenario,...counters()});const s=group.conditions.get(key);s.observations++;
   const status=c.status==='SELECTED'?evaluated.status:c.status;let hit=null,stake=0,returned=0;
   if(status==='NO_BET')s.no_bet++;else if(status==='INPUT_INCOMPLETE')s.input_incomplete++;else if(status==='SETTLED'){s.settled_races++;s.tickets+=c.combos.length;hit=c.combos.includes(evaluated.actual_combo);s.hits+=Number(hit);stake=c.combos.length*d.stake_per_ticket_yen;returned=hit?evaluated.payout_yen_per_100:0;s.stake_yen+=stake;s.return_yen+=returned;}else if(['MISSING_RESULT','MISSING_PAYOUT'].includes(status))s.pending++;else s.excluded++;
   outcome.conditions.push({...c,status,hit,stake_yen:stake,return_yen:returned});
  }
  days.get(r.date).push(outcome);
 }
 return {schema_version:1,kind:'CONDITIONAL_STRATEGY_REVIEW',definition:d,activated_at:activation.activated_at,records:selections.length,groups:[...groups.values()].map(g=>({...g,model_ids:[...g.model_ids].sort(),conditions:[...g.conditions.values()].map(finish)})).sort((a,b)=>a.coefficient_id.localeCompare(b.coefficient_id)),days:[...days].sort(([a],[b])=>a.localeCompare(b)).map(([date,records])=>({date,records:records.sort((a,b)=>a.venue_code.localeCompare(b.venue_code)||a.race_no-b.race_no)})),coverage:{status:'ACTIVE',known_saved_races:selections.length,all_venues_guaranteed:false,notes:'保存できた固定提案だけ。受信による締切前証明とは別のWorker時刻区分。未照合・異常・欠損は回収率に算入しません。'},assumptions:['22条件×すべて/イン/それ以外の66区分。各券100円、重複する条件を合算しない。','条件と買い目は有効化後の固定予想から追記保存し、結果と分離します。結果の追加・訂正で照合レポートは更新されます。','条件外はNO_BET。見送りを不的中や購入として数えません。払戻は公式結果の実払戻を使い、保存オッズで代用しません。']};
}
function writeChanged(file,value){const text=JSON.stringify(value)+'\n';if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')===text)return false;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);return true;}
export function recordConditionalInventory(directory,definition,snapshots,{now=Date.now()}={}){
 const root=rootFor(directory,definition),activation=read(path.join(root,'activation.json'));let saved=0;
 for(const s of snapshots){if(s.date!==day(now)||!['OK','PARTIAL'].includes(s.update?.status)||!['OPEN','NO_MEETING'].includes(s.meeting_status)||!Number.isFinite(Date.parse(s.update.last_success_at))||Math.abs(now-Date.parse(s.update.last_success_at))>600000)continue;
 for(const r of s.races||[]){const cutoff=Date.parse(r.deadline_at)-180000;if(!/^(0[1-9]|1\d|2[0-4])$/.test(s.venue_code)||!Number.isInteger(r.race_no)||r.race_no<1||r.race_no>12||!Number.isFinite(cutoff)||cutoff<now||cutoff<Date.parse(activation.activated_at))continue;
 const file=path.join(root,'inventory',s.date,s.venue_code,`R${r.race_no}.json`);if(fs.existsSync(file))continue;
 immutable(file,{date:s.date,venue_code:s.venue_code,race_no:r.race_no,cutoff_at:new Date(cutoff).toISOString(),observed_at:new Date(now).toISOString(),withdrawn:r.entries?.some(e=>e.participation_status==='WITHDRAWN')||false});saved++;
 }}return saved;
}
export function runConditionalRecords(directory,definition,{now=Date.now(),snapshots=[]}={}){
 const capture=captureConditionalRecords(directory,definition,{now}),inventory_saved=recordConditionalInventory(directory,definition,snapshots,{now}),review=conditionalReport(directory,definition,{now}),{days,...summary}=review;
 for(const d of days)writeChanged(path.join(rootFor(directory,definition),'reviews',d.date+'.json'),{schema_version:1,definition_sha256:digest(definition),...d});
 const changed=writeChanged(path.join(directory,'reports',definition.id+'.json'),{...summary,record_days:days.map(d=>d.date)});
 return {...capture,inventory_saved,records:review.records,conditions:66,report_changed:changed};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [directory,config,staging]=process.argv.slice(2);if(!directory||!config)throw Error('保存先と条件定義を指定してください');const d=read(config);console.log('::notice title=Conditional strategy records::'+JSON.stringify(runConditionalRecords(directory,d,{snapshots:staging?walk(staging).map(read):[]})));const {strategyDashboard}=await import('../../site/strategy-dashboard.mjs');const coverage=strategyDashboard(directory,d).coverage;writeChanged(path.join(directory,'reports/coverage.json'),coverage);console.log('::notice title=Data coverage::'+JSON.stringify(coverage));if(coverage.alerts.length)console.log('::warning title=Data coverage gaps::'+JSON.stringify(coverage.alerts));}catch(e){console.error(e);process.exitCode=1;}
}
