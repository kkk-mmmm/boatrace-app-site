# コンテンツクリック計測

GTMコンテナ GTM-TP88TNCZ に、操作ごとに event: content_click を1回通知します。GTM側で既存のGA4イベントタグと3つのデータレイヤー変数を使用します。

|パラメータ|内容例|
|---|---|
|content_id|link_/expected-value/、venue_01、race_01_3、tab_value-tab、development_play_01_3|
|content_name|リンクの表示名、選択項目の名称|
|placement|header、footer、home_explainer、live-content、upcoming-content、opportunities-content等|

クリック委譲により動的に作成されるボタンにも対応します。selectによる開催場変更はchangeイベントとして通知します。イベントは操作を表し、表示回数や予想の的中を表しません。画面を開いたときの展開図の自動再生はクリックとして数えません。無効ボタン・右クリック・対象外ボタンは通知しません。

内部リンクはpathnameのみを識別に用い、URLのクエリとフラグメントは送信しません。公式リンクはboatrace.jpとそのサブドメインに限定します。入力フォーム・購入・選択買い目や予想データを送る処理は追加しません。GA4の標準page_location等はこの独自パラメータとは別です。

プレビューでサイトを再読み込みし、記事リンク、開催場、レース、確率・期待値タブ、展開図の再生を操作します。Tag Assistantのcontent_clickでタグが1回配信され、Variablesで3値が入ることを確認します。GA4 DebugViewで同じ値を確認してください。GA4受信の確認にはGTMの設定・同意状態・ブラウザ側の送信制限も影響します。

テスト: node --test site/test_analytics.mjs 。GTMやGA4には接続せず、送信キュー・操作識別・重複防止を検証します。
