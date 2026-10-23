import crypto from 'node:crypto';
export const decisionHash=d=>crypto.createHash('sha256').update(JSON.stringify(d)).digest('hex');
export function coefficientRelease(decision,previousVersion){
 const version=previousVersion.split('.').map(Number);version[2]++;
 return {version:version.join('.'),date:new Date(Date.parse(decision.checked_at)+9*3600000).toISOString().slice(0,10),title:`${decision.month} 月次係数の自動更新`,
  changes:[`同じ未使用期間の${decision.comparison.races}レースで現行係数と比較し、確率予測の誤差の改善を確認した月次係数を採用しました。`,
   `対数損失 ${decision.comparison.active.log_loss.toFixed(4)} → ${decision.comparison.candidate.log_loss.toFixed(4)}、確率上位10点の的中率 ${(decision.comparison.active.top10_hit_rate*100).toFixed(2)}% → ${(decision.comparison.candidate.top10_hit_rate*100).toFixed(2)}%。`],
  notes:['更新時点の履歴を保持し、既に固定済みの提案は再計算しません。過去検証の改善は将来の的中率・回収率を保証しません。'],
  coefficient_update:{month:decision.month,decision_sha256:decisionHash(decision)}};
}
