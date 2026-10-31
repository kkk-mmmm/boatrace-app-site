# レース画面の名称・導線整理 v1.60

比較元は `ad55651a65bbdc9847bb6d961b9a289ddb8b2cfd`。公開デプロイ、公開承認ファイルの更新、データ取得や保存記録の変更は行わない。

## 変更内容

- 「回収率上位」を「高配当条件」へ変更。表示表・空表示の直下へ、既存の `RETURN_CANDIDATE_RULE` を参照する常設説明を配置。抽出条件と推定確率順は維持。
- 1号艇1着の周辺確率を表すラベルのみ「1号艇1着確率」「1号艇以外が1着」へ変更。案内・条件選択・検証画面・ガイドの表示も合わせる。`in` / `other` / `in50` 等の内部キー、実績回収率、決まり手、過去リリースは維持。
- 主要タブは予想／出走表・展示／展開予想／結果の4つ。出走表側の下位タブは出走表／展示情報のみ。既存のタブ・パネルIDは可能な限り再利用し、ARIA・ロービングフォーカス・左右矢印／Home／Endを合わせる。
- 評価・自信度は予想タブの `assessment-disclosure`、取得状況・計算内訳は主要タブ直下の `race-data-details` へ移動。内容、表内スクロール、レーダー表示切替は削除しない。レーダーのCDNは予想タブで開閉領域を開いたときにだけ要求する。
- スマホは選択中の場と変更ボタンを常設し、全24場セレクトと条件・候補一覧は通常の開閉パネルにまとめる。モーダルではないので背景をロックしない。閉じる／Escapeは元の閲覧位置と変更ボタンへのフォーカスを戻す。選択時は古い詳細を消してから読み込み、完了後に対象の詳細へフォーカスを移す。
- PCは場・セレクト・開催状態を上段へまとめる。通常は本日開催のショートカットを最大2段（幅1050以下は4列、それより広い場合は6列）。続きは展開ボタン、全24場はセレクトでも選べる。
- 条件を操作すると明示的な「絞り込み結果」へ移り、開催の「すべて」で24場も一覧表示できる。条件解除で本日開催のショートカットへ戻る。選択中の場は候補から外れても上段へ残す。
- 同じキーのDOMを更新し、開閉・選択買い目・タブ・フォーカス・閲覧位置・プレイヤーを維持。レース指定のショートカットも読み込み世代を照合し、遅い過去リクエストが新しい選択を上書きしない。
- 対象の旧開催場／タブCSSを削除し、末尾のv1.60ブロックへ整理。320pxと200%文字拡大で見つかったヘッダー起因のはみ出しと固定バーの収まりも修正。

## 変更ファイル

- 画面：`site/public/index.html`、`app.mjs`、`style.css`、`charts.mjs`
- 関連する名称：`site/public/experiments-view.mjs`、`strategy-page.mjs`、`site/info-pages.mjs`、`site/interim-article.mjs`
- 検証：`site/test_compact_ui_browser.mjs`（新規）、`test_chart_loading.mjs`、`test_development_browser.mjs`、`test_venue_layout_browser.mjs`、`site/verify-live.mjs`
- 履歴：`site/releases.json`（v1.60.0の追記のみ）

`site/public/view.mjs`、`development.mjs`、`development-simulation.mjs`、`development-player.mjs`、予想モデル・取得・保存ロジックは変更していない。

## 確認

- `.github/workflows/main-pr-checks.yml` のNodeテスト162件、Pythonテスト4件が成功。
- Chromiumのブラウザーテスト3件が成功。320・390・768・1024・1440px、4タブとARIA/キー操作、44px以上の主要タブ、2段ショートカットと展開、全24場、パネル開閉・キャンセル、条件解除、非開催・未取得・取得失敗・結果未確定/失敗/確定、応答の逆転、締切前後、展開からスジ候補、更新時の選択・開閉・フォーカス・閲覧位置を確認。
- 実際の定期処理に登録された300000ms・15000msのコールバックも実行。再生コントローラーは既存の回帰テストで停止・再開・更新・シーク・タブ非表示・reduced-motionを確認。
- 全要素の算出フォントサイズを2倍にした文字拡大を320・1440pxで確認。ページ全体のはみ出しは `scrollWidth <= clientWidth` で判定（モバイルの `innerWidth` ははみ出し時に広がるため使用しない）。
- 静的ビルド、`git diff --check`、リリース形式・追記チェックを実行。

ブラウザー確認の再実行（127.0.0.1:9222でChromium CDPを起動した環境）：

```sh
COMPACT_UI_SHOTS=/tmp/compact-ui-review node --test --test-concurrency=1 \
  site/test_compact_ui_browser.mjs \
  site/test_venue_layout_browser.mjs \
  site/test_development_browser.mjs
```

サンプルはOSの一時ディレクトリに生成するテストデータ。公開ビルドの入力へ書き込まない。スクリーンショットも一時ディレクトリへ記録する。

## 未確認

実機のiOS Safari／Androidブラウザーと支援技術による読み上げは未確認。公開サイトへの本番反映・本番APIでの新UIの確認は実施しない。`site/verify-live.mjs` は新しいDOM・プレイヤー参照へ追従させ、構文を確認したが、未公開UIに対する本番スモークテストは未実施。
