import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function oddsProvider({environment=process.env,file=new URL('./odds-provider.json',import.meta.url)}={}) {
  const value=environment.BOATRACE_ODDS_API_URL || JSON.parse(fs.readFileSync(file,'utf8')).api_url || '';
  if(value) {
    const url=new URL(value);
    if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/v1/odds' || url.search || url.hash)throw Error('オッズ接続先にはHTTPSの /v1/odds を指定してください');
  }
  return value;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{console.log(oddsProvider());}catch(error){console.error(error.message);process.exitCode=1;}
}
