# 定期実行の監視と復旧

GitHub Actions自体のcron欠落を検出するため、既存Cloudflare Workerの毎分cronから、独立したWorkflowMonitor Durable Objectを呼び出す。GitHubへの確認は通常10分間隔。自動復旧を開始した後は次の成功・異常判定まで1分間隔で追跡し、正常化後は通常間隔に戻る。監視コードの版を更新した際は確認待ち時間だけをリセットし、再試行回数は保持する。オッズ取得とは別のwaitUntilと別ストレージで動作し、一方の失敗で他方を止めない。予想係数・検証条件・保存済み原記録を監視処理から変更しない。

## 対象と猶予

- update-pages.yml：08:00〜21:59、5分周期＋20分の猶予。
- verification-data.yml：毎時15分、60分周期＋30分の猶予。capture/evaluateの手動実行は照合の成功に数えない。手動hourly実行はrun-nameで区別する。
- daily-learning.yml：02:10、日次周期＋90分の猶予。係数更新は既存の月次検証・採否条件に従う。

時刻の比較は起動時刻基準。失敗は猶予内でも検出する。実行中・待機中は重複起動せず、タイムアウト目安超過はRUNNING_LATEとして報告する。長時間待機を監視から強制キャンセルしない。

## 回数制限と安全性

遅延・失敗時、active状態の既知の3ワークフローだけをmainにworkflow_dispatchする。結果照合はmode=hourlyを明示する。監視対象リポジトリ・ワークフロー・refは入力で変更できない。無効化されたワークフローは勝手に有効化しない。PRチェックや公開承認を迂回しない。

同一障害の自動起動は最大2回。1回目の後は30分、2回目の後は60分待つ。回数・待機期限は送信前に永続保存する。送信結果不明のタイムアウトでも直ちに再送しない。次の成功確認で障害を解消し、制限をリセットする。上限到達後は人がGitHub Actionsのログを確認・手動実行し、成功を確認するまで起動を繰り返さない。

401/403/レート制限時は権限異常として扱い、Retry-Afterやレート制限解除時刻まで待つ。GitHubのエラーボディやトークンは公開・ログ出力しない。1回の確認は基本3リクエスト、復旧時のみ状態確認と起動を追加する。公式レースデータへのリクエストは追加しない。

## 専用トークンの登録（初回・期限更新時）

1. https://github.com/settings/personal-access-tokens/new でFine-grained tokenを作成する。
2. 対象をkkk-mmmm/boatrace-app-siteのみに限定。Repository permissionsのActionsをRead and write。Metadataの自動Read以外の権限は付与不要。有効期限を設定する。
3. 対象リポジトリのSettings → Secrets and variables → ActionsでRepository secret **GH_MONITOR_TOKEN** に保存する。チャット・ソース・Variablesへ値を書かない。
4. main取り込み後、**Deploy Cloudflare odds worker**をworkflow_dispatchする。既存Cloudflareデプロイ権限を使い、トークンをWorkerの暗号化Secretに同期する。
5. `/v1/health`のrecovery_configured=trueとchecked_at更新、次の正常実行を確認する。

トークン未設定でも公開リポジトリの実行状況は読み取り監視し、必要時TOKEN_REQUIREDと表示する。無効・期限切れのトークンはCHECK_FAILED/HTTP_401等になる。期限更新後は同名Secretを更新してデプロイを再実行する。トークンを廃止するときはGitHub側で失効させ、Cloudflare WorkerのSettings → Variables and Secretsでも削除する。GitHub Secretを削除しただけでは既存Worker Secretは消えない。

## 状態確認

https://boatrace-odds.kazu80504.workers.dev/v1/health は読み取り専用。アクセスによるGitHub確認・再試行・公式取得は行わない。status、checked_at、各処理のlast_success、recovery、attemptsを返す。30分を超えて監視記録が更新されていない場合はSTALE。ログはCloudflare Observabilityのworkflow_monitorで検索する。

ATTENTION時はGitHub Actionsの該当処理を確認する。TOKEN_REQUIREDはトークン未登録、AUTH_BLOCKED/HTTP_401/HTTP_403は権限・有効期限、WORKFLOW_DISABLEDは無効化、EXHAUSTEDは再試行上限。CHECK_FAILEDは取得障害であり、最終成功時刻を消さない。観測できなかった処理はNOT_CHECKEDとして区別する。

Cloudflare自体の停止とGitHubの停止を同時に自動復旧するものではない。外部通知は送信しない。別の死活監視サービスを導入する場合は、この読み取り専用URLのHTTPだけでなくstatus/checked_atも確認する。
