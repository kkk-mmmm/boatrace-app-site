import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {liveData, root} from './data.mjs';

export function writeSnapshot(code, output, {failed = false, cacheDirectory = path.join(root,'site/cache')} = {}) {
  const data = liveData(cacheDirectory, Date.now(), code);
  if (failed) data.update = {...data.update,status:'FAILED',attempted_at:new Date().toISOString(),
    message:'この場の自動更新に失敗しました。前回の記録は参考として確認してください。'};
  fs.mkdirSync(path.dirname(output), {recursive:true});
  fs.writeFileSync(output, JSON.stringify(data,null,2)+'\n');
  return data;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [, ,code,output,flag] = process.argv;
    if (!code || !output) throw Error('使用方法: node site/snapshot.mjs 場コード 出力.json [--failed]');
    const data = writeSnapshot(code,output,{failed:flag === '--failed'});
    console.log(JSON.stringify({venue:data.venue,status:data.update.status,races:data.races.length}));
  } catch (error) {console.error(error.message);process.exitCode=1;}
}
