import {predictAnnual,validateAnnualModel,annualHistory} from '../../site/public/annual-model.mjs';
export const norm=value=>String(value||'').normalize('NFKC').replace(/&nbsp;|&#160;/g,' ').trim();
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
const num=value=>/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(norm(value).replaceAll(',',''))?Number(norm(value).replaceAll(',','')):null;
const tokens=cell=>cell.text.split(/\r?\n/).map(norm).filter(Boolean);
export async function parseProgramHtml(html){
 const tables=[],stack=[];let row=null,cell=null,detail='',day='',body='',link=null,dayIndex=0,activeDay=null;
 const response=new HTMLRewriter()
 .on('table',{element(e){const t={rows:[]};tables.push(t);stack.push(t);e.onEndTag(()=>stack.pop());}})
 .on('tr',{element(e){if(stack.length){row=[];stack.at(-1).rows.push(row);e.onEndTag(()=>row=null);}}})
 .on('td, th',{element(e){if(row){cell={attrs:Object.fromEntries(e.attributes),text:''};row.push(cell);e.onEndTag(()=>cell=null);}},text(c){if(cell)cell.text+=c.text;}})
 .on('a[href]',{element(e){if(row){link={href:e.getAttribute('href'),text:''};(row.links||=[]).push(link);e.onEndTag(()=>link=null);}},text(c){if(link)link.text+=c.text;}})
 .on('body',{text(c){body+=c.text;}})
 .on('br, div, p',{element(){if(cell)cell.text+='\n';}})
 .on('.title16_titleDetail__add2020',{text(c){detail+=c.text;}})
 .on('.tab2_tabs li',{element(e){dayIndex++;if(/\bis-active[12]\b/.test(e.getAttribute('class')||''))activeDay=dayIndex;}})
 .on('.tab2_tabs .is-active1, .tab2_tabs .is-active2',{text(c){day+=c.text;}})
 .transform(new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}}));
 await response.arrayBuffer();return {tables,detail:norm(detail),day:norm(day),activeDay,body};
}
export function programEntries(page){
 const rows=page.tables.flatMap(t=>t.rows).filter(r=>r[0]?.attrs.rowspan==='4'&&/\bis-boatColor[1-6]\b/.test(r[0].attrs.class||''));
 requireValue(rows.length===6,'6艇分の出走表を確認できません');
 const entries=rows.map(row=>{
  requireValue(row.length>=8,'出走表の列数が変わっています');
  const identity=tokens(row[2]),match=/(\d{4})\s*\/\s*(A1|A2|B1|B2)/.exec(identity.join(' '));
  const classAt=identity.findIndex(x=>/\/\s*(A1|A2|B1|B2)$/.test(x));
  requireValue(match&&classAt>=0&&identity[classAt+1],'登録番号・選手名を確認できません');
  const start=tokens(row[3]),national=tokens(row[4]),local=tokens(row[5]),motor=tokens(row[6]),boat=tokens(row[7]);
  requireValue(/^F\d+$/.test(start[0])&&/^L\d+$/.test(start[1]),'平均STの構造が変わっています');
  return {lane:Number(norm(row[0].text)),racer_id:match[1],name:identity[classAt+1].split(/\s+/).join(' '),class:match[2],
   national_win_rate:num(national[0]),local_win_rate:num(local[0]),motor_2rate:num(motor[1]),boat_2rate:num(boat[1]),avg_st:num(start[2])};
 });
 requireValue(new Set(entries.map(e=>e.lane)).size===6&&entries.every(e=>e.lane>=1&&e.lane<=6),'出走表の枠が不正です');return entries.sort((a,b)=>a.lane-b.lane);
}
export function programDeadlines(page,date){
 const row=page.tables.flatMap(t=>t.rows).find(r=>norm(r[0]?.text)==='締切予定時刻');
 requireValue(row?.length===13,'12レースの締切を確認できません');
 return row.slice(1).map((c,i)=>({race_no:i+1,deadline_at:/^\d{2}:\d{2}$/.test(norm(c.text))?`${date}T${norm(c.text)}:00+09:00`:null}));
}
export function programContext(page,previous={}){
 const label=page.detail.replace(/\s*\d{3,4}m.*$/,'').trim(),day=/初日/.test(page.day)?1:Number(/(\d+)日目/.exec(page.day)?.[1])||(/最終日/.test(page.day)?page.activeDay:null)||previous.meeting_day||null;
 return {...previous,meeting_day:day,race_label:label||previous.race_label||null,
  phase:label.includes('準優')?'SEMI_FINAL':label.includes('優勝戦')?'FINAL':label.includes('予選')?'QUALIFYING':label?'OTHER':previous.phase||'UNKNOWN'};
}
export function programExhibition(page){
 const rows=page.tables.flatMap(t=>t.rows).filter(r=>r[0]?.attrs.rowspan==='4'&&/\bis-boatColor[1-6]\b/.test(r[0].attrs.class||''));
 if(!rows.length)return [];
 requireValue(rows.length===6,'展示の出走表が6艇分ありません');
 const startTable=page.tables.find(t=>norm(t.rows[0]?.[0]?.text)==='スタート展示'),starts=new Map();
 if(startTable)for(const [i,row] of startTable.rows.slice(2).entries()){
  const m=/^([1-6])\s+([FL]?)(\d?\.\d{2})/.exec(norm(row.map(c=>c.text).join(' ')));
  if(m)starts.set(Number(m[1]),{exhibition_st:Number(m[3])*(m[2]==='F'?-1:1),exhibition_course:i+1,exhibition_st_status:m[2]||'NORMAL'});
 }
 return rows.map(row=>{const lane=Number(norm(row[0].text)),time=num(row[4].text);requireValue(time===null||time>=5&&time<=9,'展示タイムが範囲外です');return {lane,exhibition_time:time,...starts.get(lane)};});
}
export function dataActions(program,deadline,now){
 const left=Date.parse(deadline)-now;if(!(left>0))return {entries:false,exhibition:false};
 return {entries:!program?.entries?.length||left<=30*60000&&!program.entries_30m_done,
  exhibition:left<=10*60000&&!program?.exhibition_10m_done || left<=5*60000&&!program?.exhibition_available&&!program?.exhibition_5m_done};
}
export function annualForecast(program,model,now){
 if(!model||!program.entries?.length||now>=Date.parse(program.deadline_at)-180000)return null;
 validateAnnualModel(model,program.date);
 const result=predictAnnual(program,model),saved=new Date(now).toISOString();
 return {...program,entries:result.entries,probabilities:result.items,items:result.items.slice(0,10),scores:result.scores,
  model_id:model.id,model_name:model.name,model_status:model.status,model_validation:{...model.validation,selected_lambda:model.validation.lambda},
  prediction_key:`${model.id}:${saved}`,prediction_saved_at:saved,input_fetched_at:[program.entries_fetched_at,program.exhibition_fetched_at].filter(t=>Number.isFinite(Date.parse(t))).sort((a,b)=>Date.parse(b)-Date.parse(a))[0],
  history_window:model.coverage,history:annualHistory(program,model),update_status:'OK',last_success_at:program.entries_fetched_at,issue:null};
}

export function programCalendar(page,date){
 const held=new Map();
 for(const row of page.tables.flatMap(t=>t.rows))for(const link of row.links||[]){
  let url;try{url=new URL(link.href.replaceAll('&amp;','&'),'https://www.boatrace.jp');}catch{continue;}
  const code=url.searchParams.get('jcd');
  if(url.origin!=='https://www.boatrace.jp'||url.pathname!=='/owpc/pc/race/raceindex'||url.searchParams.get('hd')!==date.replaceAll('-','')||!/^(0[1-9]|1\d|2[0-4])$/.test(code||''))continue;
  const cellClasses=row.map(c=>c.attrs.class||''),grades=[['is-SGa','SG'],['is-SGb','SG'],['is-G1a','PG1'],['is-G1b','G1'],['is-G2a','G2'],['is-G2b','G2'],['is-G3a','G3'],['is-G3b','G3'],['is-ippan','一般']];
  const gi=cellClasses.findIndex(c=>grades.some(([k])=>c.split(/\s+/).includes(k))),grade=gi>=0?grades.find(([k])=>cellClasses[gi].split(/\s+/).includes(k))?.[1]:null;
  const tc=cellClasses[gi+1]||'',schedule=[['is-morning','モーニング'],['is-nighter','ナイター'],['is-summer','サマータイム'],['is-midnight','ミッドナイト']].find(([k])=>tc.split(/\s+/).includes(k))?.[1] || (gi>=0&&!tc.trim()?'デイ':null);
  const label=row.map(c=>norm(c.text)).map(x=>/(初日|最終日|\d+日目)$/.exec(x)?.[1]).find(Boolean)||null;
  held.set(code,{code,meeting_status:'OPEN',meeting:{title:norm(link.text),grade,schedule_type:schedule,day_label:label,meeting_day:label==='初日'?1:Number(/(\d+)日目/.exec(label||'')?.[1])||null}});
 }
 if(!held.size&&!/本日.*開催.*ありません/.test(page.body||''))throw Error('公式開催一覧の構造を確認できません');
 return Array.from({length:24},(_,i)=>{const code=String(i+1).padStart(2,'0');return held.get(code)||{code,meeting_status:'NO_MEETING',meeting:{}};});
}
