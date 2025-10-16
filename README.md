# Owlanter

**Owlanter** は、Pleasanter サイトのスクリプト開発を効率化する VS Code 拡張機能です。サーバースクリプトとクライアントスクリプトの同期、編集、アップロードを GUI から直感的に操作できます。

## 特徴

- **サイト管理** - 複数の Pleasanter サイトを登録・切替可能
- **スクリプト同期** - Pull / Push / Watch / Diff による双方向同期
- **アップロード機能** - サーバー/クライアントスクリプトを個別にアップロード
- **アクティブスクリプト管理** - GUI からアクティブスクリプトの設定・解除が可能
- **設定同期** - VS Code の設定とプロジェクト設定を自動同期

## インストール

1. VS Code の拡張機能マーケットプレイスから「Owlanter」を検索
2. [Install] をクリックしてインストール

## 使い方

### 初期設定

1. **接続設定の初期化**
   - サイドバーの「Owlanter Sites」ビューで 🔌 アイコンをクリック
   - または、コマンドパレット（`Ctrl+Shift+P` / `Cmd+Shift+P`）から `Owlanter: 接続設定初期化` を実行

2. **ドメインと API キーの設定**
   - VS Code の設定（`Ctrl+,` / `Cmd+,`）を開く / もしくは歯車マークをクリック
   - 「Owlanter」で検索
   - `Owlanter: Domain` に Pleasanter のベース URL を入力（例: `https://example.com/`）
   - `Owlanter: Api Key` に API キーを入力

3. **設定の同期**
   - 「Owlanter Sites」ビューで 🔄 アイコンをクリック
   - または、コマンドパレットから `Owlanter: 設定同期` を実行

4. **サイトの追加**
   - 「Owlanter Sites」ビューで ➕ アイコンをクリック
   - サイト ID、名前、説明を入力

### 基本的な操作

#### スクリプトの取得（Pull）
1. 「Owlanter Sites」ビューでサイトを右クリック
2. 「Owlanter: スクリプト取得 (Pull)」を選択

#### スクリプトの適用（Push）
1. 「Owlanter Sites」ビューでサイトをクリック
2. サイト名の横にある ☁️ アイコンをクリック（インライン）
3. または右クリックメニューから「Owlanter: スクリプト適用 (Push)」を選択

#### 差分の確認
1. サイトを右クリック
2. 「Owlanter: 差分表示」を選択

#### 自動同期（Watch）
1. サイトを右クリック
2. 「Owlanter: 自動同期 (Watch)」を選択
3. ファイル変更が自動的に検知され、サーバーに反映されます

#### アクティブスクリプトの設定
1. サイト配下のスクリプト（Server / Client）を右クリック
2. 「Owlanter: アクティブスクリプト設定」を選択

## 設定項目

| 設定名 | 説明 | デフォルト |
|--------|------|------------|
| `owlanter.domain` | Pleasanter のベース URL | `""` |
| `owlanter.apiKey` | Pleasanter API キー | `""` |
| `owlanter.autoSave` | ファイル保存時に自動アップロード | `true` |
| `owlanter.logLevel` | ログ出力レベル（debug/info/warn/error） | `info` |

## コマンド一覧

### サイト管理
- `Owlanter: サイト一覧表示` - 登録されているサイトを一覧表示
- `Owlanter: サイト選択` - 操作対象のサイトを選択
- `Owlanter: 現在のサイト情報表示` - 選択中のサイト情報を表示
- `Owlanter: サイト追加` - 新しいサイトを登録

### スクリプト同期
- `Owlanter: スクリプト取得 (Pull)` - サーバーからスクリプトを取得
- `Owlanter: スクリプト適用 (Push)` - ローカルのスクリプトをサーバーに適用
- `Owlanter: 自動同期 (Watch)` - ファイル変更を監視して自動同期
- `Owlanter: 差分表示` - ローカルとサーバーの差分を表示

### アップロード
- `Owlanter: スクリプトアップロード` - スクリプトをアップロード
- `Owlanter: サーバースクリプトアップロード` - サーバースクリプトをアップロード
- `Owlanter: クライアントスクリプトアップロード` - クライアントスクリプトをアップロード
- `Owlanter: ファイルアップロード` - ファイルを指定してアップロード

### スクリプト管理
- `Owlanter: アクティブスクリプト表示` - アクティブスクリプトを表示
- `Owlanter: アクティブスクリプト設定` - アクティブスクリプトを設定
- `Owlanter: アクティブスクリプト解除` - アクティブスクリプトを解除

### 設定
- `Owlanter: 現在の接続設定表示` - 現在の接続設定を表示
- `Owlanter: 接続設定更新` - 接続設定を更新
- `Owlanter: 設定同期` - VS Code 設定とプロジェクト設定を同期
- `Owlanter: 接続設定初期化` - 接続設定を初期化
- `Owlanter: 設定を開く` - VS Code の設定画面を開く

## 必要要件

- Visual Studio Code 1.105.0 以降
- Pleasanter サーバーへのアクセス権限
- Pleasanter API キー

## トラブルシューティング

### 接続できない
- ドメイン URL が正しいか確認してください（末尾のスラッシュも含む）
- API キーが正しく設定されているか確認してください
- `Owlanter: 設定同期` を実行して、設定を同期してください

### スクリプトが反映されない
- `Owlanter: 差分表示` で差分を確認してください
- `Owlanter: スクリプト適用 (Push)` を実行してください

## フィードバック・問題報告

問題が発生した場合や機能リクエストがある場合は、[GitHub Issues](https://github.com/aToy0m0/owlanter-pleasanter-dev-tol/issues) までお知らせください。

## ライセンス

このプロジェクトのライセンスに従います。

---

**Enjoy coding with Owlanter!**
