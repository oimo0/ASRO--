# ASRO Preview

HTML・CSS・JavaScript・画像などが入った**複数ファイルのWebサイトを、ブラウザだけでプレビュー**できる静的アプリ。

ログイン・ビルド・サーバーへのファイル送信は不要。シンプルな画面でファイル一式を開けます。

## できること

- **複数ファイル選択**：HTML・CSS・JS・JSON・画像などを一度に選択
- **フォルダ選択 / ドロップ**：フォルダ構造と相対パスを維持
- **ZIP**：普通のZIPに含まれるファイルをブラウザ内で解凍（共通トップフォルダは自動除去）
- **HTML表示**：`index.html` を自動検出。複数HTML間で切り替え、HTMLリンクで移動
- **関連ファイルの読み込み**：`<link href="./style.css">`、`<script src="./app.js">`、画像・フォントなど
- **JavaScriptモジュール**：静的import・export・動的importをインポートマップで解決
- **ローカルfetch**：`fetch('./data.json')` などは読み込んだファイルから取得（※HTMLからの相対パス）
- **コード表示**：JS・CSS・JSON・テキストをファイル一覧から確認
- **レスポンシブ**：PC・スマホ対応

## 使い方

1. `index.html` を開くか、このリポジトリを静的Webサイトとして公開。
2. 「ファイルを選ぶ」「フォルダを選ぶ」、またはドラッグ＆ドロップで読み込む。ZIPもそのまま開ける。
3. 自動でHTMLが表示される。HTMLが複数ある場合は右上の選択欄で切り替え。
4. さらにファイル・フォルダを追加できる。新規作業時は「新しいプロジェクト」。

複数ファイルを**単なるファイル選択**で読み込む場合、ブラウザはフォルダの情報を渡さない。`assets/` などのサブフォルダがあるプロジェクトは、**フォルダを選ぶかZIPで読み込む**こと。

### 配置

ビルド不要。次のファイルをそのまま配置する。

```text
index.html
style.css
app.js
zip.js
```

GitHub Pagesを使う場合は **Settings → Pages → Deploy from a branch → main / (root)** で公開できる。ローカルでの確認はファイルを同じフォルダに置いて `index.html` を開くか、`python3 -m http.server 8080` などのローカルWebサーバーで配信する。

## 安全性とプライバシー

- 選択したファイルは**サーバーへアップロードされない**。ブラウザのメモリ内で処理し、プロジェクトを閉じると参照を解放する。
- HTML / JavaScriptの実行は `sandbox="allow-scripts"` を付けた**不透明オリジン**のiframeで行う。`allow-same-origin` を使わず、親ページのDOM・Cookie・ストレージにアクセスさせない。
- 相対ファイル参照は `data:` URLに置き換える。ローカル `fetch` は、**読み込んだファイルだけ**を親ページから `postMessage` で渡す。
- プレビューに含まれる外部リンクや外部API呼び出しが、**ブラウザから外部へアクセスすることはある**。不明なコードのプレビューには注意。
- インポートできるのは最大2,000ファイル・150MB。ZIPは100MB以下、標準ZIPの `store` / `deflate` に対応。暗号化ZIP・分割ZIP・ZIP64は非対応。

## 制約

- **ブラウザで動くWebサイトのプレビュー**が目的。Node.js・PHP・Pythonサーバー、DB、任意のnpmパッケージの実行・導入はできない。
- TypeScript・JSX・React・Vue・Svelteの**未ビルドのソースコード**はコンパイルしない。Vite等の `dist/` や `build/` フォルダを読み込んでね。
- 通常のCSS/JSの外部リソース参照やHTMLリンクは対応するが、JavaScript実行時に組み立てる独自URLや、`import.meta.url` に依存する全パターン、XHR、SPAの履歴制御、外部サービスのCORS制限まで完全再現するものではない。
- JavaScriptの読み込みは1ファイル8MBまで。閲覧するソースコードは2MB超でテキスト表示を省略する。
- HTML上のプレビューで使ったURLは、通常の公開Web URLとして共有できない（ローカルメモリ内のデータだから）。

## 構成

- `index.html`：UI
- `style.css`：PC / スマホ対応のスタイル
- `app.js`：ファイル取込、相対パス解決、コード/メディア表示、importmap、隔離プレビュー
- `zip.js`：ZIP展開（ブラウザ標準の `DecompressionStream` を使用）

© ASRO. All rights reserved.
