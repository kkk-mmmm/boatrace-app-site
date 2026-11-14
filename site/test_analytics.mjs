import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./public/analytics.js',import.meta.url),'utf8');
function setup(){
 const listeners={},window={},scripts=[];
 const document={baseURI:'https://funeyomi.win/',body:{dataset:{}},head:{appendChild:x=>scripts.push(x)},createElement:()=>({}),querySelector:s=>s==='#venue-select'?{value:'01'}:{dataset:{race:'3'}},addEventListener:(name,fn,capture)=>{assert.equal(capture,true);(listeners[name]??=[]).push(fn);}};
 const ctx=vm.createContext({window,document,location:{href:'https://funeyomi.win/',origin:'https://funeyomi.win'},URL,Date});vm.runInContext(source,ctx);
 const node=(v={})=>Object.assign({id:'',tagName:'BUTTON',dataset:{},textContent:'テスト',getAttribute(k){return k==='href'?this.href:null;},closest(s){return s==='a,button'||s==='#live-content'?this:null;}},v);
 const fire=(n,type='click',extra={})=>listeners[type].forEach(f=>f({target:type==='click'?{closest:()=>n}:n,button:0,...extra}));
 return {node,fire,scripts,ctx,events:()=>JSON.parse(JSON.stringify(window.dataLayer.filter(x=>x.event==='content_click')))};
}
test('再初期化・動的な子要素クリックでも1操作1通知',()=>{const h=setup();vm.runInContext(source,h.ctx);h.fire(h.node({dataset:{race:'8'}}));assert.equal(h.events().length,1);assert.equal(h.events()[0].content_id,'race_01_8');assert.equal(h.scripts.length,1);});
test('開催場・select・締切カードを識別',()=>{const h=setup();h.fire(h.node({dataset:{venueResult:'24'}}));h.fire(h.node({id:'venue-select',value:'03'}),'change');h.fire(h.node({dataset:{upcomingVenue:'02',upcomingRace:'12'}}));assert.deepEqual(h.events().map(x=>x.content_id),['venue_24','venue_03','race_02_12']);});
test('タブ切替を識別',()=>{const h=setup();for(const id of ['probability-tab','value-tab','development-tab'])h.fire(h.node({id}));assert.deepEqual(h.events().map(x=>x.content_name),['推定確率順','期待値上位','展開予想']);});
test('再生と停止は操作時点で識別',()=>{const h=setup();h.fire(h.node({id:'development-pause',textContent:'再生する'}));h.fire(h.node({id:'development-pause',textContent:'一時停止'}));h.fire(h.node({id:'development-replay'}));assert.deepEqual(h.events().map(x=>x.content_id),['development_play_01_3','development_pause_01_3','development_replay_01_3']);});
test('記事と公式リンクのクエリ・フラグメントは送信しない',()=>{const h=setup();h.fire(h.node({tagName:'A',href:'/expected-value/?private=secret#test'}));h.fire(h.node({tagName:'A',href:'https://www.boatrace.jp/owpc/pc/race/index?x=secret'}));assert.deepEqual(h.events().map(x=>x.content_id),['link_/expected-value/','official_/owpc/pc/race/index']);assert.ok(!JSON.stringify(h.events()).includes('secret'));});
test('無効・対象外・外部URL・右クリックは送信しない',()=>{const h=setup();h.fire(h.node({disabled:true,dataset:{race:'1'}}));h.fire(h.node({id:'refresh-button'}));h.fire(h.node({tagName:'A',href:'https://example.com'}));h.fire(h.node({dataset:{race:'1'}}),'click',{button:2});assert.equal(h.events().length,0);});
test('URL内の場・レースを識別し二重送信しない',()=>{const h=setup();h.fire(h.node({tagName:'A',href:'/venues/24/?race=6#live-view'}));assert.equal(h.events().length,1);assert.equal(h.events()[0].content_id,'race_24_6');});

