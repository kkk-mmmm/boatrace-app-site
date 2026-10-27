import {test} from 'node:test';import assert from 'node:assert/strict';
import {annualTriples} from './public/annual-model.mjs';
import {forecastConfidence,radarData,RADAR_AXES} from './public/race-metrics.mjs';
test('自信度は0.5刻み・最大5で、集中度と履歴件数を反映し的中率とは扱わない',()=>{
 const entries=Array.from({length:6},()=>({annual_lane:{samples:100}})),flat={entries,probabilities:annualTriples([0,0,0,0,0,0])},strong={entries,probabilities:annualTriples([6,0,0,0,0,0])};
 assert.equal(forecastConfidence(flat).score,0);const a=forecastConfidence(strong);assert.ok(a.score>0&&a.score<=5&&Number.isInteger(a.score*2));assert.equal(a.calibrated,false);
 assert.ok(forecastConfidence({...strong,entries:entries.map(()=>({annual_lane:{samples:1}}))}).score<a.score);
 assert.equal(forecastConfidence({...strong,probabilities:strong.probabilities.slice(1)}).score,null);
 assert.equal(forecastConfidence({...strong,probabilities:strong.probabilities.map(r=>({...r,probability:NaN}))}).score,null);
});
test('レーダーは6軸・艇色を保ち、同値は同点、展示欠損はnullにする',()=>{
 const race={entries:Array.from({length:6},(_,i)=>({lane:i+1,exhibition_time:i===0?null:6.7})),scores:Array.from({length:6},(_,i)=>({lane:i+1,name:'選手',history_components:RADAR_AXES.map(([,label])=>({label,raw_value:i}))}))};
 const rows=radarData(race);assert.equal(rows.length,6);assert.equal(rows[0].color,'#8b96a4');assert.equal(rows[0].values[4],null);assert.equal(rows[5].values[0],100);assert.equal(rows[0].values[0],0);
 for(const score of race.scores)score.history_components.forEach(c=>c.raw_value=1);
 assert.equal(radarData(race)[0].values[0],50);assert.deepEqual(radarData({scores:[]}),[]);
});
