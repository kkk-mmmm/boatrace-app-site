import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {programEntries,programDeadlines,programExhibition,dataActions,programResult,resultDue} from './program.mjs';
const file=new URL('../../tools/site/fixtures/other-venue-20261021.json',import.meta.url);
test('Workers用出走表・展示の正規化を公式資料と照合する',()=>{
 if(!fs.existsSync(file))return;
 const pages=JSON.parse(fs.readFileSync(file)).pages,entries=programEntries(pages.find(p=>p.url.includes('racelist?')));
 assert.equal(entries.length,6);assert.ok(entries.every(e=>/^\d{4}$/.test(e.racer_id)));assert.equal(programDeadlines(pages.find(p=>p.url.includes('racelist?')),'2026-10-21').length,12);
 assert.deepEqual(programExhibition({tables:[]}),[]);
});
test('朝・30分前・15分前・未提供時5分前の更新だけを起動する',()=>{
 const now=Date.now(),deadline=new Date(now+3600000).toISOString();assert.deepEqual(dataActions(null,deadline,now),{entries:true,exhibition:false});
 const p={entries:Array.from({length:6},(_,i)=>({exhibition_time:6.7,exhibition_st:.1,exhibition_course:i+1})),entries_30m_done:false};assert.equal(dataActions(p,new Date(now+1800000).toISOString(),now).entries,true);
 p.entries_30m_done=true;assert.equal(dataActions(p,new Date(now+900001).toISOString(),now).exhibition,false);assert.deepEqual(dataActions(p,new Date(now+900000).toISOString(),now),{entries:false,exhibition:true});
 p.exhibition_10m_done=true;p.exhibition_available=true;assert.deepEqual(dataActions(p,new Date(now+300000).toISOString(),now),{entries:false,exhibition:false});
 p.exhibition_available=false;assert.equal(dataActions(p,new Date(now+300000).toISOString(),now).exhibition,true);
 assert.deepEqual(dataActions(p,new Date(now).toISOString(),now),{entries:false,exhibition:false});
});

test('15分前の失敗は完了扱いにせず、1分以内の再取得を抑えて再試行する',()=>{
 const now=Date.parse('2030-01-01T00:00:00Z'),deadline=new Date(now+900000).toISOString(),p={entries:[{}],entries_30m_done:true,exhibition_last_attempt:new Date(now).toISOString()};
 assert.equal(dataActions(p,deadline,now).exhibition,false);assert.equal(dataActions(p,deadline,now+60000).exhibition,true);
});
test('欠場の公式クラスと進入・展示STを区別し、ST未提供を0として返さない',()=>{
 const rows=Array.from({length:6},(_,i)=>[{attrs:{rowspan:'4',class:'is-boatColor'+(i+1),tbody_class:i===5?'is-miss':''},text:String(i+1)},...Array.from({length:4},(_,j)=>({attrs:{},text:j===3?'6.70':''}))]);
 const start={rows:[[{text:'スタート展示'}],[{text:'コース'}],...[3,1,2,4,5].map(n=>[{text:n+' F.03'}]),[{text:''}]]};
 const data=programExhibition({tables:[{rows},start]});assert.equal(data[2].exhibition_course,1);assert.equal(data[0].exhibition_st,-.03);assert.equal(data[5].participation_status,'WITHDRAWN');assert.equal(data[5].exhibition_st,null);
 const missing=programExhibition({tables:[{rows}]});assert.equal(missing[0].exhibition_st,null);assert.equal(missing[0].exhibition_time,6.7);
});

test('旧版で展示タイムだけを取得完了にしていた場合も、ST・進入が欠けていれば5分前に再取得する',()=>{
 const now=Date.now(),deadline=new Date(now+300000).toISOString(),p={entries:Array.from({length:6},()=>({exhibition_time:6.7})),entries_30m_done:true,exhibition_10m_done:true,exhibition_available:true};
 assert.equal(dataActions(p,deadline,now).exhibition,true);
 p.exhibition_5m_done=true;assert.equal(dataActions(p,deadline,now).exhibition,true);p.exhibition_issue='HTTP 503';assert.equal(dataActions(p,deadline,now).exhibition,true);
});

test('結果は締切5分後から5分間隔で再試行し、確定後は停止する',()=>{
 const deadline_at='2030-01-01T01:00:00Z',target={deadline_at},end=Date.parse(deadline_at);
 assert.equal(resultDue(target,null,end+299999),false);assert.equal(resultDue(target,null,end+300000),true);
 assert.equal(resultDue(target,{status:'FAILED',attempted_at:new Date(end+300000).toISOString()},end+599999),false);
 assert.equal(resultDue(target,{status:'PENDING',attempted_at:new Date(end+300000).toISOString()},end+600000),true);
 assert.equal(resultDue(target,{status:'CONFIRMED'},end+3600000),false);
 const page=JSON.parse(fs.readFileSync(new URL('../../tools/site/fixtures/official-result-20261023.json',import.meta.url))),result=programResult(page);
 assert.equal(result.entries[0].finish,1);assert.equal(result.entries[0].lane,2);assert.deepEqual(result.payouts,[{combo:'2-1-3',payout_yen_per_100:11160}]);
 const broken=structuredClone(page);const table=broken.tables.find(t=>t.rows[0][0].text.trim()==='着');table.rows[2][1].text='2';assert.throws(()=>programResult(broken),/重複/);
});
