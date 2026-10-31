import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {informationPages,informationTemplate,contact} from './info-pages.mjs';
import {seoPage,writeSeoPages,branding} from './seo.mjs';import {venues} from '../tools/prerace/venues.mjs';
const template=fs.readFileSync(new URL('./public/index.html',import.meta.url),'utf8'),now=Date.parse('2030-01-01T01:00:00Z');
test('全33ページに自己canonical・場名タイトル・OGP・CSPで許可した構造化データを出力する',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'funeyomi-seo-'));try{writeSeoPages(dir,template,[],now);const sitemap=fs.readFileSync(path.join(dir,'sitemap.xml'),'utf8');assert.equal((sitemap.match(/<loc>/g)||[]).length,33);assert.match(fs.readFileSync(path.join(dir,'robots.txt'),'utf8'),/Content-Signal: ai-train=no, search=yes, ai-input=no/);if(new URL(branding.base_url).pathname==='/'){assert.ok(fs.readFileSync(path.join(dir,'robots.txt'),'utf8').includes(new URL('sitemap.xml',branding.base_url).href));assert.equal(fs.readFileSync(path.join(dir,'CNAME'),'utf8').trim(),new URL(branding.base_url).hostname);}
 for(const venue of [null,...venues]){const html=fs.readFileSync(path.join(dir,venue?`venues/${venue.code}/index.html`:'index.html'),'utf8'),canonical=new URL(venue?`venues/${venue.code}/`:'',branding.base_url).href;
 assert.ok(html.includes(`<link rel="canonical" href="${canonical}">`));assert.ok(html.includes(`property="og:url" content="${canonical}"`));assert.ok(html.includes('AI予想'));assert.ok(html.includes('競艇'));assert.ok(html.includes('フネヨミ'));assert.equal((html.match(/<h1\b/g)||[]).length,1);
 assert.doesNotMatch(html,/日本時間/);
 const ld=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];assert.equal(JSON.parse(ld)['@context'],'https://schema.org');assert.ok(html.includes('sha256-'+crypto.createHash('sha256').update(ld).digest('base64')));
 if(venue){assert.ok(html.includes(`${venue.name}のボートレース`));assert.ok(html.includes('<base href="../../">'));assert.ok(html.includes('data-venue="'+venue.code+'"'));assert.ok(html.includes('取得待ち'));}
 }
 const daily=fs.readFileSync(path.join(dir,'verification/index.html'),'utf8');
 assert.match(daily,/<h1>予想実績<\/h1>/);assert.match(daily,/実際の購入履歴の成績ではありません/);assert.match(daily,/href="\.\/#archive">検証企画・記事/);
 const home=fs.readFileSync(path.join(dir,'index.html'),'utf8');assert.match(home,/id="archive-tab"[^>]*>検証企画・記事/);assert.match(home,/href="\.\/verification\/">予想実績/);assert.match(home,/id="experiments-refresh"/);assert.match(home,/id="experiments-status"[^>]*role="status"/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('静的な場ページの出走情報は鮮度を確認して表示し、欠損時刻を捏造しない',()=>{
 const snapshot={venue_code:'24',date:'2030-01-01',update:{status:'OK',last_success_at:new Date(now).toISOString()},meeting_status:'OPEN',meeting:{title:'テスト開催'},races:[{venue_code:'24',date:'2030-01-01',race_no:1,deadline_at:null,entries:[{lane:1,name:'<img src=x>'}]}]};
 const html=seoPage(template,{venue:venues[23],snapshot,now});assert.match(html,/テスト開催/);assert.match(html,/2030\/01\/01 10:00/);assert.doesNotMatch(html,/（UTC）/);assert.match(html,/未確認/);assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<img src=x>/);
 const old=seoPage(template,{venue:venues[23],snapshot:{...snapshot,date:'2029-12-31'},now});assert.doesNotMatch(old,/テスト開催|src=x/);
});
test('SNS共有画像と各サイズのPNGアイコンが存在し、指定寸法で出力される',()=>{
 for(const [file,w,h] of [['favicon-32.png',32,32],['apple-touch-icon.png',180,180],['icon-192.png',192,192],['icon-512.png',512,512],['social-card.png',1200,630]]){const b=fs.readFileSync(new URL('./public/'+file,import.meta.url));assert.equal(b.readUInt32BE(16),w);assert.equal(b.readUInt32BE(20),h);}
});

test('運営情報とガイドは独立HTML・自己canonicalで公開し、未確認のメールは掲載しない',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'funeyomi-info-'));try{writeSeoPages(dir,template,[],now);
 for(const slug of ['about','guide']){const html=fs.readFileSync(path.join(dir,slug,'index.html'),'utf8');assert.ok(html.includes(`<link rel="canonical" href="${new URL(slug+'/',branding.base_url).href}">`));assert.match(html,/<base href="\.\.\/">/);assert.doesNotMatch(html,/src="\.\/app.mjs"/);assert.equal((html.match(/<h1\b/g)||[]).length,1);assert.ok(html.includes('href="./about/"'));assert.ok(html.includes('href="./guide/"'));const ld=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];assert.ok(html.includes('sha256-'+crypto.createHash('sha256').update(ld).digest('base64')));}
 const about=fs.readFileSync(path.join(dir,'about/index.html'),'utf8');assert.match(about,/フネヨミ運営者/);assert.doesNotMatch(about,/@gmail/);if(!contact.verified){assert.match(about,/準備中/);assert.doesNotMatch(about,/mailto:|@funeyomi/);}
 const guide=fs.readFileSync(path.join(dir,'guide/index.html'),'utf8');assert.match(guide,/推定確率 × 取得時点のオッズ/);assert.match(guide,/120円/);assert.match(guide,/実際の購入や収益の記録ではありません/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('受信確認済みの公開メールだけを案内し、不正なリンクを拒否する',()=>{
 const settings={operator:'フネヨミ運営者',email:'contact@funeyomi.win',verified:false};
 assert.doesNotMatch(informationPages(settings).find(p=>p.slug==='about').content,/mailto:|contact@/);
 assert.match(informationPages({...settings,verified:true}).find(p=>p.slug==='about').content,/mailto:contact@funeyomi.win/);
 assert.throws(()=>informationPages({...settings,email:'x@example.com',verified:true}),/公開用/);
 assert.throws(()=>informationPages({...settings,email:'" onmouseover=alert(1)',verified:true}),/公開用/);
});

test('ヘッダーとその他メニューは全ページで同じ順番を保ち、独立画面からも各機能へ戻れる',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'funeyomi-shared-navigation-'));
 try{writeSeoPages(dir,template,[],now);
  const expected=['今日のレース','検証企画・記事','予想実績','予想の見方','リリースノート','条件別検証','運営情報・お問い合わせ'];
  for(const route of ['',...venues.map(v=>`venues/${v.code}/`),...informationPages().map(p=>p.slug+'/')]){
   const html=fs.readFileSync(path.join(dir,route,'index.html'),'utf8'),header=html.match(/<header[\s\S]*?<\/header>/)[0],nav=header.match(/<nav aria-label="メイン">([\s\S]*?)<\/nav>/)[1];
   assert.deepEqual([...nav.matchAll(/<(?:a|button)\b[^>]*>([^<]+)<\/(?:a|button)>/g)].map(m=>m[1]),expected,route||'home');
   if(informationPages().some(p=>route===p.slug+'/')){assert.equal(nav.includes('<button'),false);for(const href of ['./','./#archive','./#releases','./verification/'])assert.ok(nav.includes(`href="${href}"`));}
   if(route==='verification/')assert.match(nav,/href="\.\/verification\/" aria-current="page"/);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('検索向けサイト名・略称を保持し、ホームは今日のレースを単一見出しにする',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'funeyomi-site-name-'));
 try{
  writeSeoPages(dir,template,[],now);
  assert.equal(branding.name,'フネヨミ | ボートレース予想とオッズ');
  for(const route of ['',...venues.map(v=>`venues/${v.code}/`),...informationPages().map(p=>p.slug+'/')]){
   const html=fs.readFileSync(path.join(dir,route,'index.html'),'utf8');
   const graph=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
   const websites=graph.filter(n=>n['@type']==='WebSite');
   assert.equal(websites.length,route?0:1,route||'home');
   assert.ok(html.includes(`property="og:site_name" content="${branding.name}"`));
   const svg=html.match(/<link rel="icon" href="([^"]+)" type="image\/svg\+xml">/)[1];
   assert.equal(svg,html.match(/class="brand-icon" src="([^"]+)"/)[1]);
   assert.ok(html.includes('<link rel="icon" href="./icon-192.png" sizes="192x192" type="image/png">'));
   if(!route){assert.equal(websites[0].name,branding.name);assert.equal(websites[0].url,branding.base_url);assert.ok(websites[0].alternateName.includes('フネヨミ'));assert.ok(html.includes(`<title>${branding.name}</title>`));assert.ok(html.includes('<h1 class="seo-page-title">今日のレース</h1>'));}
  }
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'site.webmanifest')));assert.equal(manifest.name,branding.name);assert.equal(manifest.short_name,'フネヨミ');
  const robots=fs.readFileSync(path.join(dir,'robots.txt'),'utf8');assert.match(robots,/User-agent: \*\nContent-Signal: ai-train=no, search=yes, ai-input=no\nAllow: \//);assert.doesNotMatch(robots,/Disallow:/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('初期HTMLの予想は公開時点の鮮度・締切を確認し、古いオッズや欠場は表示しない',async()=>{
 const {staticPredictions,venueHistory}=await import('./venue-seo.mjs');const venue=venues[0],race={date:'2030-01-01',venue_code:'01',race_no:1,deadline_at:new Date(now+600000).toISOString(),items:[{combo:'1-2-3',probability:.2}],odds:{fetched_at:new Date(now).toISOString(),recorded_at:new Date(now).toISOString(),classification:'PRERACE_ODDS_LOCAL_RECORD_UNVERIFIED',items:[{combo:'1-2-3',odds:100}]}};
 const snapshot={date:race.date,venue_code:'01',meeting_status:'OPEN',update:{status:'OK'},races:[race]};let html=staticPredictions(snapshot,venue,now);assert.match(html,/20.0%/);assert.match(html,/100.0倍/);assert.match(html,/20.000倍/);
 for(const changed of [{...race,deadline_at:new Date(now-1).toISOString()},{...race,odds:{...race.odds,fetched_at:new Date(now-700000).toISOString()}}])assert.doesNotMatch(staticPredictions({...snapshot,races:[changed]},venue,now),/100.0倍|20.000倍/);
 assert.doesNotMatch(staticPredictions({...snapshot,races:[{...race,entries:[{participation_status:'WITHDRAWN'}]}]},venue,now),/20.0%/);
 const stats=(n,w)=>[n,w,0,0,0,0,0,0,0,[Math.floor(w/2),0,0,0,0,0]],model={trained_from:'2029-01-01',trained_through:'2029-12-31',profiles:{venues:{'01':Object.fromEntries([1,2,3,4,5,6].map(l=>['l'+l,stats(100,l===1?60:8)]))},population:{l1:stats(1000,500)}}};html=venueHistory(venue,model,now);assert.match(html,/60.0%/);assert.match(html,/30.0%/);assert.match(html,/10.0ポイント高く/);assert.match(html,/100走/);assert.match(html,/2029-12-31/);assert.match(venueHistory(venue,{...model,trained_through:'2030-01-01'},now),/未集計/);
});

test('初期HTMLだけで出走表と展示の欠損・進入変化を確認でき、リンクは場ページ内を指す',async()=>{
 const {staticPredictions,staticRaceDetails}=await import('./venue-seo.mjs');const entries=Array.from({length:6},(_,i)=>({lane:i+1,name:i===0?'<script>選手':'選手'+i,class:'A1',national_win_rate:6.5,motor_2rate:40,avg_st:.15,exhibition_time:i===0?null:6.8,exhibition_st:i===0?-.02:.12,exhibition_st_status:i===0?'F':'NORMAL',exhibition_course:i===0?2:i===1?1:i+1}));
 const r={date:'2030-01-01',venue_code:'01',race_no:1,deadline_at:new Date(now+1200000).toISOString(),entries,items:[]};const html=staticRaceDetails(r,now);for(const text of ['全国勝率','モーター2連率','6.50','6.80','F0.02','進入変化あり','未取得','&lt;script&gt;'])assert.ok(html.includes(text),text);assert.doesNotMatch(html,/<script>|\b\d{1,2}:\d{2}:\d{2}\b/);
 const snapshot={date:r.date,venue_code:'01',meeting_status:'OPEN',update:{status:'OK',last_success_at:new Date(now).toISOString()},races:[r]};const page=seoPage(template,{venue:venues[0],snapshot,now});assert.match(page,/id="venue-race-1"/);assert.match(page,/href="\.\/venues\/01\/\?race=1#live-view"/);assert.match(page,/href="\.\/venues\/01\/#venue-overview"/);assert.match(page,/出走表・展示情報を確認/);
 const old=seoPage(template,{venue:venues[0],snapshot:{...snapshot,date:'2029-12-31'},now});assert.doesNotMatch(old,/id="venue-race-1"|F0.02/);
});

test('決まり手は出走数を分母に集計し、未確認・少数例・期間の異常を補わない',async()=>{
 const {venueStyleRows,venueStylesHTML}=await import('./venue-styles.mjs');const make=(n,w,styles)=>[n,w,0,0,0,0,0,0,0,styles],model={trained_from:'2029-01-01',trained_through:'2029-12-31',profiles:{venues:{'01':{l1:make(100,60,[50,2,2,2,1,1]),l2:make(200,20,[0,10,4,4,0,0]),l3:make(50,10,[0,8,1,1,0,0])}}}};
 const rows=venueStyleRows(venues[0],model,now);assert.equal(rows.length,3);assert.equal(rows[1].unknown,2);const html=venueStylesHTML(venues[0],model,now);assert.match(html,/10件 \/ 5.0%/);assert.match(html,/出走100件以上/);assert.match(html,/2枠（10件 \/ 200走、5.0%）/);assert.doesNotMatch(html,/3枠（8件/);assert.match(html,/決まり手未確認/);
 const invalid=structuredClone(model);invalid.profiles.venues['01'].l2[9]=[0,21,0,0,0,0];assert.ok(!venueStyleRows(venues[0],invalid,now).some(r=>r.lane===2));assert.match(venueStylesHTML(venues[0],{...model,trained_through:'2030-01-01'},now),/未集計/);
 const allMissing=seoPage(template,{venue:venues[0],now});assert.match(allMissing,/id="venue-styles"/);const guide=informationPages().find(p=>p.slug==='guide');assert.match(guide.content,/id="race-styles"/);assert.match(guide.content,/venues\/24\/#venue-styles/);
 const history=(await import('./venue-seo.mjs')).venueHistory(venues[0],{...model,profiles:{...model.profiles,venues:{'01':Object.fromEntries([1,2,3,4,5,6].map(l=>['l'+l,make(100,10,[1,2,2,2,1,1])]))},population:{l1:make(100,50,[40,2,2,2,2,2])}}},now);assert.match(history,/strategies\/\?venue=01/);assert.match(history,/guide\/#race-styles/);
});

test('解説記事は独立URL・Article構造化データ・相互リンクを持ち、例と実績を区別する',()=>{
 const pages=informationPages();for(const slug of ['expected-value','exhibition-st']){const page=pages.find(p=>p.slug===slug),html=seoPage(informationTemplate(template,page),{page,now});assert.match(html,new RegExp('https://funeyomi.win/'+slug+'/'));const graph=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];assert.ok(graph.some(n=>n['@type']==='Article'&&n.author.name==='フネヨミ運営者'));assert.match(html,/href="\.\/venues\/24\/#venue-predictions"/);}
 const ev=pages.find(p=>p.slug==='expected-value').content;for(const text of ['0.02×80','0.5倍','8,000円','800%','400%','過去の実績ではありません'])assert.ok(ev.includes(text),text);
 const st=pages.find(p=>p.slug==='exhibition-st').content;assert.match(st,/本番F・Lを除外/);assert.match(st,/補正モデルの予測誤差や改善率ではありません|現在の集計値は未掲載/);
});

test('展示STの集計は件数で重み付けし、分散・欠損・未来期間を検証する',async()=>{
 const {exhibitionEvidence,articlePages}=await import('./articles.mjs');const profile={kind:'EXHIBITION_ST_PAIRED_HISTORY',window_from:'2029-01-01',through:'2029-12-31',races:2,paired_starts:4,players:{a:{n:1,sum:.1,sum_squares:.01,from:'2029-12-01',through:'2029-12-01'},b:{n:3,sum:.9,sum_squares:.27,from:'2029-12-02',through:'2029-12-03'}}};const before=JSON.stringify(profile),s=exhibitionEvidence(profile,now);assert.ok(Math.abs(s.mean-.25)<1e-12);assert.ok(Math.abs(s.rmse-Math.sqrt(.07))<1e-12);assert.ok(Math.abs(s.sd-Math.sqrt(.0075))<1e-12);assert.equal(s.n,4);assert.equal(s.from,'2029-12-01');assert.equal(s.through,'2029-12-03');assert.equal(JSON.stringify(profile),before);
 for(const p of [{...profile,paired_starts:5},{...profile,through:'2030-01-01'},{...profile,players:{a:{...profile.players.a,sum_squares:0}}}])assert.equal(exhibitionEvidence(p,now),null);
 assert.match(articlePages(null,now).find(p=>p.slug==='exhibition-st').content,/未掲載/);assert.match(articlePages(profile,now).find(p=>p.slug==='exhibition-st').content,/\+0.250秒/);
});

test('本文への移動先と独立ページの主要メニュー選択状態を保持する',()=>{
 for(const [slug,href] of [['verification','./verification/'],['strategies','./verification/'],['guide','./guide/'],['expected-value','./guide/'],['conditional-forecast-review','./#archive']]){
  const page=informationPages().find(p=>p.slug===slug),html=informationTemplate(template,page);
  assert.ok(html.includes(`href="./${slug}/#main-content"`));assert.match(html,/<main id="main-content">/);
  const header=html.match(/<header[\s\S]*?<\/header>/)[0];
  assert.ok(header.includes(`href="${href}" aria-current="page"`),slug);
  assert.doesNotMatch(html,/締切と予想を、ひと目で。/);
 }
});
