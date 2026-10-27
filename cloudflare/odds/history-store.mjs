// Existing SQLite-backed Durable Object: no new account, D1 database or secret.
export const HISTORY_SCHEMA=3;
export const MIGRATION_STATEMENTS=[
 'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS race_environment (date TEXT NOT NULL, venue_code TEXT NOT NULL, race_no INTEGER NOT NULL, fetched_at TEXT NOT NULL, source_url TEXT NOT NULL, wind_direction_code INTEGER, wind_speed_mps REAL, wave_height_cm REAL, tide_height_cm REAL, tide_station TEXT, tide_kind TEXT, payload TEXT NOT NULL, PRIMARY KEY(date,venue_code,race_no,fetched_at))',
 'CREATE INDEX IF NOT EXISTS race_environment_date ON race_environment(date)',
 'CREATE TABLE IF NOT EXISTS verification_records (kind TEXT NOT NULL, race_key TEXT NOT NULL, date TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,race_key))',
 'CREATE INDEX IF NOT EXISTS verification_date ON verification_records(date)',
 'CREATE TABLE IF NOT EXISTS public_verification_archive (race_key TEXT NOT NULL, cohort TEXT NOT NULL, date TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(race_key,cohort))',
 'CREATE INDEX IF NOT EXISTS public_verification_date ON public_verification_archive(date)'
];
const identity=r=>`${r.date}/${r.venue_code}/${r.race_no}`;
export function migrateHistory(storage){if(storage.sql){for(const sql of MIGRATION_STATEMENTS)storage.sql.exec(sql);storage.sql.exec('INSERT OR IGNORE INTO schema_migrations VALUES (?,?)',HISTORY_SCHEMA,new Date().toISOString());}}
export async function saveEnvironment(storage,race){
 const e=race.environment;if(!e?.fetched_at)return;
 const key=identity(race)+'/'+e.fetched_at;
 if(storage.sql)storage.sql.exec('INSERT OR IGNORE INTO race_environment VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',race.date,race.venue_code,race.race_no,e.fetched_at,e.source_url,e.wind_direction_code??null,e.wind_speed_mps??null,e.wave_height_cm??null,e.tide?.height_cm??null,e.tide?.station_code??null,e.tide?.kind??null,JSON.stringify(e));
 else await storage.put('history:environment:'+key,{date:race.date,environment:e});
}
export async function saveHistoryRecord(storage,kind,record){
 if(!['proposal','result'].includes(kind))throw Error('Unknown history record');
 const key=identity(record);
 if(storage.sql)storage.sql.exec('INSERT OR IGNORE INTO verification_records VALUES (?,?,?,?)',kind,key,record.date,JSON.stringify(record));
 else if(!await storage.get('history:'+kind+':'+key))await storage.put('history:'+kind+':'+key,record);
}
export async function historyRecords(storage,from,through){
 if(storage.sql)return [...storage.sql.exec('SELECT kind,payload FROM verification_records WHERE date>=? AND date<=? ORDER BY date,race_key',from,through)].map(r=>({kind:r.kind,record:JSON.parse(r.payload)}));
 const rows=await storage.list({prefix:'history:'});return [...rows].filter(([k,r])=>!k.startsWith('history:environment:')&&!k.startsWith('history:public-row:')&&r.date>=from&&r.date<=through).map(([k,record])=>({kind:k.split(':')[1],record}));
}
export async function rolloverHistory(storage,date){
 const from=new Date(Date.parse(date)-29*86400000).toISOString().slice(0,10);
 // Never use storage.deleteAll(): that would erase SQL history at midnight.
 let cursor;
 while(true){
  const batch=await storage.list({prefix:'',limit:128,...(cursor?{startAfter:cursor}:{})});
  const rows=[...batch].filter(([key])=>!cursor||key>cursor).sort(([a],[b])=>a<b?-1:a>b?1:0);
  if(!rows.length)break;
  for(const [key,value] of rows){
   if(value?.date>=from&&key.startsWith('proposal:'))await saveHistoryRecord(storage,'proposal',value);
   if(value?.date>=from&&key.startsWith('result:')&&value.status==='CONFIRMED')await saveHistoryRecord(storage,'result',value);
   if(!key.startsWith('history:')||value.date<from){if(storage.delete)await storage.delete(key);}
  }
  cursor=rows.at(-1)[0];if(batch.size<128)break;
 }

 if(storage.sql){storage.sql.exec('DELETE FROM race_environment WHERE date<?',from);storage.sql.exec('DELETE FROM verification_records WHERE date<?',from);storage.sql.exec('DELETE FROM public_verification_archive WHERE date<?',from);}
}

export async function savePublicArchive(storage,records){
 for(const row of records){
  if(!row||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!/^0[1-9]$|^1\d$|^2[0-4]$/.test(row.venue_code)||!Number.isInteger(row.race_no)||row.race_no<1||row.race_no>12)throw Error('Invalid public archive identity');
  const key=identity(row),cohort=row.cohort||'WORKER_REPORTED_ONLY';
  if(storage.sql)storage.sql.exec('INSERT INTO public_verification_archive VALUES (?,?,?,?) ON CONFLICT(race_key,cohort) DO UPDATE SET date=excluded.date,payload=excluded.payload WHERE public_verification_archive.payload<>excluded.payload',key,cohort,row.date,JSON.stringify(row));
  else await storage.put('history:public-row:'+key+'/'+cohort,row);
 }
}
export async function publicArchiveRows(storage,from,through){
 if(storage.sql)return [...storage.sql.exec('SELECT payload FROM public_verification_archive WHERE date>=? AND date<=?',from,through)].map(r=>JSON.parse(r.payload));
 return [...(await storage.list({prefix:'history:public-row:'})).values()].filter(r=>r.date>=from&&r.date<=through);
}
