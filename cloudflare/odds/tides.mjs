// Reference stations, not water-level gauges inside the race course.
export const TIDE_STATIONS={
 '03':['TK','東京'],'04':['TK','東京'],'06':['MI','舞阪'],'07':['G4','三河'],'08':['ZD','鬼崎'],'09':['TB','鳥羽'],
 '14':['KM','小松島'],'15':['TX','多度津'],'16':['UN','宇野'],'17':['Q8','広島'],'18':['QA','徳山'],'19':['DS','下関'],'22':['QF','博多'],'23':['KA','唐津']
};
export const TIDAL_UNMAPPED=new Set(['20','24']);
export function tideSource(station,year){if(!/^[A-Z0-9]{2}$/.test(station)||!/^20\d{2}$/.test(String(year)))throw Error('Invalid tide source');return `https://www.data.jma.go.jp/kaiyou/data/db/tide/suisan/txt/${year}/${station}.txt`;}
export function parseTideYear(text,date,station){
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(date))throw Error('Invalid tide date');
 const read=day=>String(text).split(/\r?\n/).filter(line=>line.length>=80&&line.slice(72,74)===day.slice(2,4)&&Number(line.slice(74,76))===Number(day.slice(5,7))&&Number(line.slice(76,78))===Number(day.slice(8,10))&&line.slice(78,80)===station);
 const matches=read(date);if(matches.length!==1)throw Error('予測潮位の日付・地点が一致しません');const line=matches[0];
 const hours=Array.from({length:24},(_,i)=>{const cell=line.slice(i*3,i*3+3);return /^\s*-?\d+\s*$/.test(cell)&&Number(cell)!==999?Number(cell):null;});
 if(hours.some(v=>v===null||v< -1000||v>1500))throw Error('予測潮位の毎時値が不完全です');
 const nextDate=new Date(Date.parse(date)+86400000).toISOString().slice(0,10),next=read(nextDate)[0],last=next?Number(next.slice(0,3)):null;
 const extrema=start=>Array.from({length:4},(_,i)=>line.slice(start+i*7,start+(i+1)*7)).flatMap(cell=>{
  const h=Number(cell.slice(0,2)),m=Number(cell.slice(2,4)),height=Number(cell.slice(4,7));
  return /^\s*\d+\s*\d+\s*-?\d+\s*$/.test(cell)&&h>=0&&h<24&&m>=0&&m<60&&height!==999?[{time:`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,height_cm:height}]:[];
 });
 return {date,station_code:station,hours,next_hour:Number.isFinite(last)&&last!==999?last:null,high_tides:extrema(80),low_tides:extrema(108)};
}
export function tideAt(day,deadline,{name,source_url,fetched_at}={}){
 const local=new Date(Date.parse(deadline)+9*3600000);if(!Number.isFinite(+local)||local.toISOString().slice(0,10)!==day.date)throw Error('Tide/race date mismatch');
 const hour=local.getUTCHours(),fraction=local.getUTCMinutes()/60+local.getUTCSeconds()/3600,a=day.hours[hour],b=hour===23?day.next_hour:day.hours[hour+1];
 if(!Number.isFinite(a)||!Number.isFinite(b))return {status:'UNAVAILABLE',kind:'PREDICTED_REFERENCE',station_code:day.station_code,station_name:name,reason:'毎時値の補間に必要な時刻がありません'};
 const height=a+(b-a)*fraction,min=Math.min(...day.hours),max=Math.max(...day.hours),rate=b-a;
 return {status:'OK',kind:'PREDICTED_REFERENCE',station_code:day.station_code,station_name:name,source_url,fetched_at,target_at:deadline,datum:'潮位表基準面上（DL）',height_cm:Math.round(height*10)/10,
  normalized_level:Math.max(-1,Math.min(1,(height-(max+min)/2)/Math.max(1,(max-min)/2))),change_cm_per_hour:rate,trend:rate>1?'RISING':rate< -1?'FALLING':'SLACK',high_tides:day.high_tides,low_tides:day.low_tides,
  description:'気象庁の近隣地点の天文潮位予測を毎時値から線形補間。レース場内の実測水位ではなく、風による吹き寄せ等は含みません。'};
}
export async function loadTide(storage,venue,date,deadline,fetchText,now=Date.now()){
 const mapping=TIDE_STATIONS[venue];if(!mapping)return {status:TIDAL_UNMAPPED.has(venue)?'UNMAPPED':'NOT_APPLICABLE',kind:'PREDICTED_REFERENCE',reason:TIDAL_UNMAPPED.has(venue)?'適切な公的な参照地点を未設定です':'淡水場など、予測潮位を適用しない場です'};
 const [station,name]=mapping,key=`jma:${date}:${station}`,source_url=tideSource(station,date.slice(0,4));let previous=await storage.get(key);
 if(previous?.issue&&now-Date.parse(previous.attempted_at)<300000)return previous.issue;
 try{
  if(!previous?.day){const text=await fetchText(source_url,fetch,128*1024);previous={day:parseTideYear(text,date,station),fetched_at:new Date(now).toISOString()};await storage.put(key,previous);}
  return tideAt(previous.day,deadline,{name,source_url,fetched_at:previous.fetched_at});
 }catch(e){const issue={status:'UNAVAILABLE',kind:'PREDICTED_REFERENCE',station_code:station,station_name:name,source_url,reason:String(e.message).slice(0,160)};await storage.put(key,{issue,attempted_at:new Date(now).toISOString()});return issue;}
}
