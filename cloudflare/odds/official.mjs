export const OFFICIAL_ORIGIN='https://www.boatrace.jp';
export const USER_AGENT='boatrace-app/0.2 (+https://github.com/kkk-mmmm/boatrace-app-site)';
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
const normalized=value=>value.normalize('NFKC').replace(/&nbsp;|&#160;/g,' ').trim();

export function officialUrl(race) {
  const url=new URL('/owpc/pc/race/odds3t',OFFICIAL_ORIGIN);
  url.search=new URLSearchParams({hd:race.date.replaceAll('-',''),jcd:race.venue_code,rno:String(race.race_no)});
  return url.href;
}

export function robotsAllowed(text, url) {
  const groups=[];let group=null,hasRules=false;
  for(const line of text.split(/\r?\n/)) {
    const match=/^\s*([\w-]+)\s*:\s*(.*?)\s*$/.exec(line.replace(/#.*/,''));
    if(!match)continue;
    const key=match[1].toLowerCase(),value=match[2].toLowerCase();
    if(key==='user-agent') {
      if(!group || hasRules){group={agents:[],rules:[]};groups.push(group);hasRules=false;}
      group.agents.push(value);
    } else if(group && ['allow','disallow'].includes(key)) {
      hasRules=true;if(match[2])group.rules.push({allow:key==='allow',pattern:match[2]});
    }
  }
  const specific=groups.filter(g=>g.agents.some(a=>a!=='*' && USER_AGENT.toLowerCase().includes(a)));
  const applicable=specific.length?specific:groups.filter(g=>g.agents.includes('*'));
  if(!groups.length) return false;
  const target=new URL(url),path=target.pathname+target.search;let best=null;
  for(const rule of applicable.flatMap(g=>g.rules)) {
    const end=rule.pattern.endsWith('$');
    const pattern=(end?rule.pattern.slice(0,-1):rule.pattern).split('*').map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');
    if(new RegExp('^'+pattern+(end?'$':'')).test(path) && (!best || rule.pattern.length>best.pattern.length
      || rule.pattern.length===best.pattern.length && rule.allow))best=rule;
  }
  return !best || best.allow;
}

export function parseOddsTables(tables, text='') {
  const candidates=tables.filter(t=>t.rows.some(row=>row.some(c=>/\boddsPoint\b/.test(c.attrs.class || ''))));
  if(!candidates.length) {
    if(/データ[はが]ありません/.test(text))return [];
    throw Error('3連単オッズの構造を確認できません');
  }
  requireValue(candidates.length===1 && candidates[0].rows.length===21,'3連単オッズの行数が不正です');
  const rows=candidates[0].rows;
  requireValue(rows[0].filter((_,i)=>i%2===0).map(c=>normalized(c.text)).join(',')==='1,2,3,4,5,6','3連単の1着の並びが違います');
  let spans=new Map();const result=[],seen=new Set();
  for(const raw of rows.slice(1)) {
    const cells=new Map(),next=new Map();
    for(const [col,{cell,left}] of spans){cells.set(col,cell);if(left>1)next.set(col,{cell,left:left-1});}
    let col=0;
    for(const cell of raw) {
      while(cells.has(col))col++;
      requireValue(!cell.attrs.colspan || cell.attrs.colspan==='1','3連単オッズの列構造が変わっています');
      const span=Number(cell.attrs.rowspan || 1);
      requireValue(Number.isInteger(span) && span>=1 && span<=20,'3連単オッズのrowspanが不正です');
      cells.set(col,cell);if(span>1)next.set(col,{cell,left:span-1});col++;
    }
    requireValue(cells.size===18 && [...cells.keys()].every(k=>k<18),'3連単オッズの列数が違います');
    for(let first=1;first<=6;first++) {
      const offset=(first-1)*3,second=normalized(cells.get(offset).text),third=normalized(cells.get(offset+1).text);
      requireValue(/^[1-6]$/.test(second) && /^[1-6]$/.test(third) && new Set([String(first),second,third]).size===3,'オッズの艇番が不正です');
      const combo=`${first}-${second}-${third}`;requireValue(!seen.has(combo),'買い目が重複しています');seen.add(combo);
      const rawValue=normalized(cells.get(offset+2).text).replaceAll(',','');
      if(!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(rawValue))continue;
      const odds=Number(rawValue);if(odds===0)continue;
      requireValue(Number.isFinite(odds) && odds>=1,'オッズ倍率が不正です');result.push({combo,odds});
    }
    spans=next;
  }
  requireValue(seen.size===120 && spans.size===0,'120通りの構造を確認できません');
  return result;
}

export async function parseOfficialHtml(html) {
  const tables=[],stack=[];let row=null,cell=null,text='';
  const transformed=new HTMLRewriter()
    .on('table',{element(el){const table={rows:[]};tables.push(table);stack.push(table);el.onEndTag(()=>stack.pop());}})
    .on('tr',{element(el){if(stack.length){row=[];stack.at(-1).rows.push(row);el.onEndTag(()=>{row=null;});}}})
    .on('td, th',{element(el){if(row){cell={attrs:Object.fromEntries(el.attributes),text:''};row.push(cell);el.onEndTag(()=>{cell=null;});}},
      text(chunk){if(cell)cell.text+=chunk.text;}})
    .on('br',{element(){if(cell)cell.text+='\n';}})
    .on('body',{text(chunk){text+=chunk.text;}})
    .transform(new Response(html, {headers:{'Content-Type':'text/html; charset=utf-8'}}));
  await transformed.arrayBuffer();
  return parseOddsTables(tables,text);
}

export async function fetchText(url, fetcher=fetch, maxBytes=3*1024*1024) {
  const response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'User-Agent':USER_AGENT},cache:'no-store'});
  requireValue(response.ok,'取得先のHTTPエラー: '+response.status);
  requireValue(!response.url || response.url===url,'取得対象外の応答です');
  const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text='';
  try {
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
      requireValue(bytes<=maxBytes,'取得した応答が大きすぎます');text+=decoder.decode(value,{stream:true});}
    return text+decoder.decode();
  } finally {await reader.cancel().catch(()=>{});}
}
