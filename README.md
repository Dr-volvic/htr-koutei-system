# 700B ポリッシング作業記録アプリ（MIGAKI）

GitHub Pages（フロントエンド：`docs/`）＋ Google Apps Script（バックエンド：`gas/Code.gs`）構成の、PC常時起動不要な iPad 専用ストップウォッチ＆スプレッドシート連携アプリです。

## 構成
- `docs/` — GitHub Pages で配信する静的フロントエンド（`index.html`, `styles.css`, `app.js`, `config.js`）
- `gas/Code.gs` — Googleスプレッドシート `MASTER_OF_SCHEDULE` を操作する GAS Webアプリ
- `src/`, `public/`, `test/` — 従来の Node.js ローカルサーバー構成（ロジック検証用のユニットテスト `npm test` も引き続き利用可能）

## デプロイ手順

### 1. GAS（Google Apps Script）のセットアップとデプロイ
1. Googleスプレッドシート `MASTER_OF_SCHEDULE` を開き、URLからスプレッドシートID（`/d/` と `/edit` の間の文字列）を控えます。
2. スプレッドシートのメニュー「拡張機能」＞「Apps Script」を開く（または Google Drive から新規 Apps Script プロジェクトを作成）。
3. [gas/Code.gs](file:///C:/Users/yamada/Desktop/700B磨き測定アプリ/gas/Code.gs) の内容をすべて貼り付けて保存します。
4. Apps Script 左メニュー「プロジェクトの設定（歯車アイコン）」＞「スクリプト プロパティ」に以下を2つ登録します：
   - `SPREADSHEET_ID` : 控えたスプレッドシートID
   - `ACCESS_TOKEN` : 現場で使う合言葉（PIN・任意の文字列）
5. 右上「デプロイ」＞「新しいデプロイ」をクリック：
   - 種類の選択：**ウェブアプリ**
   - 次のユーザーとして実行：**自分**
   - アクセスできるユーザー：**全員**（※アプリ内の合言葉 `ACCESS_TOKEN` で認証制御します）
6. 「デプロイ」を押して権限を承認し、発行された **ウェブアプリ URL**（`https://script.google.com/macros/s/.../exec`）をコピーします。

### 2. GitHub Pages の設定と公開
1. （任意）[docs/config.js](file:///C:/Users/yamada/Desktop/700B磨き測定アプリ/docs/config.js) の `GAS_WEB_APP_URL` に上記 URL を記入して保存します（空欄のままでもiPad画面の「設定」から入力可能）。
2. GitHub リポジトリを作成し、`.env` や `service-account*.json` が含まれていないことを確認してプッシュします（`.gitignore` で除外済み）。
3. GitHub リポジトリの「Settings」＞「Pages」を開く：
   - Source: `Deploy from a branch`
   - Branch: `main` / Folder: `/docs`
   - 「Save」をクリック。
4. 数分後に表示される公開URL（`https://<ユーザー名>.github.io/<リポジトリ名>/`）を iPad の Safari で開きます。
5. 初回表示される認証モーダルに合言葉（`ACCESS_TOKEN`）を入力して「接続して開始」を押します（Safari の「ホーム画面に追加」をしておくとアプリのように使えます）。
