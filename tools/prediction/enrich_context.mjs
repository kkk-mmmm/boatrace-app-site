import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {validateRecord} from './prospective.mjs';import {preraceEnvironment} from '../../site/public/race-context.mjs';
export function enrichContext(races,records,through){
 const from=new Date(Date.parse(through)-364*86400000).toISOString().slice(0,10),selected=new Map();
 for(const record of records){validateRecord(record);const p=record.proposal;
  if(p.date<from||p.date>through||!preraceEnvironment(p))continue;
  const expected=`https://www.boatrace.jp/owpc/pc/race/beforeinfo?hd=${p.date.replaceAll('-','')}&jcd=${p.venue_code}&rno=${p.race_no}`;
  if(p.environment.source_url!==expected)continue;
  const key=`${p.date}/${p.venue_code}/${p.race_no}`,old=selected.get(key);if(!old||Date.parse(p.proposal_saved_at)>Date.parse(old.proposal_saved_at))selected.set(key,p);
 }
 let paired=0;const output=races.map(r=>{const p=selected.get(`${r.date}/${r.venue_code}/${r.race_no}`);
  if(!p||p.entries?.length!==6||r.entries.some(e=>!p.entries.some(a=>a.lane===e.lane&&a.racer_id===e.racer_id)))return r;
  paired++;return {...r,deadline_at:p.deadline_at,environment:p.environment,entries:r.entries.map(e=>({...e,exhibition_course:p.entries.find(x=>x.lane===e.lane)?.exhibition_course??null}))};
 });return {races:output,readiness:{from,through,prerace_environment_pairs:paired,recent30_pairs:output.filter(r=>r.date>=new Date(Date.parse(through)-29*86400000).toISOString().slice(0,10)&&preraceEnvironment(r)).length,tide_pairs:output.filter(r=>preraceEnvironment(r)?.tide?.status==='OK').length,note:'30日以上保存する事前記録を、入手できる年次期間へ照合。結果資料の風を事前入力として代用しない。'}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [directory,recordRoot]=process.argv.slice(2);if(!directory||!recordRoot)throw Error('Annual directory and records directory required');
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'))),file=path.join(directory,'races.json');
 const scan=d=>!fs.existsSync(d)?[]:fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?scan(path.join(d,e.name)):e.name.endsWith('.json')?[path.join(d,e.name)]:[]);
 const from=new Date(Date.parse(manifest.through)-364*86400000).toISOString().slice(0,10),root=path.join(recordRoot,'snapshots');
 const files=fs.existsSync(root)?fs.readdirSync(root).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>=from&&d<=manifest.through).flatMap(d=>scan(path.join(root,d))):[];
 const result=enrichContext(JSON.parse(fs.readFileSync(file)),files.map(f=>JSON.parse(fs.readFileSync(f))),manifest.through);
 fs.writeFileSync(file,JSON.stringify(result.races)+'\n');fs.writeFileSync(path.join(directory,'context-readiness.json'),JSON.stringify(result.readiness,null,2)+'\n');console.log('::notice title=Prerace context readiness::'+JSON.stringify(result.readiness));
}
