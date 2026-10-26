# フネヨミの検索・共有設定

名称・公開URL・テーマ色は `site/branding.json` に集約。検索タイトルは「場名＋ボートレース・競艇のAI予想とオッズ｜フネヨミ」。AI予想は統計モデルによる算出と明記し、的中率や生成AIの利用を誇張しません。meta keywords はGoogle検索で使われないため追加しません。

公開時にトップと全24場の `/venues/01/` ～ `/venues/24/` を生成します。各場は固有のtitle・description・自己canonical・OGP・WebPage/BreadcrumbListを持ち、説明と取得済みの開催・出走情報をJavaScriptなしでも読めるHTMLへ出力します。更新確認が10分より古い・別日の資料は静的な開催情報に載せず、取得待ちを明記します。ハッシュの検証記録・リリースノートは独立した検索ページとしては登録しません。

画像はオリジナルの舟と波のSVGを使用。PNGアイコン（32/180/192/512）と1200×630の共有画像を用意しています。変更する場合はChrome CDPを9222で起動し `node site/generate-icons.mjs` で再生成。名称変更時はHTMLのブランド表記・共有画像も更新してください。

## 公開後の外部設定

- Search Consoleで `https://funeyomi.win/` のURLプレフィックスを所有権確認し、`https://funeyomi.win/sitemap.xml` を送信します。認証情報・所有権確認コードは未提供のため登録・送信自体は未実施です。
- Search ConsoleのURL検査でトップと各場のURLを確認します。検索順位・クロール・インデックス登録は保証できません。
- 独自ドメインのホスト直下に `robots.txt` を生成し、サイトマップを案内します。旧GitHub Pagesのプロジェクト配下のrobots.txtは旧ホスト直下のポリシーを変更するものではありません。
- 商標・同名サービスの網羅的調査は未実施です。

`node --test site/test_seo.mjs` でcanonical・タイトル・構造化データ・鮮度・画像寸法を検証します。
