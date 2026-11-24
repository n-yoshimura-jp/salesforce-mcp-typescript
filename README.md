# salesforce-mcp-typescript

Claude Desktop から Salesforce のレコードを検索・作成・更新・削除できる、TypeScript 製の MCP（Model Context Protocol）サーバーです。同じ機能の Python 版も作成予定です。

```
Claude Desktop ──(stdio)──▶ salesforce-mcp-typescript ──(OAuth 2.0 Client Credentials Flow)──▶ Salesforce REST API
```

## ツール一覧

| ツール名 | 操作 | 内容 |
|---|---|---|
| `sf_query` | Read | SOQL でレコードを検索 |
| `sf_get_record` | Read | レコード ID で1件取得（項目の指定も可） |
| `sf_create_record` | Create | レコードを1件作成して ID を返す |
| `sf_update_record` | Update | 指定した項目だけを更新 |
| `sf_delete_record` | Delete | レコードを削除（ごみ箱へ移動） |
| `sf_describe_object` | 補助 | 項目の API 参照名・型・必須かどうか・選択リスト値を取得 |

オブジェクト名を引数で受け取るため、標準オブジェクトとカスタムオブジェクト（例: `MyObject__c`）のどちらも操作できます。操作できる範囲は、実行ユーザーの権限の範囲内です。

## 技術スタック

- Node.js（標準の `fetch` と `process.loadEnvFile` を使用し、HTTP クライアントや dotenv は不使用）
- TypeScript 7
- [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)（`@modelcontextprotocol/server`）
- zod 4（ツールの入力チェック）

## セキュリティ設計

- **パスワード不要の認証**: 外部クライアントアプリケーション（External Client App）の Client Credentials Flow を使うため、ユーザーのパスワードやセキュリティトークンを保存しません。
- **秘密情報はコードに書かない**: 接続情報は環境変数から読み込みます。`.env` は `.gitignore` で Git の対象外にしています。
- **HTTPS 以外を拒否**: `SF_LOGIN_URL` が `https://` で始まらない場合は起動時にエラーにします。
- **入力チェック**: URL に埋め込むオブジェクト名とレコード ID を、正規表現で厳しくチェックします（パスの書き換えを防止）。
- **トークンはメモリ上だけ**: アクセストークンはファイルに保存せず、期限切れ（HTTP 401）のときだけ1回再認証します。
- **ログは最小限**: ログファイル（`~/Library/Logs/Claude/`）には HTTP ステータスだけを記録します。SOQL の条件値などを含むエラー本文は Claude にだけ返します。

## 必要なもの

- macOS と [Claude Desktop](https://claude.ai/download)
- Node.js 22 以上（LTS 版を推奨）
- Salesforce 組織（Developer Edition で動作を確認）と、Client Credentials Flow を有効にした外部クライアントアプリケーション

## セットアップ

### 1. Salesforce 側の設定

外部クライアントアプリケーションを作成し、次の3つを控えます。詳しい手順は [セットアップガイド](./salesforce-mcp-setup-guide.txt) の Step 2 を参照してください。

- My Domain の URL（例: `https://yourname-dev-ed.develop.my.salesforce.com`）
- コンシューマー鍵
- コンシューマーの秘密

> [!WARNING]
> API は、アプリのポリシーの「別のユーザーとして実行（Run As）」で指定したユーザーの権限で動きます。実業務の組織では、システム管理者ではなく、必要なオブジェクトと項目にだけ権限を付与した連携用ユーザーを指定してください。

### 2. インストールとビルド

```bash
git clone https://github.com/<your-account>/salesforce-mcp-typescript.git
cd salesforce-mcp-typescript
npm ci
npm run build
```

### 3. 接続情報を設定する

プロジェクト直下に `.env` を作り、自分だけが読み書きできる権限にします。

```bash
cat > .env <<'EOF'
SF_LOGIN_URL=https://yourname-dev-ed.develop.my.salesforce.com
SF_CLIENT_ID=ここにコンシューマー鍵
SF_CLIENT_SECRET=ここにコンシューマーの秘密
SF_API_VERSION=66.0
EOF
chmod 600 .env
```

作成後、エディタで `=` の右側を実際の値に書き換えます。

| 変数 | 必須 | 内容 |
|---|---|---|
| `SF_LOGIN_URL` | ○ | My Domain の URL（`https://` 付き、末尾の `/` なし） |
| `SF_CLIENT_ID` | ○ | コンシューマー鍵 |
| `SF_CLIENT_SECRET` | ○ | コンシューマーの秘密 |
| `SF_API_VERSION` | | REST API のバージョン（省略時は `66.0`） |

### 4. 接続を確認する

```bash
npm run check
```

`✅ 接続成功！` と取引先の一覧が表示されれば成功です。

### 5. Claude Desktop に登録する

Claude Desktop のメニューバーで **Claude → 設定… → 開発者 → 構成を編集** を開き、`claude_desktop_config.json` の `mcpServers` に次を追加します。パスは `which node` と、このフォルダで `pwd` を実行した結果に置き換えてください（`~` や相対パスは使えません）。

```json
{
  "mcpServers": {
    "salesforce": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/<ユーザー名>/path/to/salesforce-mcp-typescript/dist/index.js"]
    }
  }
}
```

保存したら、Claude Desktop を ⌘Q で完全に終了してから起動し直します。

<details>
<summary><code>.env</code> を使わず、設定ファイルに接続情報を書く場合</summary>

`env` に書いた値は `.env` より優先されます。ただし、この設定ファイルには他の MCP サーバーの API キーなども集まるため、このプロジェクトでは `.env` を推奨しています。

```json
{
  "mcpServers": {
    "salesforce": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/<ユーザー名>/path/to/salesforce-mcp-typescript/dist/index.js"],
      "env": {
        "SF_LOGIN_URL": "https://yourname-dev-ed.develop.my.salesforce.com",
        "SF_CLIENT_ID": "コンシューマー鍵",
        "SF_CLIENT_SECRET": "コンシューマーの秘密"
      }
    }
  }
}
```

</details>

## 使い方

Claude Desktop のチャットで、次のように話しかけます。

| 依頼の例 | 使われるツール |
|---|---|
| Salesforce の取引先を作成日の新しい順に5件見せて | `sf_query` |
| 取引先「テスト株式会社」を作って。電話番号は 03-1234-5678 | `sf_create_record` |
| さっき作った取引先の業種を小売にして | `sf_describe_object` → `sf_update_record` |
| テスト株式会社を削除して | `sf_delete_record` |

> [!CAUTION]
> Salesforce のレコードに「このレコードを削除して」のような指示文が書かれていると、Claude がそれに従おうとすることがあります（プロンプトインジェクション）。作成・更新・削除のツールは「常に許可」にせず、実行のたびに内容を確認してください。削除したレコードは Salesforce のごみ箱から復元できます。

## ファイル構成

```
salesforce-mcp-typescript/
├── src/
│   ├── index.ts        # MCP サーバー本体（ツール定義）
│   ├── salesforce.ts   # Salesforce REST API クライアント（認証・CRUD）
│   └── check.ts        # 接続確認用スクリプト（npm run check）
├── salesforce-mcp-setup-guide.txt  # Salesforce の設定を含む詳しい構築手順
├── package.json
└── tsconfig.json
```

## トラブルシューティング

よくあるエラーと対処法は、[セットアップガイド](./salesforce-mcp-setup-guide.txt) の「トラブルシューティング」にまとめています。Claude Desktop から起動したときのログは次のコマンドで確認できます。

```bash
tail -n 50 ~/Library/Logs/Claude/mcp-server-salesforce.log
```

## 参考

- [MCP TypeScript SDK v2 ドキュメント](https://ts.sdk.modelcontextprotocol.io/v2/)
- [Connect to local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers)
- [Salesforce: クライアントログイン情報フロー用の外部クライアントアプリの作成](https://developer.salesforce.com/docs/industries/loyalty/guide/authorization.html)

## 免責事項

本プロジェクトは Salesforce, Inc. とは関係のない個人プロジェクトです。Salesforce は Salesforce, Inc. の商標です。
