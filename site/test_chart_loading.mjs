import test from 'node:test';import assert from 'node:assert/strict';
async function setup(t){const old={window:globalThis.window,document:globalThis.document},canvas={dataset:{}},panel={open:false},status={textContent:''},scripts=[],state={canvas,panel,status,scripts};globalThis.window={};globalThis.document={getElementById:id=>id==='score-radar'?state.canvas:id==='assessment-disclosure'?panel:id==='race-prediction-panel'?{hidden:false}:status,querySelectorAll:()=>[],createElement:()=>({}),head:{append:s=>scripts.push(s)}};t.after(()=>{for(const [k,v] of Object.entries(old))if(v===undefined)delete globalThis[k];else globalThis[k]=v;});const module=await import('./public/charts.mjs?test='+Math.random());return {...state,state,mount:module.mountRadar};}
const race={date:'2030-01-01',venue_code:'01',race_no:1},tick=()=>new Promise(r=>setImmediate(r));
test('グラフは評価表示まで取得せず、同時取得をまとめ、遅い応答で古いキャンバスを描かない',async t=>{
 const {state,mount,scripts,panel}=await setup(t);mount(race);assert.equal(scripts.length,0);panel.open=true;mount(race);mount(race);assert.equal(scripts.length,1);assert.match(scripts[0].src,/chart\.js@4\.4\.8/);assert.match(scripts[0].integrity,/^sha384-/);assert.equal(scripts[0].crossOrigin,'anonymous');
 const stale=state.canvas;state.canvas={dataset:{}};mount({...race,race_no:2});let created=0,drawn;window.Chart=class {constructor(canvas,config){created++;drawn=canvas;this.data=config.data;}update(){}destroy(){}};scripts[0].onload();await tick();assert.equal(created,1);assert.equal(drawn,state.canvas);assert.notEqual(drawn,stale);mount({...race,race_no:2});assert.equal(scripts.length,1);assert.equal(created,1);
});
test('CDN障害でも数値表の案内を残し、ポーリングで取得を連発しない',async t=>{const {state,mount,scripts,panel,status}=await setup(t);panel.open=true;mount(race);scripts[0].onerror();await tick();assert.equal(state.canvas.hidden,true);assert.match(status.textContent,/数値の表/);mount(race);await tick();assert.equal(scripts.length,1);assert.match(status.textContent,/取得できません/);});

// An open assessment disclosure must not load the CDN while its prediction tab is hidden.
test('根拠の開閉と親の予想タブの表示状態に従いCDNを取得する',async t=>{
 const {mount,scripts,panel}=await setup(t);panel.open=true;
 const get=document.getElementById;let hidden=true;
 document.getElementById=id=>id==='race-prediction-panel'?{hidden}:get(id);
 mount(race);assert.equal(scripts.length,0);
 hidden=false;mount(race);assert.equal(scripts.length,1);
 hidden=true;scripts[0].onerror();await tick();assert.equal(scripts.length,1);
});
