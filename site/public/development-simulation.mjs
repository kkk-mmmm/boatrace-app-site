// Drawing units and diagram seconds, NOT metres, calibrated speeds, or a prediction model.
export const DRAWING=Object.freeze({version:'turn-2',mark:{x:460,y:170,radius:10},slitX:150,halfLength:17,halfWidth:7,safety:.4,minRadius:24,maxSpeed:110,step:.006,maxAttempts:24,playbackScale:1.5,geometry:{radiusBase:40,radiusStep:20,courseY:210,courseSpacing:22,exitX:300,backEndX:-1000},motion:{cruise:88,selectedCruise:102,cruiseMin:74,cruiseMax:110,neutralTurn:39,selectedTurn:58,makuriTurn:67,makurisashiTurn:69,turnMin:36,turnMax:71,gateFloor:18,gateEase:.35,gateClearance:.25},timing:{defaultST:.17,minST:.03,maxST:.45,exhibitionWeight:.25,rankSlope:.012}});
for(const key of ['mark','geometry','motion','timing'])Object.freeze(DRAWING[key]);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),mix=(a,b,u)=>a+(b-a)*u;
const point=(x,y)=>({x,y});
const line=(a,b)=>Object.assign([a,point(mix(a.x,b.x,1/3),mix(a.y,b.y,1/3)),point(mix(a.x,b.x,2/3),mix(a.y,b.y,2/3)),b],{maxCurvature:0});
// x is linear, so |kappa| <= 6|dy|/dx² (attained at an endpoint).
const bend=(a,b)=>Object.assign([a,point(mix(a.x,b.x,1/3),a.y),point(mix(a.x,b.x,2/3),b.y),b],{maxCurvature:6*Math.abs(b.y-a.y)/Math.max(1e-9,(b.x-a.x)**2)});
export function cubic(c,u){const v=1-u;return {x:v**3*c[0].x+3*v*v*u*c[1].x+3*v*u*u*c[2].x+u**3*c[3].x,y:v**3*c[0].y+3*v*v*u*c[1].y+3*v*u*u*c[2].y+u**3*c[3].y};}
function differential(c,u){const v=1-u,dx=3*v*v*(c[1].x-c[0].x)+6*v*u*(c[2].x-c[1].x)+3*u*u*(c[3].x-c[2].x),dy=3*v*v*(c[1].y-c[0].y)+6*v*u*(c[2].y-c[1].y)+3*u*u*(c[3].y-c[2].y),ddx=6*v*(c[2].x-2*c[1].x+c[0].x)+6*u*(c[3].x-2*c[2].x+c[1].x),ddy=6*v*(c[2].y-2*c[1].y+c[0].y)+6*u*(c[3].y-2*c[2].y+c[1].y);return {dx,dy,curvature:(dx*ddy-dy*ddx)/Math.max(1e-9,(dx*dx+dy*dy)**1.5)};}
function arc(curves){let length=0,last=curves[0][0];const lut=[{s:0,i:0,u:0}];for(let i=0;i<curves.length;i++)for(let j=1;j<=100;j++){const u=j/100,p=cubic(curves[i],u);length+=Math.hypot(p.x-last.x,p.y-last.y);lut.push({s:length,i,u});last=p;}return {curves,lut,length};}
function atDistance(path,s){s=clamp(s,0,path.length);let lo=0,hi=path.lut.length-1;while(lo+1<hi){const m=(lo+hi)>>1;if(path.lut[m].s<s)lo=m;else hi=m;}const a=path.lut[lo],b=path.lut[hi],u=mix(a.i===b.i?a.u:0,b.u,(s-a.s)/Math.max(1e-9,b.s-a.s)),c=path.curves[b.i],p=cubic(c,u),d=differential(c,u);let angle=Math.atan2(d.dy,d.dx);if(angle>Math.PI/2)angle-=Math.PI*2;return {...p,angle,curvature:d.curvature};}
const smooth=u=>u*u*(3-2*u),integral=u=>u**3-.5*u**4;
function travel(u,v0,v1,q){return u<=q?v0*u+(v1-v0)*q*integral(u/q):q*(v0+v1)/2+(u-q)*v1;}
function stage(name,curves,start,v0,v1=v0,q=1){const path=arc(curves),duration=path.length/(q*(v0+v1)/2+(1-q)*v1);return {name,path,start,duration,end:start+duration,v0,v1,q};}
function buildBoat(b,style,radius,attempt,gate=null){
 const motion=DRAWING.motion,geometry=DRAWING.geometry;
 const selected=b.selected,cruise=clamp((selected?motion.selectedCruise:motion.cruise)+(b.cruiseBias||0)+(attempt%4-1)*3+(b.course-3)*.4,motion.cruiseMin,motion.cruiseMax);
 const turn=clamp((selected?(style==='まくり'?motion.makuriTurn:style==='まくり差し'?motion.makurisashiTurn:motion.selectedTurn):motion.neutralTurn)+(attempt%3)*2,motion.turnMin,motion.turnMax);
 const st=b.slitTime,y=geometry.courseY+(b.course-1)*geometry.courseSpacing,cut=style==='差し'?clamp(390-(b.course-2)*40,290,390):style==='まくり差し'?clamp(390-(b.course-2)*60,290,390):300;
 const attack=style==='まくり差し'?20:0,a=point(DRAWING.slitX-DRAWING.halfLength,y),join=point(cut,y+attack),entry=point(460,170+radius),middle=point(460+radius,170),exit=point(460,170-radius),k=.5522847498307936;
 const approachCurves=attack?[line(a,point(cut-70,y)),bend(point(cut-70,y),join)]:[line(a,join)];
 const pre=stage('スリット通過',[line(point(a.x-cruise*st,y),a)],0,cruise),distance=arc(approachCurves).length;
 let approachEnd=cruise,q=1;
 if(gate!==null){const duration=Math.max(distance/cruise,gate-pre.end);q=motion.gateEase;approachEnd=(distance/duration-q*cruise/2)/(1-q/2);if(approachEnd<motion.gateFloor)return null;}
 const approach=stage('アプローチ',approachCurves,pre.end,cruise,approachEnd,q),enter=stage('ターン進入',[bend(join,entry)],approach.end,approachEnd,turn);
 const turnCurves=[[entry,point(460+k*radius,entry.y),point(middle.x,170+k*radius),middle],[middle,point(middle.x,170-k*radius),point(460+k*radius,exit.y),exit]];
 // The fixed k=.55228475 quarter-circle cubic has |kappa| < 1.1/r.
 for(const c of turnCurves)c.maxCurvature=1.1/radius;
 const rotate=stage('旋回',turnCurves,enter.end,turn),accelerate=stage('脱出加速',[line(exit,point(geometry.exitX,exit.y))],rotate.end,turn,cruise),back=stage('バック',[line(point(geometry.exitX,exit.y),point(geometry.backEndX,exit.y))],accelerate.end,cruise);
 return {lane:b.lane,course:b.course,style,radius,gate,slitTime:st,stSource:b.stSource,phases:[pre,approach,enter,rotate,accelerate,back],turnStart:rotate.start,turnEnd:rotate.end,exitEnd:accelerate.end};
}
export function boatState(boat,t){
 const phases=boat.phases;let phase=phases.find(p=>t<=p.end)||phases.at(-1);const u=clamp((t-phase.start)/phase.duration,0,1),s=phase.duration*travel(u,phase.v0,phase.v1,phase.q),p=atDistance(phase.path,s),v=u<phase.q?mix(phase.v0,phase.v1,smooth(u/phase.q)):phase.v1;
 const slip=['旋回','脱出加速'].includes(phase.name)?clamp(p.curvature*80,-1,1)*Math.PI/60*Math.sin(Math.PI*u)**2:0;
 const progress=t<boat.turnStart?clamp(t/boat.turnStart,0,1):t<boat.turnEnd?1+(t-boat.turnStart)/(boat.turnEnd-boat.turnStart):2+(460-p.x)/100;
 return {lane:boat.lane,time:t,x:p.x,y:p.y,speed:v,vx:v*Math.cos(p.angle),vy:v*Math.sin(p.angle),heading:p.angle+slip,direction:p.angle,slip,curvature:p.curvature,phase:phase.name,phaseProgress:u,progress};
}
export const fleetState=(simulation,t)=>simulation.boats.map(b=>boatState(b,clamp(t,0,simulation.duration)));
function axes(s){return [point(Math.cos(s.heading),Math.sin(s.heading)),point(-Math.sin(s.heading),Math.cos(s.heading))];}
export function bodiesOverlap(a,b,margin=0){const aa=axes(a),bb=axes(b),delta=point(b.x-a.x,b.y-a.y),l=DRAWING.halfLength+margin,w=DRAWING.halfWidth+margin,dot=(p,q)=>p.x*q.x+p.y*q.y;for(const axis of [...aa,...bb]){const separation=Math.abs(dot(delta,axis)),radius=l*(Math.abs(dot(aa[0],axis))+Math.abs(dot(bb[0],axis)))+w*(Math.abs(dot(aa[1],axis))+Math.abs(dot(bb[1],axis)));if(separation>=radius)return false;}return true;}
export function touchesMark(s,margin=0){const [a,b]=axes(s),dx=DRAWING.mark.x-s.x,dy=DRAWING.mark.y-s.y,x=Math.abs(dx*a.x+dy*a.y),y=Math.abs(dx*b.x+dy*b.y);return Math.hypot(Math.max(0,x-DRAWING.halfLength-margin),Math.max(0,y-DRAWING.halfWidth-margin))<=DRAWING.mark.radius;}
export function validateSimulation(simulation){
 for(const boat of simulation.boats)for(const phase of boat.phases)for(const c of phase.path.curves)if(!Number.isFinite(c.maxCurvature)||c.maxCurvature>1/DRAWING.minRadius)return {valid:false,reason:'CURVATURE',lane:boat.lane};
 // Inflated oriented hulls cover each sampling interval's translation + rotation.
 const dt=DRAWING.step,speedBound=DRAWING.maxSpeed*1.01,angularBound=speedBound/DRAWING.minRadius+.3,sweep=(speedBound+Math.hypot(DRAWING.halfLength,DRAWING.halfWidth)*angularBound)*dt/2,margin=DRAWING.safety+sweep;
 for(let t=0;t<=simulation.duration+dt/2;t+=dt){const states=fleetState(simulation,Math.min(t,simulation.duration));for(let i=0;i<states.length;i++){const a=states[i];if(touchesMark(a,margin))return {valid:false,reason:'MARK',time:t,lane:a.lane};for(let j=i+1;j<states.length;j++)if(bodiesOverlap(a,states[j],margin))return {valid:false,reason:'CONTACT',time:t,lanes:[a.lane,states[j].lane],positions:[a,states[j]]};}}
 return {valid:true,margin,step:dt};
}
export function simulateDevelopment(scenario,{maxAttempts=DRAWING.maxAttempts}={}){
 if(!scenario?.boats||scenario.boats.length!==6||scenario.boats.some(b=>b.withdrawn||!Number.isInteger(b.lane)||b.lane<1||b.lane>6)||new Set(scenario.boats.map(b=>b.lane)).size!==6)return {valid:false,reason:'ENTRIES',boats:[],duration:0,attempts:0};
 const known=scenario.boats.every(b=>Number.isInteger(b.course)&&b.course>=1&&b.course<=6)&&new Set(scenario.boats.map(b=>b.course)).size===6;
 const boats=scenario.boats.map(b=>({...b,course:known?b.course:b.lane,selected:b.lane===scenario.lane})),winner=boats.find(b=>b.selected);if(!winner)return {valid:false,reason:'WINNER',boats:[],duration:0,attempts:0};
 const style=scenario.style||(winner.course===1?'逃げ':winner.course===2?'差し':'まくり');
 if(!['逃げ','差し','まくり','まくり差し'].includes(style))return {valid:false,reason:'TACTIC',boats:[],duration:0,attempts:0};
 if(style==='逃げ'&&winner.course!==1||style!=='逃げ'&&winner.course===1)return {valid:false,reason:'TACTIC_COURSE',boats:[],duration:0,attempts:0};
 // ST is one blended timing input; start rank is used only when both ST sources are absent.
 const timing=DRAWING.timing;
 for(const b of boats){let st=b.st;if(Number.isFinite(b.exhibitionST)&&Number.isFinite(b.stGap))st=Number.isFinite(st)?(1-timing.exhibitionWeight)*st+timing.exhibitionWeight*clamp(b.exhibitionST+b.stGap,timing.minST,timing.maxST):b.exhibitionST+b.stGap;b.slitTime=clamp(Number.isFinite(st)?st:Number.isFinite(b.startRank)?timing.defaultST+(b.startRank-3.5)*timing.rankSlope:timing.defaultST,timing.minST,timing.maxST);}

 const scored=boats.every(b=>Number.isFinite(b.score)),timed=boats.every(b=>Number.isFinite(b.exhibitionTime));
 const priority=scored?boats.filter(b=>b.score>winner.score).length%4:timed?boats.filter(b=>b.exhibitionTime<winner.exhibitionTime).length%4:0;
 const candidates=Array.from({length:DRAWING.maxAttempts},(_,i)=>(i>>2)*4+((i+priority)%4));
 const failures=[];
 for(let trial=0;trial<Math.min(DRAWING.maxAttempts,Math.max(0,maxAttempts));trial++){
  const attempt=candidates[trial];
  const radii=new Map(boats.map(b=>[b.lane,DRAWING.geometry.radiusBase+(b.course-1)*DRAWING.geometry.radiusStep]));
  const inner=boats.find(b=>b.course===1);
  if(['差し','まくり差し'].includes(style)){radii.set(inner.lane,radii.get(winner.lane));radii.set(winner.lane,DRAWING.geometry.radiusBase);}
  const plans=boats.filter(b=>!b.selected).map(b=>buildBoat({...b,cruiseBias:['差し','まくり差し'].includes(style)&&winner.course>2?(b.course===1?10:b.course<winner.course?-10:0):0},b.course===1?'逃げ':'中立',radii.get(b.lane),attempt));
  const leader=plans.find(p=>p.course===1),gate=['差し','まくり差し'].includes(style)?leader.turnStart+DRAWING.motion.gateClearance+(attempt>>2)*.12:null;
  const selected=buildBoat(winner,style,radii.get(winner.lane),attempt,gate);
  if(!selected){failures.push('GAP_DELAY');continue;}
  plans.push(selected);plans.sort((a,b)=>a.lane-b.lane);
  const duration=selected.exitEnd+.6,simulation={valid:true,boats:plans,duration,checkpoint:duration,style,entryBasis:known?'展示進入を仮定':'進入不明のため枠なりを仮定',attempts:trial+1,candidate:attempt,version:DRAWING.version};
  const states=fleetState(simulation,duration),win=states.find(b=>b.lane===winner.lane);
  if(states.some(b=>b.lane!==winner.lane&&b.progress>win.progress-.22)){failures.push({reason:'NOT_LEADING',progress:states.map(s=>[s.lane,s.progress])});continue;}
  const validation=validateSimulation(simulation);if(!validation.valid){failures.push(validation);continue;}
  return {...simulation,validation,failures};
 }
 return {valid:false,reason:'NO_FEASIBLE_SCENARIO',boats:[],duration:0,attempts:failures.length,failures,style,entryBasis:known?'展示進入を仮定':'進入不明のため枠なりを仮定'};
}
export function wakePoints(boat,t,age=0){const end=Math.max(0,t-age*.5),start=Math.max(0,end-.5),points=[];for(let i=0;i<=12;i++){const s=boatState(boat,mix(start,end,i/12));points.push({x:s.x-17*Math.cos(s.heading),y:s.y-17*Math.sin(s.heading)});}return points;}
export function boatPath(boat){const curves=boat.phases.flatMap(p=>p.path.curves);return 'M '+curves[0][0].x+' '+curves[0][0].y+' '+curves.map(c=>'C '+c.slice(1).map(p=>p.x+' '+p.y).join(' ')).join(' ');}
