import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {seoPage,writeSeoPages,branding} from './seo.mjs';import {venues} from '../tools/prerace/venues.mjs';
const template=fs.readFileSync(new URL('./public/index.html',import.meta.url),'utf8'),now=Date.parse('2030-01-01T01:00:00Z');
test('全25ページに自己canonical・場名タイトル・OGP・CSPで許可した構造化データを出力する',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'funeyomi-seo-'));try{writeSeoPages(dir,template,[],now);const sitemap=fs.readFileSync(path.join(dir,'sitemap.xml'),'utf8');assert.equal((sitemap.match(/<loc>/g)||[]).length,25);
 for(const venue of [null,...venues]){const html=fs.readFileSync(path.join(dir,venue?`venues/${venue.code}/index.html`:'index.html'),'utf8'),canonical=new URL(venue?`venues/${venue.code}/`:'',branding.base_url).href;
 assert.ok(html.includes(`<link rel="canonical" href="${canonical}">`));assert.ok(html.includes(`property="og:url" content="${canonical}"`));assert.ok(html.includes('AI予想'));assert.ok(html.includes('競艇'));assert.ok(html.includes('フネヨミ'));assert.equal((html.match(/<h1\b/g)||[]).length,1);
 const ld=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];assert.equal(JSON.parse(ld)['@context'],'https://schema.org');assert.ok(html.includes('sha256-'+crypto.createHash('sha256').update(ld).digest('base64')));
 if(venue){assert.ok(html.includes(`${venue.name}のボートレース`));assert.ok(html.includes('<base href="../../">'));assert.ok(html.includes('data-venue="'+venue.code+'"'));assert.ok(html.includes('取得待ち'));}
 }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('静的な場ページの出走情報は鮮度を確認して表示し、欠損時刻を捏造しない',()=>{
 const snapshot={date:'2030-01-01',update:{status:'OK',last_success_at:new Date(now).toISOString()},meeting_status:'OPEN',meeting:{title:'テスト開催'},races:[{race_no:1,deadline_at:null,entries:[{lane:1,name:'<img src=x>'}]}]};
 const html=seoPage(template,{venue:venues[23],snapshot,now});assert.match(html,/テスト開催/);assert.match(html,/2030\/01\/01 10:00:00/);assert.doesNotMatch(html,/（UTC）/);assert.match(html,/未確認/);assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<img src=x>/);
 const old=seoPage(template,{venue:venues[23],snapshot:{...snapshot,date:'2029-12-31'},now});assert.doesNotMatch(old,/テスト開催|src=x/);
});
test('SNS共有画像と各サイズのPNGアイコンが存在し、指定寸法で出力される',()=>{
 for(const [file,w,h] of [['favicon-32.png',32,32],['apple-touch-icon.png',180,180],['icon-192.png',192,192],['icon-512.png',512,512],['social-card.png',1200,630]]){const b=fs.readFileSync(new URL('./public/'+file,import.meta.url));assert.equal(b.readUInt32BE(16),w);assert.equal(b.readUInt32BE(20),h);}
});
