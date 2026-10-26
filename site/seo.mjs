import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {escape,japanDate} from './public/view.mjs';
import {venues} from '../tools/prerace/venues.mjs';
export const branding=JSON.parse(fs.readFileSync(new URL('./branding.json',import.meta.url)));
const url=p=>new URL(p,branding.base_url).href;
export function seoPage(html,{venue=null,snapshot=null,now=Date.now()}={}){
 const prefix=venue?`${venue.name}の`:'';
 const title=`${prefix}ボートレース・競艇のAI予想とオッズ | ${branding.name}`;
 const description=`${branding.name}で${venue?venue.name+'の':'全国24場の'}ボートレース・競艇予想を確認。過去1年の選手・場別データを学習した統計モデルによるAI予想、3連単オッズ、展示情報、確定結果と保存予想の比較を掲載。取得時刻・締切・更新状態も確認できます。`;
 const canonical=url(venue?`venues/${venue.code}/`:''),image=url('social-card.png');
 const graph=[{'@type':'WebSite','@id':url('#website'),url:branding.base_url,name:branding.name,alternateName:branding.name+'｜'+branding.tagline,inLanguage:'ja'}, {'@type':'WebPage','@id':canonical+'#page',url:canonical,name:title,description,inLanguage:'ja',isPartOf:{'@id':url('#website')}}];
 if(venue)graph.push({'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:branding.name,item:branding.base_url},{'@type':'ListItem',position:2,name:venue.name+'の予想',item:canonical}]});
 const ld=JSON.stringify({'@context':'https://schema.org','@graph':graph}).replaceAll('<','\\u003c');
 const hash=crypto.createHash('sha256').update(ld).digest('base64');
 const meta=`<meta name="application-name" content="${escape(branding.name)}"><meta name="theme-color" content="${branding.theme_color}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${canonical}"><link rel="icon" href="./favicon.svg" type="image/svg+xml"><link rel="icon" href="./favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="./apple-touch-icon.png" sizes="180x180"><link rel="manifest" href="./site.webmanifest"><meta property="og:type" content="website"><meta property="og:locale" content="ja_JP"><meta property="og:site_name" content="${escape(branding.name)}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${image}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="フネヨミ｜ボートレース・競艇のAI予想"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="${image}"><script type="application/ld+json">${ld}</script>`;
 html=html.replace(/<title>.*?<\/title>/,()=>`<title>${escape(title)}</title>`).replace(/<meta name="description" content="[^"]*">/,()=>`<meta name="description" content="${escape(description)}">`).replace('</head>',meta+'</head>').replace("script-src 'self'",`script-src 'self' 'sha256-${hash}'`);
 html=html.replace('<body>',`<body${venue?` data-venue="${venue.code}"`:''}>`).replace('<main>',`<main><h1 class="seo-page-title">${escape(title)}</h1>`);
 if(venue){html=html.replace('<head>','<head><base href="../../">');const fresh=snapshot?.date===japanDate(now)&&['OK','PARTIAL'].includes(snapshot.update?.status)&&now-Date.parse(snapshot.update.last_success_at)<=600000&&Date.parse(snapshot.update.last_success_at)<=now+60000;
 const rows=fresh?snapshot.races||[]:[];
 const overview=`<section id="venue-overview" class="venue-overview"><h2>${venue.name}のボートレース・競艇予想</h2><p>${venue.name}のAI予想・出走表・展示情報・3連単オッズを確認できるページです。予想は選手のST、着順、決まり手、場別傾向などを使う統計モデルで算出します。</p><h3>${escape(japanDate(now))}の開催情報</h3><p>${fresh?snapshot.meeting_status==='NO_MEETING'?'取得時点で本日は非開催です。':escape(snapshot.meeting?.title||'開催情報を確認中です。'):'最新の開催情報は取得待ちです。'}</p>${rows.length?`<div class="table-wrap"><table><thead><tr><th>レース</th><th>締切予定（日本時間）</th><th>出走選手</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escape(r.race_no)}R</td><td>${Number.isFinite(Date.parse(r.deadline_at))?escape(new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date(r.deadline_at))):'未確認'}</td><td>${(r.entries||[]).map(e=>escape(e.lane+'号艇 '+e.name)).join(' / ')||'取得待ち'}</td></tr>`).join('')}</tbody></table></div>`:''}<p class="small-note">ページ生成時点の記録です。最新の取得状態と予想は上の「今日のレース」で確認してください。${fresh?'取得日時：'+escape(new Date(snapshot.update.last_success_at).toISOString())+'（UTC）':''}</p></section>`;
 html=html.replace('</main>',overview+'</main>');}
 return html;
}
export function writeSeoPages(directory,html,snapshots,now){
 fs.writeFileSync(path.join(directory,'index.html'),seoPage(html,{now}));
 for(const venue of venues){const dir=path.join(directory,'venues',venue.code);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'index.html'),seoPage(html,{venue,snapshot:snapshots.find(s=>s.venue_code===venue.code),now}));}
 fs.writeFileSync(path.join(directory,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+['',...venues.map(v=>`venues/${v.code}/`)].map(p=>`<url><loc>${url(p)}</loc></url>`).join('')+'</urlset>');
 fs.writeFileSync(path.join(directory,'site.webmanifest'),JSON.stringify({name:branding.name+'｜'+branding.tagline,short_name:branding.name,lang:'ja',start_url:branding.base_url,scope:new URL(branding.base_url).pathname,display:'browser',theme_color:branding.theme_color,background_color:'#f3faff',icons:[{src:url('icon-192.png'),sizes:'192x192',type:'image/png'},{src:url('icon-512.png'),sizes:'512x512',type:'image/png'}]}));
}
