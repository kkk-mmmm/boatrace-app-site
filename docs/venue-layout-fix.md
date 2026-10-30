# v1.48 開催場のPCレイアウト修正

見出しのflex:autoによる空間拡張を、見出し実寸＋最大640pxの選択情報のgridへ変更し、間隔20pxを確保。モバイルでの既存の表示切替は維持する。

一覧は旧指定のoverflow:visibleと後発のmax-heightが競合していた。高さ制限を残し、overflow-y:auto・overflow-x:hidden・scrollbar-gutter:stableを明示。全24場を一覧の内側でスクロールできるようにする。配色、文字、データ、選択・フィルターの処理は変更しない。

`node --test site/test_venue_layout_browser.mjs` はローカルChromium CDP（既定127.0.0.1:9222）で1440/1024/768/760/390/320pxを検証。ページ横はみ出し、見出しとの距離、リストの境界、最後のカードへの到達を確認する。開催状況は合成の未取得状態を使用する。`VENUE_LAYOUT_SHOTS=1`で/tmpへ各幅の確認画像を出力する。
