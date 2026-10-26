# 公開用mainの保護

対象: kkk-mmmm/boatrace-app-site の main。運営者が単独でも進められるよう、PRは必須、他者のレビュー承認人数は0、必須テストは `main-pr-checks` とします。強制push・削除を禁止し、管理者・Botの迂回は設定しません。PRの取り込みはmerge commitを使い、公開確認が参照するコミットの祖先関係を維持します。squash/rebase mergeでは公開確認の参照が失われるため使いません。

## 有効化の順序

1. Settings → Actions → General → Workflow permissions の「Allow GitHub Actions to create and approve pull requests」を有効にする。広範囲なRead and write permissionsへの変更は不要です。日次更新ワークフローに必要な権限を個別に指定しています。ここで許可しても、ワークフローはPRのレビュー承認を行いません。
2. この対応PRで `main-pr-checks` と既存チェックが成功していることを確認し、merge commitで取り込む。
3. Settings → Rules → Rulesets → New ruleset → Import a ruleset から `docs/main-branch-ruleset.json` を読み込む（インポートできない場合は同じ内容のBranch rulesetを作る）。対象main、Enforcement Active、Bypass listなし。削除制限、強制push禁止、PR必須（必要な承認0・会話解決必須）、必須ステータスmain-pr-checks（最新mainとの整合必須）を確認する。ステータスの提供元はGitHub Actionsを選択する。
4. GET /repos/kkk-mmmm/boatrace-app-site/rulesets と branches/main、ルールの詳細を再取得してActiveで対象とチェックが正しいことを確認する。次回の日次学習でPR作成→必須チェック→merge→公開を確認する。実データ更新前の段階では運用確認済みとは扱わない。

## 自動更新への対応

オッズ・出走表・展示・結果のWorker取得はこの変更の対象外です。Pagesの定期データ配信もmainへpushしません。履歴・月次係数だけがこれまでmainへ直接pushしていたため、日次ワークフローをデータ専用PRへ変更します。

GITHUB_TOKENで作ったPRは通常のpull_requestイベントを起動しないため、同じ必須チェックをworkflow_dispatchでそのHEADへ明示的に実行します。成功後、HEAD一致を条件に通常のmergeを実行し、管理者迂回は使いません。PR作成権限・テスト・ブランチ整合などで失敗した場合は取り込まず、ブランチ／PRを残して調査します。mainの保護を外したり、失敗時に直接pushへ切り替えたりしません。

公開確認は従来どおりです。コードのPRには確認済みランタイムの公開確認を含め、係数だけの自動更新は既存の検証ゲートを維持します。

## 管理権限について

接続中GitHub AppでRuleset作成APIは403になりました。これはGitHubの管理設定に対する接続権限の制限で、リポジトリの公開／非公開とは別です。設定JSONを用意しただけでは保護は有効になりません。
