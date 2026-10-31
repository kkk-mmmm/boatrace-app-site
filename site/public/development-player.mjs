import {DRAWING,fleetState,wakePoints} from './development-simulation.mjs';
export const advanceDevelopmentTime=(time,delta,rate,duration)=>Math.min(duration,time+Math.min(.25,Math.max(0,delta))*rate*DRAWING.playbackScale);
// One clock owns hulls, heading, spray, and wake. No SVG animation timelines.
export function mountDevelopmentPlayer(svg,simulation,{state=null,visible=true,reduced=false}={}){
 let time=state?Math.min(simulation.duration,state.time):reduced?simulation.duration:0,rate=state?.rate||1,playing=state?state.playing:!reduced,shown=visible,raf=null,last=0,disposed=false,pending=null;
 if(time>=simulation.duration)playing=false;
 const parent=svg.closest('.development'),notice=parent.querySelector('#development-plan-status'),pause=parent.querySelector('#development-pause'),replay=parent.querySelector('#development-replay'),seek=parent.querySelector('#development-seek'),speed=parent.querySelector('#development-speed'),clock=parent.querySelector('#development-time');
 const points=ps=>'M '+ps.map(p=>p.x.toFixed(3)+' '+p.y.toFixed(3)).join(' L ');
 function draw(){
  const states=fleetState(simulation,time);
  for(const s of states){const hull=svg.querySelector(`[data-development-boat="${s.lane}"]`);hull.setAttribute('transform',`translate(${s.x.toFixed(4)} ${s.y.toFixed(4)}) rotate(${(s.heading*180/Math.PI).toFixed(4)})`);hull.dataset.phase=s.phase;hull.dataset.speed=s.speed.toFixed(4);
   const boat=simulation.boats.find(b=>b.lane===s.lane);for(let age=0;age<3;age++)svg.querySelector(`[data-wake-lane="${s.lane}"][data-wake-age="${age}"]`).setAttribute('d',points(wakePoints(boat,time,age)));
   const spray=hull.querySelector('.development-spray');spray.setAttribute('opacity',String(Math.min(.65,s.speed/110*.25+Math.abs(s.curvature)*s.speed*.12)));}
  const condition=parent.querySelector('.development-condition'),conditionText=`${simulation.entryBasis}。展示進入は本番進入の確定情報ではありません。第一ターンからバックで先行する例に限定し、最終的な勝利や他艇の2・3着順は描画で保証しません。`;if(condition.textContent!==conditionText)condition.textContent=conditionText;
  seek.max=String(simulation.duration);seek.value=String(time);seek.setAttribute('aria-valuetext',`模式時刻 ${time.toFixed(1)} / ${simulation.duration.toFixed(1)}`);speed.value=String(rate);clock.textContent=`模式時刻 ${time.toFixed(1)} / ${simulation.duration.toFixed(1)}`;pause.textContent=playing&&time<simulation.duration?'一時停止':'再生する';svg.dataset.simulationTime=time.toFixed(4);
 }
 const active=()=>!disposed&&playing&&shown&&!document.hidden&&time<simulation.duration;
 function stop(){if(raf!==null)cancelAnimationFrame(raf);raf=null;last=0;}
 function schedule(){if(active()&&raf===null){last=performance.now();raf=requestAnimationFrame(frame);}}
 function frame(wall){raf=null;if(!active())return;time=advanceDevelopmentTime(time,(wall-last)/1000,rate,simulation.duration);last=wall;if(time>=simulation.duration)playing=false;draw();if(active())raf=requestAnimationFrame(frame);}
 function setTime(t){time=Math.max(0,Math.min(simulation.duration,Number(t)||0));if(time>=simulation.duration)playing=false;stop();draw();schedule();}
 const api={simulation,queueSimulation(next){pending=next.inputKey===simulation.inputKey?null:next;notice.hidden=!pending;notice.textContent=pending?'入力が更新されました。「もう一度再生」で新しい情報を使います。':'';if(pending)parent.querySelector('#development-heading').textContent=`${svg.dataset.developmentLane}号艇の第一ターン先行例 / ${simulation.style}（表示中）`;draw();},snapshot:()=>({time,rate,playing}),draw,pause(){playing=false;stop();draw();},play(){if(time>=simulation.duration)time=0;playing=true;draw();schedule();},seek:setTime,setRate(r){if(![.5,1].includes(r))return;rate=r;stop();draw();schedule();},setVisible(v){shown=v;stop();draw();schedule();},dispose(){disposed=true;stop();document.removeEventListener('visibilitychange',onVisibility);pause.onclick=replay.onclick=seek.oninput=speed.onchange=null;media.removeEventListener('change',onMotionPreference);delete svg.__developmentPlayer;}};
 const media=matchMedia('(prefers-reduced-motion: reduce)'),onMotionPreference=e=>{if(e.matches){playing=false;time=simulation.duration;stop();draw();}};media.addEventListener('change',onMotionPreference);
 const onVisibility=()=>{stop();draw();schedule();};document.addEventListener('visibilitychange',onVisibility);
 pause.onclick=()=>playing?api.pause():api.play();replay.onclick=()=>{if(pending){simulation=pending;api.simulation=simulation;pending=null;notice.hidden=true;parent.querySelector('#development-heading').textContent=`${svg.dataset.developmentLane}号艇の第一ターン先行例 / ${simulation.style}`;}time=0;playing=true;stop();draw();schedule();};seek.oninput=()=>setTime(seek.value);speed.onchange=()=>api.setRate(Number(speed.value));svg.__developmentPlayer=api;draw();schedule();return api;
}
