import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {save, verify} from './save_prediction.mjs';

const base = path.dirname(fileURLToPath(import.meta.url));
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const digest = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const must = (ok, message) => { if (!ok) throw Error(message); };

export function instant(value) {
  must(typeof value === 'string' && /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value)), '日時には秒とタイムゾーンが必要です');
  return Date.parse(value);
}

export function validatePlan(plan, now = Date.now()) {
  must(plan.venue === '桐生', '対応会場は桐生のみです');
  must(typeof plan.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(plan.date)
    && Number.isFinite(Date.parse(plan.date))
    && new Date(plan.date).toISOString().slice(0, 10) === plan.date, '開催日が不正です');
  must(Array.isArray(plan.race_numbers) && plan.race_numbers.length > 0
    && new Set(plan.race_numbers).size === plan.race_numbers.length
    && plan.race_numbers.every(n => Number.isInteger(n) && n >= 1 && n <= 12), '対象レース番号が不正・重複しています');
  must(Array.isArray(plan.deadline_at) && plan.deadline_at.length === plan.race_numbers.length,
    '締切は対象レースと同じ順序・件数で指定してください');
  must(plan.results_viewed === false, '結果未参照の確認が必要です');
  const selected = instant(plan.selected_at);
  must(selected <= now, '選定時刻が未来です');
  for (const deadline of plan.deadline_at) {
    const t = instant(deadline);
    must(new Date(t + 9 * 3600000).toISOString().slice(0, 10) === plan.date, '締切と開催日が一致しません');
    must(selected < t, '選定はすべての対象レースの締切前に行ってください');
  }
  return plan;
}

function localFile(root, relative) {
  must(typeof relative === 'string' && relative.length > 0 && !path.isAbsolute(relative), '資料の相対パスが必要です');
  const target = fs.realpathSync(path.resolve(root, relative));
  must(target.startsWith(fs.realpathSync(root) + path.sep), 'セッション外の資料は参照できません');
  return target;
}

function checkEvidence(root, source, url, fetchedAt) {
  must(source && source.url === url && instant(source.retrieved_at) === instant(fetchedAt), '入力と出典対応記録が一致しません');
  must(digest(localFile(root, source.evidence_file)) === source.evidence_sha256, '取得記録が変更されています');
}

function persist(logPath, run) {
  const temporary = `${logPath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(run, null, 2) + '\n', {flag: 'wx'});
    fs.renameSync(temporary, logPath);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

export function saveSelected(directory) {
  const root = fs.realpathSync(directory);
  const planPath = path.join(root, '対象レース選定記録.json');
  const mappingPath = path.join(root, '出典対応記録.json');
  const plan = validatePlan(read(planPath));
  const mapping = read(mappingPath);
  must(Array.isArray(mapping.records), '出典対応記録のrecordsが必要です');
  must(new Set(mapping.records.map(x => x.race_no)).size === mapping.records.length, '出典対応記録のレースが重複しています');
  const html = fs.readFileSync(path.join(base, 'model/original_artifact.html'));
  const logPath = path.join(root, '保存実行記録.json');
  const run = {
    schema_version: 1,
    started_at: new Date().toISOString(),
    selection_sha256: digest(planPath),
    source_mapping_sha256: digest(mappingPath),
    results_viewed: false,
    records: plan.race_numbers.map(n => ({
      race_no: n,
      request_file: `requests/kiryu_${plan.date.replaceAll('-', '')}_R${n}_request.json`,
      request_sha256: null,
      status: 'PENDING',
    })),
  };
  // Reserve before saving any prediction. A crash leaves an explicit incomplete
  // run and prevents choosing new predictions by repeating the command.
  fs.writeFileSync(logPath, JSON.stringify(run, null, 2) + '\n', {flag: 'wx'});
  for (const [index, item] of run.records.entries()) {
    try {
      must(digest(planPath) === run.selection_sha256 && digest(mappingPath) === run.source_mapping_sha256,
        '保存中に選定・出典対応記録が変更されました');
      const requestPath = localFile(root, item.request_file);
      item.request_sha256 = digest(requestPath);
      const request = read(requestPath);
      must(request.date === plan.date && request.race_no === item.race_no
        && request.deadline_at === plan.deadline_at[index], '選定記録と入力が一致しません');
      const observation = mapping.records.find(x => x.race_no === item.race_no);
      checkEvidence(root, observation?.input_evidence, request.input_source_url, request.input_fetched_at);
      if (request.odds != null) {
        checkEvidence(root, observation?.odds_evidence, request.odds.source_url, request.odds.fetched_at);
      }
      fs.mkdirSync(path.join(root, 'saved'), {recursive: true});
      localFile(root, 'saved');
      const saved = save(request, path.join(root, 'saved'), html);
      verify(saved);
      item.status = 'SAVED_BEFORE_DEADLINE_LOCAL_EVIDENCE';
      item.prediction_file = path.relative(root, path.join(saved, 'prediction.json')).split(path.sep).join('/');
      item.prediction_sha256 = digest(path.join(saved, 'prediction.json'));
      item.receipt_sha256 = digest(path.join(saved, 'receipt.json'));
    } catch (error) {
      item.status = 'NOT_SAVED';
      item.reason = error.message;
    }
    item.processed_at = new Date().toISOString();
    persist(logPath, run);
  }
  run.completed_at = new Date().toISOString();
  persist(logPath, run);
  return run;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    must(process.argv.length === 3, '使用方法: node tools/prerace/save_selected.mjs セッションフォルダ');
    const run = saveSelected(process.argv[2]);
    console.log(JSON.stringify(run, null, 2));
    // A log was successfully written, but callers must not mistake partial
    // prediction failures for a completely successful save.
    if (run.records.some(x => x.status !== 'SAVED_BEFORE_DEADLINE_LOCAL_EVIDENCE')) process.exitCode = 1;
  } catch (error) {
    console.error('保存を完了できませんでした: ' + error.message);
    process.exitCode = 1;
  }
}
