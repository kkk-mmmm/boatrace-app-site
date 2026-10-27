import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {parseTideYear,tideAt,loadTide,tideSource} from './tides.mjs';
const source=fs.readFileSync(new URL('../../tools/site/fixtures/context/jma-tokyo-2026.txt',import.meta.url),'utf8');
test('気象庁の実際の固定長毎時値を読み、欠損・地点違いを拒否し予測と明記する',()=>{
 const day=parseTideYear(source,'2026-01-01','TK');assert.equal(day.hours.length,24);assert.equal(day.hours[0],87);assert.equal(day.hours[1],119);
 const tide=tideAt(day,'2026-01-01T00:30:00+09:00',{name:'東京',source_url:tideSource('TK',2026),fetched_at:'2025-12-31T12:00:00Z'});assert.equal(tide.height_cm,103);assert.equal(tide.kind,'PREDICTED_REFERENCE');assert.equal(tide.trend,'RISING');assert.ok(tide.high_tides.length>0);
 assert.throws(()=>parseTideYear(source,'2026-01-01','QA'));assert.throws(()=>parseTideYear(source.replace(/^ 87/,'999'),'2026-01-01','TK'));assert.throws(()=>tideSource('../bad',2026));
});
test('地点ごとに1日1回の共有取得を使い、未対応場を別の海の水位で埋めない',async()=>{
 const data=new Map(),storage={get:async k=>data.get(k),put:async(k,v)=>data.set(k,v)};let requests=0;
 const get=async()=>{requests++;await new Promise(resolve=>setTimeout(resolve,10));return source;};
 await Promise.all([loadTide(storage,'03','2026-01-01','2026-01-01T12:00:00+09:00',get),loadTide(storage,'04','2026-01-01','2026-01-01T13:00:00+09:00',get)]);assert.equal(requests,1);
 assert.equal((await loadTide(storage,'24','2026-01-01','2026-01-01T12:00:00+09:00',get)).status,'UNMAPPED');assert.equal((await loadTide(storage,'01','2026-01-01','2026-01-01T12:00:00+09:00',get)).status,'NOT_APPLICABLE');
});
