// Daily profile updates keep validated coefficients fixed between monthly reviews.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {validateAnnualModel} from '../../site/public/annual-model.mjs';
import {buildHistoryProfiles} from './history_profiles.mjs';
const [directory,file]=process.argv.slice(2);
if(!directory||!file)throw Error('履歴フォルダと年次モデルが必要です');
const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'))),races=JSON.parse(fs.readFileSync(path.join(directory,'races.json')));
if(manifest.days!==365||manifest.failures.length||races.length!==manifest.races)throw Error('365日分の完全な履歴が必要です');
const model=JSON.parse(fs.readFileSync(file));
validateAnnualModel(model,new Date(Date.parse(model.trained_through)+86400000).toISOString().slice(0,10));
if(manifest.through<model.trained_through)throw Error('履歴更新で日付を巻き戻すことはできません');
const profiles=buildHistoryProfiles(races,manifest);
const pythonFile=path.join(path.dirname(file),'../course2-escape/current.json');
if(fs.existsSync(pythonFile)){const data=JSON.parse(fs.readFileSync(pythonFile));if(data.from!==manifest.from||data.through!==manifest.through||data.population.n!==profiles.race_context?.course2?.n||data.population.escape!==profiles.race_context?.course2?.escape)throw Error('PythonとJSの2コース逃がし率集計が一致しません');profiles.race_context.course2={...data.population,players:data.players};if(JSON.stringify(data.lane2_support)!==JSON.stringify(profiles.race_context.lane2_support))throw Error('PythonとJSの2号艇逃がし率が一致しません');}
const coefficient_id='annual-coeff-'+crypto.createHash('sha256').update(JSON.stringify([model.engine_version,model.feature_names,model.coefficients,model.means,model.scales,model.temperature])).digest('hex');
const next={...model,coefficient_id,trained_from:manifest.from,trained_through:manifest.through,created_at:new Date().toISOString(),profiles,
 coefficients_trained_through:model.coefficients_trained_through||model.trained_through,
 coverage:{from:manifest.from,through:manifest.through,days:365,races:races.length,players:Object.keys(profiles.players).length,failures:0,excluded_races:manifest.excluded_races?.length||0}};
delete next.id;next.id='annual-v3-'+crypto.createHash('sha256').update(JSON.stringify(next)).digest('hex');
validateAnnualModel(next,new Date(Date.parse(manifest.through)+86400000).toISOString().slice(0,10));
const serialized=JSON.stringify(next)+'\n';if(Buffer.byteLength(serialized)>7*1024*1024)throw Error('履歴配信用データが上限を超えました');
fs.writeFileSync(file,serialized);console.log('::notice title=Daily annual profiles::'+JSON.stringify({id:next.id,bytes:Buffer.byteLength(serialized),recent_days:profiles.windows.recent_days,coefficient_id,coverage:next.coverage,coefficients_trained_through:next.coefficients_trained_through}));
