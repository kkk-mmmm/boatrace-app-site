import fs from 'node:fs';import path from 'node:path';
// Independent of the record collector: safe for both the CLI and page builder.
export function coverageSummary(directory,definition,report,{now=Date.now()}={}){const root=path.join(directory,'conditional-strategies',definition.id),inventory=[];
 const walk=dir=>!fs.existsSync(dir)?[]:fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.name.endsWith('.json')?[path.join(dir,e.name)]:[]);
 for(const f of walk(path.join(root,'inventory')))inventory.push(JSON.parse(fs.readFileSync(f)));
 const eligible=inventory.filter(r=>Date.parse(r.cutoff_at)<=now&&!r.withdrawn),records=report.days.flatMap(d=>d.records),byKey=new Map(records.map(r=>[`${r.date}/${r.venue_code}/${r.race_no}`,r]));
 let prediction=0,odds=0,exhibition=0,result=0;const alerts=[];for(const r of eligible){const p=byKey.get(`${r.date}/${r.venue_code}/${r.race_no}`);if(!p){if(now-Date.parse(r.cutoff_at)>900000)alerts.push({date:r.date,venue_code:r.venue_code,race_no:r.race_no,code:'MISSING_FROZEN_PREDICTION'});continue;}if(['MISSING_RESULT','MISSING_PAYOUT'].includes(p.status)&&now-Date.parse(r.cutoff_at)>3780000)alerts.push({date:r.date,venue_code:r.venue_code,race_no:r.race_no,code:'RESULT_DELAY'});prediction++;if(p.conditions.some(c=>c.status!=='INPUT_INCOMPLETE'))odds++;if(p.exhibition_complete)exhibition++;if(p.status==='SETTLED')result++;}
 return {...report.coverage,alerts,denominator:eligible.length,scheduled:inventory.length,withdrawn:inventory.filter(r=>r.withdrawn).length,prediction,odds,exhibition,result,untracked_saved_records:records.filter(r=>!inventory.some(i=>i.date===r.date&&i.venue_code===r.venue_code&&i.race_no===r.race_no)).length};
}
