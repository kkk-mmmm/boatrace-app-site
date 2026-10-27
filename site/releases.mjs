import fs from 'node:fs';
import {escape} from './public/view.mjs';
export function validateReleases(data) {
  if(data?.schema_version!==1||!Array.isArray(data.releases)||!data.releases.length)throw Error('リリース履歴がありません');
  const versions=new Set();let previous=null;
  for(const r of data.releases){
    if(!/^\d+\.\d+\.\d+$/.test(r.version)||versions.has(r.version)||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)
      ||!Number.isFinite(Date.parse(r.date))||new Date(r.date).toISOString().slice(0,10)!==r.date
      ||r.notes!==undefined&&!Array.isArray(r.notes)||typeof r.title!=='string'||!r.title.trim()||!Array.isArray(r.changes)||!r.changes.length
      ||[...r.changes,...r.notes||[]].some(x=>typeof x!=='string'||!x.trim())
      ||r.commit&&!/^[a-f0-9]{7,40}$/.test(r.commit))throw Error('リリース履歴の版・日付・内容が不正です');
    if(previous){const a=previous.version.split('.').map(Number),b=r.version.split('.').map(Number);const i=a.findIndex((v,j)=>v!==b[j]);if(i<0||a[i]<b[i]||previous.date<r.date)throw Error('リリース履歴は新しい版から並べてください');}
    versions.add(r.version);previous=r;
  }
  return data;
}
export function readReleases(file=new URL('./releases.json',import.meta.url)){return validateReleases(JSON.parse(fs.readFileSync(file,'utf8')));}
const displayReleaseText=text=>escape(text.replaceAll('（日本時間）','').replaceAll('日本時間の','').replaceAll('日本時間',''));
export function renderReleases(data=readReleases()) {
  validateReleases(data);
  return `<p class="release-summary">現在のサイト版 <strong>v${escape(data.releases[0].version)}</strong> / 更新日 <time datetime="${escape(data.releases[0].date)}">${escape(data.releases[0].date)}</time></p><p class="small-note">サイトの版番号は予想モデルのv1〜v3とは別です。v1.0.0〜v1.4.1は公開コミットを基に整理し、後から付けた表示用の版番号です。履歴は新しい順に追記します。</p><div class="release-list">${data.releases.map((r,i)=>`<article class="release-card" id="release-${escape(r.version.replaceAll('.','-'))}"><div class="release-meta"><span class="pill">v${escape(r.version)}</span><time datetime="${escape(r.date)}">${escape(r.date)}</time>${i===0?'<span class="release-latest">最新</span>':''}</div><h3>${displayReleaseText(r.title)}</h3><ul>${r.changes.map(x=>`<li>${displayReleaseText(x)}</li>`).join('')}</ul>${r.notes?`<div class="release-notes">${r.notes.map(x=>`<p>${displayReleaseText(x)}</p>`).join('')}</div>`:''}${r.commit?`<a class="source-link" href="https://github.com/kkk-mmmm/boatrace-app-site/commit/${escape(r.commit)}" target="_blank" rel="noopener noreferrer">変更元の公開コミット ↗</a>`:''}</article>`).join('')}</div>`;
}
