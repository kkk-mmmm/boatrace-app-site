# funeyomi.win への切り替え

取得・DNS管理: Cloudflare Registrar（ユーザー確認済み）。設定先は `site/domain-migration.json`。

1. Cloudflare DNSで `@` のAを185.199.108.153、185.199.109.153、185.199.110.153、185.199.111.153の4件、`www` のCNAMEを `kkk-mmmm.github.io` にする。すべてDNSのみ（灰色の雲）。
2. Workerは移行前に新旧originを明示的に許可する。DNSと証明書の確認前には、取得元URLやcanonicalを変更しない。
3. 公開リポジトリの `configure-domain.yml` を実行。公開DNSを検査してからPagesのカスタムドメインを設定し、HTTPSを検査する。異なる既存カスタムドメインは上書きしない。証明書発行待ちは `CERTIFICATE_PENDING` として区別する。APIが権限不足ならGitHubのSettings→Pagesで同じ設定を手動で行う必要がある。
4. DNS・Pages設定・HTTPSが整ってから、brandingのbase_url、WorkerのSITE_ORIGIN/取得元URL、公開検証とキャッシュ補完用URLを新ドメインへ変更し、テスト・公開を行う。
5. 新ドメインのトップ・24場ページ・アイコン・サイトマップと、WorkerからのCORS応答を確認する。移行期間は旧originのアクセスも許可する。

Search Consoleの新プロパティの所有権確認・サイトマップ送信は別途必要。DNSを編集する接続は現在利用できず、DNS設定はユーザー操作が必要。
