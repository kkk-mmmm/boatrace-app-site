import {baseLogWorth,FEATURE_NAMES} from './features.mjs';
export const FEATURE_LABELS=['選手のST傾向','選手のST安定度','開催日ごとのST','開催日ごとの安定度','予選・準優・優勝戦のST','レース区分ごとの安定度','勝負掛けのST','勝負掛けの安定度','展示STと本番STの差','展示STの再現性','展示順位と本番着順の差','展示順位の再現性','F・Lの発生傾向'];
export function scoreDetails(entries,features=[]){
  return entries.map(entry=>{
    const feature=features.find(f=>f.lane===entry.lane);
    const base=[entry.national_win_rate*.6*.5,entry.local_win_rate*.25*.5,entry.motor_2rate/15*.3*.5,-(entry.avg_st-.15)*15*.5,[1.4,.6,.3,.1,-.2,-.5][entry.lane-1]*.5];
    const valid=['national_win_rate','local_win_rate','motor_2rate','avg_st'].every(k=>typeof entry[k]==='number'&&Number.isFinite(entry[k]));
    const adjustments=(feature?.contributions || FEATURE_NAMES.map(()=>0));
    return {lane:entry.lane,name:entry.name,base_components:valid?base:null,base_score:valid?baseLogWorth(entry):null,
      history_components:FEATURE_NAMES.map((name,i)=>({id:name,label:FEATURE_LABELS[i],raw_value:feature?.raw?.[i] ?? null,value:adjustments[i]})),
      history_adjustment:adjustments.reduce((s,v)=>s+v,0),total:valid?baseLogWorth(entry)+adjustments.reduce((s,v)=>s+v,0):null};
  });
}
