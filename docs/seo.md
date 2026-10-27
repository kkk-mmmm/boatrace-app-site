# フネヨミの検索・共有設定

正式サイト名は「フネヨミ | ボートレース予想とオッズ」、略称は「フネヨミ」です。名称・公開URL・テーマ色は `site/branding.json` に集約。検索タイトルは「場名＋ボートレース・競艇のAI予想とオッズ｜フネヨミ」。AI予想は統計モデルによる算出と明記し、的中率や生成AIの利用を誇張しません。meta keywords はGoogle検索で使われないため追加しません。

公開時にトップと全24場の `/venues/01/` ～ `/venues/24/` を生成します。各場は固有のtitle・description・自己canonical・OGP・WebPage/BreadcrumbListを持ち、説明と取得済みの開催・出走情報をJavaScriptなしでも読めるHTMLへ出力します。更新確認が10分より古い・別日の資料は静的な開催情報に載せず、取得待ちを明記します。ハッシュの検証記録・リリースノートは独立した検索ページとしては登録しません。

WebSite構造化データはトップページだけに配置し、nameは正式名、alternateNameには略称と旧表記を設定します。全ページのog:site_nameとapplication-nameを正式名へ揃え、トップのtitle・H1も同じ値にします。場別ページは場名を含む固有タイトルを維持します。

画像はヘッダーのbrand-iconと同じオリジナルの舟と波のSVGを使用。検索用rel=iconは安定したURLのfavicon.svgと、同じ絵柄のicon-192.png（192×192、48の倍数）を指定します。PNGアイコン（32/180/192/512）と1200×630の共有画像を用意しています。変更する場合はChrome CDPを9222で起動し `node site/generate-icons.mjs` で再生成。名称変更時はHTMLのブランド表記・共有画像も更新してください。

## 公開後の外部設定

- Search Consoleで `https://funeyomi.win/` のURLプレフィックスを所有権確認し、`https://funeyomi.win/sitemap.xml` を送信します。所有権確認はユーザーにより完了済みです。今回の変更後はトップURLのURL検査から再クロールを依頼できます。Google側の選択・反映時期は指定できません。
- Search ConsoleのURL検査でトップと各場のURLを確認します。検索順位・クロール・インデックス登録は保証できません。
- 独自ドメインのホスト直下に `robots.txt` を生成し、サイトマップを案内します。旧GitHub Pagesのプロジェクト配下のrobots.txtは旧ホスト直下のポリシーを変更するものではありません。
- 商標・同名サービスの網羅的調査は未実施です。

`node --test site/test_seo.mjs` でcanonical・タイトル・構造化データ・鮮度・画像寸法を検証します。

`Verify the published site in Chromium` は実配信HTMLのサイト名と構造化データ、Googlebot-Imageでの画像取得（HTTP・Content-Type・寸法・X-Robots-Tag）、robots.txtとブランドアイコンとの一致を確認します。
