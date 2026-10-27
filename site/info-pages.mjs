import fs from 'node:fs';
import {escape} from './public/view.mjs';
export const contact=JSON.parse(fs.readFileSync(new URL('./contact.json',import.meta.url)));
export function informationPages(settings=contact){
 const email=String(settings.email||'');
 if(settings.verified&&!/^[a-z0-9._+-]+@funeyomi\.win$/i.test(email))throw Error('公開用メールアドレスを確認してください');
 return [
 {slug:'about',title:'運営情報・お問い合わせ',description:'フネヨミの運営者、提供する情報とお問い合わせ窓口をご案内します。',content:`
 <section><h2>運営について</h2><dl><dt>サイト名</dt><dd>フネヨミ｜ボートレース・競艇予想</dd><dt>運営者</dt><dd>${escape(settings.operator)}</dd></dl><p>全国24場の出走表・展示情報・3連単オッズと、統計モデルによるAI予想を掲載する非公式の情報サイトです。BOAT RACEの公式サービスではありません。投票・購入機能はありません。</p></section>
 <section><h2>お問い合わせ</h2>${settings.verified?`<p>ご意見や表示・データの不具合は <a href="mailto:${escape(email)}">${escape(email)}</a> へお寄せください。</p><p>不具合のご連絡には、開催日・場名・レース番号・閲覧端末・表示された内容を添えていただくと確認がスムーズです。パスワードや決済情報などは送らないでください。</p>`:'<p>お問い合わせ用メールアドレスは準備中です。開設・受信確認後に掲載します。</p>'}</section>
 <section><h2>掲載情報について</h2><p>出走表・展示・オッズ・結果などの取得元は <a href="https://www.boatrace.jp/" target="_blank" rel="noopener noreferrer">BOAT RACE オフィシャルウェブサイト</a> です。データには取得の遅れや欠損があるため、画面の取得時刻・更新状態を確認し、最終的な締切・オッズ・払戻は公式情報と照合してください。</p><p>予想は統計モデルによる推定で、的中や利益を保証しません。計算方法や注意点は <a href="./guide/">予想の見方</a> をご覧ください。</p></section>`},
 {slug:'verification',title:'予想実績・確率と期待値の検証',description:'締切前の保存予想と公式結果を照合。直近7日のレース別実績と、30完了日の確率・期待値・仮想回収率の検証を確認できます。実際の購入履歴ではありません。',module:'./verification-page.mjs',content:`
 <p>保存した予想を各点100円で購入したと仮定した、直近7日のレース別実績と30完了日の確率・期待値の検証です。記録のあるレースだけを表示し、未保存・未照合を不的中に含めません。全レースや実際の購入履歴の成績ではありません。</p>
 <p class="small-note">条件を固定して期間を通して調べる企画と終了記事は、<a href="./#archive">検証企画・記事</a>から確認できます。</p>
 <p id="validation-quality-status" class="small-note" role="status"></p>
 <section id="validation-quality" class="validation-quality" aria-label="確率と期待値の検証">確率・期待値の検証を確認しています。</section>
 <h2>日別の保存予想と結果（直近7日）</h2>
 <div class="verification-controls"><label>開催場 <select id="verification-venue" aria-label="検証する開催場"></select></label><button id="verification-refresh">表示を更新 ↻</button></div>
 <div id="verification-days" class="verification-days" role="group" aria-label="検証する日付"></div><p id="verification-status" class="small-note" role="status">記録を確認しています。</p><p id="verification-summary"></p><div id="verification-records"></div><button id="verification-more" hidden>追加で20レース見る</button><p id="verification-method" class="small-note"></p>
 <p class="small-note">公開対象は直近7日、内部の予想・結果は学習・検証用に30日以上保持します。履歴は毎日更新し、係数の更新は月1回の検証条件を維持します。</p>`},
 {slug:'guide',title:'予想の見方',description:'推定確率・期待値・オッズ・スジ候補・展開予想・結果比較の読み方と、データ更新の仕組みを説明します。',content:`
 <nav class="guide-contents" aria-label="このページの目次"><a href="./guide/#probability">推定確率</a><a href="./guide/#expected-value">期待値</a><a href="./guide/#data-updates">データ更新</a><a href="./guide/#saved">保存予想と結果</a></nav>
 <section id="probability"><h2>推定確率と的中率</h2><p>各買い目の「推定確率」はモデルが計算した確率です。実際のレースで測った的中率を表す数値ではありません。全120通りの3連単へ確率を配分し、推定確率上位・期待値上位を切り替えて10点ずつ確認できます。</p><p>「イン逃げ想定」は1号艇が1着になる買い目の確率の合計、「それ以外」は2〜6号艇が1着になる確率の合計です。実際の進入コースや、決まり手が「逃げ」になる確率とは異なります。</p></section>
 <section id="expected-value"><h2>期待値の読み方</h2><p><strong>期待値 ＝ 推定確率 × 取得時点のオッズ</strong>。推定確率10%・オッズ12.0倍なら期待値は1.20です。100円あたりの推定払戻は120円、差額は＋20円という計算ですが、単発のレースの利益や、繰り返した場合の回収率を保証しません。</p><p>推定確率の誤差や締切までのオッズ変動により、期待値も変わります。オッズ未取得の買い目は期待値を算出できません。各買い目の期待値は単独の値で、複数買い目全体の期待値や利益を示すものではありません。</p></section>
 <section><h2>厳選レースとスジ候補</h2><p>厳選レースは表示更新時点から締切まで1時間以内で、新鮮なオッズがあるレースが対象です。1号艇1着の推定確率70%以上・30%以下をそれぞれ分類し、残りから期待値1.0超を高い順に表示します。分類間のレースは重複させません。条件に合うレースがなければ理由を表示します。</p><p>買い目を選ぶと、同じ1着を軸に2・3着の入れ替えや相手替えから、期待値順にスジ候補を提案します。複数選択時は候補を統合し、選択済みと重複を除いて最大10点表示します。通常、同一レースの異なる3連単が同時に的中することはありません。</p></section>
 <section id="data-updates"><h2>データの取得と更新</h2><p>Cloudflareで公式データを定期取得し、閲覧者で共有しています。「表示を更新」はCloudflareが保持する最新データの読み直しです。ボタンを押すたびに公式サイトへ取得を要求するものではありません。</p><div class="table-wrap"><table><thead><tr><th>データ</th><th>更新の目安</th></tr></thead><tbody><tr><td>出走表</td><td>朝7時以降・締切30分前</td></tr><tr><td>展示情報</td><td>締切10分前。未提供なら5分前に再確認</td></tr><tr><td>オッズ</td><td>定期取得。画面に取得状況を表示</td></tr><tr><td>確定結果</td><td>締切5分後から5分間隔。確定後は取得を停止</td></tr><tr><td>過去の履歴</td><td>毎日更新。モデル係数は月1回、比較検証を通過した場合に更新</td></tr></tbody></table></div><p>更新時刻は目安です。配信側の未提供・通信状況・処理の遅れにより、取得できない場合もあります。「未確認」「取得失敗」はゼロを意味しません。画面の取得時刻・欠場・進入変化の表示を確認してください。</p></section>
 <section id="saved"><h2>保存予想と結果の比較</h2><p>締切3分前以前の、最新の有効な予想・オッズ・期待値を固定し、当日の締切後も表示します。必ず締切ちょうど3分前のオッズを取得できるという意味ではありません。保存できていない場合は比較できない理由を表示します。</p><p>結果タブでは確定着順・本番ST・進入・決まり手・払戻と、締切前に保存した予想の確率順位や期待値を比較できます。保存時オッズを確定払戻で置き換えません。上位10点への該当は予想との照合であり、実際の購入や収益の記録ではありません。</p></section>
 <section><h2>モデル・展示・展開予想</h2><p>AI予想は、直近365日の選手ごとの着順・枠別1着率・平均得点・ST・ST順位・安定度・決まり手と、場別傾向などを使う統計モデルです。生成AI APIによる予想ではありません。履歴は毎日更新し、係数は月1回の比較検証に基づいて採用します。再学習のたびに採用されるとは限りません。</p><p>開催日・レース区分によるST傾向や、展示と本番の差は、照合できた資料がある場合に使用します。展示STから本番STへの差は実際に対応する両方のSTが揃った記録から集計し、展示の欠損値をゼロで補いません。件数が少ない傾向は過度に強く扱いません。</p><p>展開予想のアニメーションは、選択した艇が勝つ条件を仮定した模式図です。本番映像や実際の走行経路の再現ではありません。1号艇以外のパターンは、その艇の1着推定確率が20%以上の場合に表示します。</p></section>
 <p><a class="source-link" href="./">今日のレースを見る →</a></p>`}
 ];
}
export function informationTemplate(template,page){
 // Keep the shared stylesheet/CSP, but informational pages never fetch race data.
 // Derive every header from the home template; standalone pages use links for its view buttons.
 const sourceHeader=template.match(/<header[\s\S]*?<\/header>/)?.[0];
 if(!sourceHeader)throw Error('共通ヘッダーを確認できません');
 const routes={live:'./',archive:'./#archive',releases:'./#releases'};
 let sharedHeader=sourceHeader.replace(/<button\b[^>]*id="(live|archive|releases)-tab"[^>]*>([\s\S]*?)<\/button>/g,(_,view,label)=>`<a href="${routes[view]}">${label}</a>`);
 if(page.slug==='verification')sharedHeader=sharedHeader.replace('href="./verification/"','href="./verification/" aria-current="page"');
 return template.replace(/<script defer src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>\s*/, '').replace(/<script type="module" src="\.\/app\.mjs"><\/script>\s*/, '')
 .replace(/<header[\s\S]*?<\/header>/,()=>sharedHeader)
 .replace(/<main>[\s\S]*?<\/main>/,`<main><article class="information-page"><h1>${escape(page.title)}</h1>${page.content}</article></main>`)
 .replace(/<nav class="venue-seo-links"[\s\S]*?<\/nav>/,'')
 .replace('</head>',(page.module?`<script type="module" src="${page.module}"></script>`:'')+'</head>');
}
