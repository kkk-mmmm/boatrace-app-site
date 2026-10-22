// Daily profile updates keep validated coefficients fixed between monthly reviews.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {emptyAnnualProfiles,observeAnnual,validateAnnualModel} from '../../site/public/annual-model.mjs';
const [directory,file]=process.argv.slice(2);
if(!directory||!file)throw Error('履歴フォルダと年次モデルが必要です');
const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'))),races=JSON.parse(fs.readFileSync(path.join(directory,'races.json')));
if(manifest.days!==365||manifest.failures.length||races.length!==manifest.races)throw Error('365日分の完全な履歴が必要です');
const model=JSON.parse(fs.readFileSync(file)),profiles=emptyAnnualProfiles();
validateAnnualModel(model,new Date(Date.parse(manifest.through)+86400000).toISOString().slice(0,10));
for(const race of races){if(race.date<manifest.from||race.date>manifest.through)throw Error('集計期間外のレースです');observeAnnual(profiles,race);}
const next={...model,trained_from:manifest.from,trained_through:manifest.through,created_at:new Date().toISOString(),profiles,
 coefficients_trained_through:model.coefficients_trained_through||model.trained_through,
 coverage:{from:manifest.from,through:manifest.through,days:365,races:races.length,players:Object.keys(profiles.players).length,failures:0,excluded_races:manifest.excluded_races?.length||0}};
delete next.id;next.id='annual-v3-'+crypto.createHash('sha256').update(JSON.stringify(next)).digest('hex');
validateAnnualModel(next,new Date(Date.parse(manifest.through)+86400000).toISOString().slice(0,10));
fs.writeFileSync(file,JSON.stringify(next)+'\n');console.log('::notice title=Daily annual profiles::'+JSON.stringify({id:next.id,coverage:next.coverage,coefficients_trained_through:next.coefficients_trained_through}));
