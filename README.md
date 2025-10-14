# Owlanter VS Code Extension

Owlanter は、Pleasanter サイト向けスクリプトを VS Code から安全かつ効率的に同期するための拡張機能です。TypeScript 製の UI と、既存の Python ツール群（01_api 配下）を組み合わせており、開発・検証済みのフローをそのまま活用できます。

## 主な機能
- **サイト管理**: サイト一覧表示・選択・状態確認が可能
- **同期**: Pull / Push / Diff / Watch に対応し、アクティブスクリプト設定も GUI から操作
- **アップロード**: サーバー／クライアントスクリプトを ID やファイル指定でアップロード
- **設定同期**: VS Code のユーザー設定と `_config/config.json` をワンクリック同期

## インストール
1. `npm install`
2. `npm run compile`
3. VS Code の拡張機能デバッグ (F5) もしくは `npx vsce package` で生成した VSIX をインストール

## 初期設定
1. 拡張機能コマンド `Owlanter: 設定同期` を実行し、VS Code 設定のドメイン / API キーを `_config/config.json` に反映
2. Python ツールを利用している場合は、`01_api/03_deployment/03_controller.py` から従来どおり `pull` を実行
3. `Owlanter: サイト追加` で VS Code 側のサイト情報を登録

## コマンド一覧（抜粋）
| 機能 | コマンド | 説明 |
| --- | --- | --- |
| サイト管理 | `Owlanter: サイト一覧表示` / `Owlanter: サイト選択` | サイトの表示・切替 |
| 同期 | `Owlanter: スクリプト取得 (Pull)` / `Owlanter: スクリプト適用 (Push)` / `Owlanter: 自動同期 (Watch)` / `Owlanter: 差分表示` | 各種同期処理 |
| アップロード | `Owlanter: スクリプトアップロード` ほか | ID / ファイル指定でアップロード |
| 設定 | `Owlanter: 設定同期` / `Owlanter: 接続設定更新` | VS Code 設定と `_config/config.json` の同期 |

## アイコン
`resources/icon.png` はルートにある `owl.png` からコピーされています。必要に応じて差し替えてください。

## 既存 Python ツールとの連携
- `01_api/03_deployment/03_controller.py`、`01_upload-scripts.py` などは既存フローのまま動作します
- VS Code 拡張で実行するコマンドと同等の動きになるよう API リクエスト仕様を統一しています

## ライセンス
プロジェクトのライセンスに従います。
