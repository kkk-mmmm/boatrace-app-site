export function wantsMarkdown(accept='') {
 const types=accept.toLowerCase().split(',').map(part=>{const [type,...params]=part.trim().split(';');const q=params.find(p=>p.trim().startsWith('q='));return {type,q:q?Number(q.trim().slice(2)):1};});
 const quality=type=>Math.max(0,...types.filter(t=>t.type===type&&Number.isFinite(t.q)&&t.q<=1).map(t=>t.q));
 return quality('text/markdown')>0&&quality('text/markdown')>=quality('text/html');
}
const pagePath=p=>p==='/'||/^\/(?:about|guide|verification|strategies|expected-value|exhibition-st|conditional-forecast-review)\/$/.test(p)||/^\/venues\/(?:0[1-9]|1\d|2[0-4])\/$/.test(p);
const vary=value=>[...new Set((value||'').split(',').map(s=>s.trim()).filter(Boolean).concat('Accept'))].join(', ');
const decode=s=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(all,key)=>{if(key[0]==='#'){const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):all;}return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[key.toLowerCase()];});
export async function convert(response,url){
 let base=url;
 const transformed=new HTMLRewriter()
 .on('base',{element(e){try{base=new URL(e.getAttribute('href'),url).href;}catch{} }})
 .on('head,script,style,nav,header,footer,button,select,canvas,svg,[hidden]',{element(e){e.remove();}})
 .on('h1,h2,h3,h4,h5,h6',{element(e){e.before('\n\n'+'#'.repeat(Number(e.tagName[1]))+' ');e.after('\n\n');}})
 .on('p,section,article,details,div,table,tr',{element(e){e.before('\n');e.after('\n');}})
 .on('li',{element(e){e.before('\n- ');}})
 .on('br',{element(e){e.replace('\n');}})
 .on('th,td',{element(e){e.after(' | ');}})
 .on('a[href]',{element(e){try{const href=new URL(e.getAttribute('href'),base);if(['https:','http:','mailto:'].includes(href.protocol)){e.before('[');e.after(']('+href.href+')');}}catch{}}})
 .transform(response);
 // The streaming HTML parser removes executable and navigation elements before stripping remaining tags.
 const text=decode((await transformed.text()).replace(/<[^>]*>/g,''));
 return `<!-- 静的HTMLのMarkdown表現。JavaScriptで取得する最新オッズ等は含みません。 -->\n\n元ページ: ${url}\n\n`+text.replace(/[\t ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim()+'\n';
}
export async function handle(request,originFetch=fetch){
 const url=new URL(request.url);
 if(!['GET','HEAD'].includes(request.method)||!pagePath(url.pathname))return originFetch(request);
 const markdown=wantsMarkdown(request.headers.get('Accept')||'');
 const upstream=new Request(request);upstream.headers.set('Accept','text/html');
 // Never forward HTML validators for a different representation.
 if(markdown){upstream.headers.delete('If-None-Match');upstream.headers.delete('If-Modified-Since');upstream.headers.delete('Range');}
 const response=await originFetch(upstream);
 if(response.status!==200||!response.headers.get('Content-Type')?.includes('text/html'))return response;
 const headers=new Headers(response.headers);headers.set('Vary',vary(headers.get('Vary')));
 if(!markdown)return new Response(response.body,{status:response.status,headers});
 const body=request.method==='HEAD'?null:await convert(response,url.href);
 for(const key of ['Content-Length','Content-Encoding','ETag','Last-Modified','Content-Security-Policy','Content-Range','Accept-Ranges'])headers.delete(key);
 headers.set('Content-Type','text/markdown; charset=utf-8');headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');
 return new Response(body,{status:200,headers});
}
export default {fetch(request){return handle(request);}};
