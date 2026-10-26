# お問い合わせ用メール

公開用の候補は `contact@funeyomi.win`、運営者表記は「フネヨミ運営者」です。転送先の個人用アドレスはCloudflare管理画面だけに入力し、このリポジトリや公開サイトへ書きません。

1. Cloudflareで `funeyomi.win` を選択し、Email / Email Routing（Email Service表示の場合もあります）を開く。
2. 転送先アドレス（Destination address）を追加し、その受信箱に届く確認リンクで認証する。
3. カスタムアドレス `contact` を作り、アクションを転送（Send to an email）として認証済み転送先を選ぶ。
4. 案内されたMX・SPF・DKIM等のメール用DNSレコードを確認し、追加・有効化する。サイト用A・wwwのCNAME・Search ConsoleのTXTは保持する。既存のメール用MXやSPFがある場合は既存メールとの競合を確認する。
5. 転送先とは別のメールアドレスから `contact@funeyomi.win` へ送信し、迷惑メールフォルダも含め受信を確認する。同じ受信箱から自分宛てに送るテストは重複扱いで表示されないことがある。
6. ユーザーの受信確認後に `site/contact.json` の `verified` をtrueへ変更する。公開メールアドレスだけを記載し、転送先は記録しない。表示変更としてリリースノートを追記し、SEO・公開テストを行い反映する。

Email Routing単体は受信転送用で、通常のメールアプリ向けのメールボックス・送信用SMTPを提供するものではありません。転送先からそのまま返信すると個人用アドレスが相手へ表示される可能性があります。独自ドメインから通常のメールとして返信する場合は、対応するメールホスティング／送信用サービスを別途構成してください。CloudflareのEmail Sending等は別機能であり、受信転送の設定だけで通常の返信機能まで完成するわけではありません。

公式手順: https://developers.cloudflare.com/email-routing/get-started/enable-email-routing/
