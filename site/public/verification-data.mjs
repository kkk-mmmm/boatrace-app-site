import {validProposal,validResult} from './odds-live.mjs';
import {predictionRanking} from './view.mjs';
const key=r=>`${r.date}/${r.venue_code}/${r.race_no}`;
const day=now=>new Date(now+9*3600000).toISOString().slice(0,10);
export function verificationRow(proposal,result,now=Date.now(),cohort='WORKER_REPORTED_ONLY'){
 const r=proposal||result;if(!r)return null;
 const base={key:key(r),date:r.date,venue_code:r.venue_code,race_no:r.race_no,deadline_at:r.deadline_at||null,cohort,status:'PENDING',reason:null};
 if(!proposal||!validProposal(proposal,proposal.date,now,!!proposal.frozen_at))return {...base,status:'MISSING_PROPOSAL',reason:'締切前の有効な保存予想がありません'};
 const probability=[...proposal.probabilities].sort((a,b)=>b.probability-a.probability||a.combo.localeCompare(b.combo)),values=predictionRanking(probability,proposal.odds.items,{tab:'value',currentOdds:true}),quote=new Map(proposal.odds.items.map(o=>[o.combo,o.odds]));
 const rows=a=>a.slice(0,10).map(x=>({combo:x.combo,probability:x.probability,odds:quote.get(x.combo)??null,value:quote.has(x.combo)?x.probability*quote.get(x.combo):null}));
 const saved={...base,model_id:proposal.model_id,model_name:proposal.model_name,proposal_saved_at:proposal.proposal_saved_at,odds_fetched_at:proposal.odds.fetched_at,cutoff_at:proposal.cutoff_at,probability_top10:rows(probability),value_top10:rows(values)};
 if(result?.source_conflict)return {...saved,status:'EXCLUDED',reason:'取得元の間で結果・払戻が一致しないため、確認が必要です'};
 if(!result||result.status!=='CONFIRMED')return {...saved,status:'MISSING_RESULT',reason:'確定結果は未取得・照合待ちです'};
 const archive=result.kind==='OFFICIAL_ARCHIVE'&&/^https:\/\/www1\.mbrace\.or\.jp\/od2\/K\/\d{6}\/k\d{6}\.lzh$/.test(result.source_url||'')&&/^[a-f0-9]{64}$/.test(result.source_sha256||'');
 if(!archive&&!validResult(result,result.date,now))return {...saved,status:'EXCLUDED',reason:'結果の出典・時刻を検証できません'};
 if(key(proposal)!==key(result)||proposal.deadline_at!==result.deadline_at||proposal.entries?.length!==6||result.entries?.length!==6||proposal.entries.some(e=>!result.entries.some(a=>a.lane===e.lane&&a.racer_id===e.racer_id)))return {...saved,status:'EXCLUDED',reason:'保存予想と確定結果の選手・レースが一致しません'};
 const ordered=[...result.entries].sort((a,b)=>a.finish-b.finish);
 if(!ordered.every((e,i)=>e.finish===i+1&&Number.isFinite(e.st)&&e.st>=0&&e.st_status==='NORMAL')||result.payouts?.length!==1)return {...saved,status:'EXCLUDED',reason:'F/L・欠場・異常着順・返還・同着等は通常の仮想評価から除外します'};
 const actual_combo=ordered.slice(0,3).map(e=>e.lane).join('-'),payout=result.payouts.find(p=>p.combo===actual_combo)?.payout_yen_per_100;
 if(!Number.isInteger(payout)||payout<=0)return {...saved,status:'EXCLUDED',reason:'公式の3連単払戻を照合できません'};
 const strategy=items=>{const hit=items.some(x=>x.combo===actual_combo),stake=items.length*100,returned=hit?payout:0;return {points:items.length,hit,stake_yen:stake,return_yen:returned,recovery_percent:stake?returned/stake*100:null};};
 return {...saved,status:'SETTLED',actual_combo,payout_yen_per_100:payout,result_source_url:result.source_url,result_source_sha256:result.source_sha256||null,result_fetched_at:result.fetched_at||null,finish:ordered.map(e=>({lane:e.lane,name:e.name,finish:e.finish})),probability_strategy:strategy(saved.probability_top10),value_strategy:strategy(saved.value_top10)};
}
export function verificationResponse(rows,{date=null,venue=null,offset=0,limit=20,now=Date.now(),generated_at=new Date(now).toISOString()}={}){
 const today=day(now),dates=Array.from({length:7},(_,i)=>new Date(Date.parse(today)-(6-i)*86400000).toISOString().slice(0,10)).reverse();
 if(date&&!dates.includes(date))throw Error('公開対象は直近7日分です');
 if(venue&&!/^(0[1-9]|1\d|2[0-4])$/.test(venue)||!Number.isInteger(offset)||offset<0||offset>300||!Number.isInteger(limit)||limit<1||limit>50)throw Error('Invalid verification filters');
 const unique=new Map();for(const row of rows)if(row&&dates.includes(row.date)&&/^(0[1-9]|1\d|2[0-4])$/.test(row.venue_code)&&Number.isInteger(row.race_no)&&row.race_no>=1&&row.race_no<=12){const previous=unique.get(row.key);if(!previous||previous.cohort!=='RECEIPT_BEFORE_CUTOFF'&&row.cohort==='RECEIPT_BEFORE_CUTOFF'||previous.status!=='SETTLED'&&row.status==='SETTLED')unique.set(row.key,row);}
 const records=[...unique.values()].filter(r=>!venue||r.venue_code===venue);
 const summarize=list=>{const known=list.filter(r=>r.status==='SETTLED');const sum=type=>{const stake=known.reduce((s,r)=>s+(r[type]?.stake_yen||0),0),returned=known.reduce((s,r)=>s+(r[type]?.return_yen||0),0);return {races:known.length,hits:known.filter(r=>r[type]?.hit).length,stake_yen:stake,return_yen:returned,recovery_percent:stake?returned/stake*100:null};};return {recorded_races:list.length,evaluated_races:known.length,pending_or_excluded:list.length-known.length,probability:sum('probability_strategy'),value:sum('value_strategy')};};
 const selected=date||dates.find(d=>records.some(r=>r.date===d))||dates[0],list=records.filter(r=>r.date===selected).sort((a,b)=>a.venue_code.localeCompare(b.venue_code)||a.race_no-b.race_no);
 return {schema_version:1,kind:'PUBLIC_SAVED_FORECAST_VERIFICATION',served_at:new Date(now).toISOString(),generated_at,public_days:7,internal_retention_days:30,date:selected,days:dates.map(date=>({date,...summarize(records.filter(r=>r.date===date))})),summary:summarize(list),total:list.length,offset,limit,has_more:offset+limit<list.length,records:list.slice(offset,offset+limit),
  methodology:'締切前保存の確率上位10点／期待値上位最大10点を各100円で購入した仮想評価です。実購入の実績ではありません。未照合や異常レースを不的中に数えず、保存時オッズを確定払戻の代用にしません。WORKER_REPORTED_ONLYはWorkerの記録時刻による保存で、外部受信による事前保存証明とは区別します。'};
}
