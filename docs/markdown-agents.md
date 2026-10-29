# Markdown content negotiation（無料枠で動く独立Worker）

GitHub PagesはAcceptによるレスポンス切替を提供しないため、Cloudflareのプロキシ上に独立Workerを配置する。有料のMarkdown for Agentsや外部変換API、オッズWorkerは使用しない。Workers無料プランのリクエスト・CPU等の上限は適用される。全HTMLリクエストがこのWorkerを通るため、アクセス増加時は無料枠の使用量を確認する。

## 有効化

1. PRを通常のmerge commitでmainへ取り込む。
2. Actionsの **Deploy Cloudflare Markdown gateway** をRun workflowする。既存のCLOUDFLARE_API_TOKENとCLOUDFLARE_ACCOUNT_IDを使用する。Workers Scripts編集権限で別Workerをデプロイし、DNS・ルートの編集権限は追加要求しない。
3. Cloudflare → Workers & Pages → **funeyomi-markdown** → Settings → Domains & Routes → Add → Routeで `funeyomi.win/*` を対象ゾーンfuneyomi.winに追加する。利用可能なら失敗時の動作は **Fail open** を選び、制限到達時は元のHTMLを配信する。Custom Domainとしての追加はしない。wwwからのリダイレクトは従来のまま。
4. サイト用DNSはプロキシ済み、SSLはFull (strict)、GitHub PagesのHTTPSを維持。メールDNSは変更しない。
5. 下記で確認する。

```
curl -i -H 'Accept: text/markdown' https://funeyomi.win/guide/
curl -I -H 'Accept: text/html' https://funeyomi.win/guide/
```

MarkdownはContent-Type: text/markdown、Cache-Control: no-store、Vary: Acceptを含む。通常のブラウザはHTML。MarkdownにHTMLのETagやContent-Encodingを引き継がない。CloudflareのCache Everything等のルールをこのルートで併用しない。導入前のキャッシュが残る場合はルート有効化時にキャッシュをパージする。

## 範囲と制約

ルート・24場・情報記事の既知の末尾スラッシュURLだけを変換。画像、robots.txt、JSON、API、不明なURL、エラーレスポンスはそのまま通す。GET/HEADのみ対象。明示的なtext/markdownの指定が必要で、q=0を尊重し、HTMLの優先度が高い場合はHTMLを返す。Vary: Acceptで表現を区別し、Markdownを保存させない。

Cloudflare組込みHTMLRewriterでスクリプト・ナビ・非表示要素を除き、見出し・リンク・リスト・表のテキストを抽出する簡易Markdown。完全なHTML変換やブラウザ実行ではない。JavaScriptで取得する最新オッズ・動的な検証一覧は含まない旨を先頭へ明示。HTTP上のホスト名・任意URLを変換先として指定する機能は設けない。同一ホストへのfetchはCloudflare Worker RouteからGitHub Pagesのオリジンへ流れる。Custom Domainとして設定するとこの構成にならない。

## 検証・復旧

`node --test cloudflare/markdown/test_worker.mjs cloudflare/odds/test_markdown_runtime.mjs`。後者はcloudflare/oddsでnpm ciしたMiniflareを使用。実WorkerのHTMLRewriterで日本語・リンク・表・除去対象・HEADを検証する。

異常時はCloudflareで追加したWorker Routeだけを削除し、GitHub Pagesへの元のHTML配信へ戻す。オッズWorker・DNSレコード・証明書は削除しない。
