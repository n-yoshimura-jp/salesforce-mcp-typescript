// Salesforce への接続確認用スクリプト（MCP とは無関係に単体で動かす）
// 実行: npm run check

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SalesforceClient, stripAttributes } from "./salesforce.js";

// プロジェクト直下の .env を読み込む（dist/check.js から見て1つ上の階層）
const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

try {
  const sf = new SalesforceClient();
  const result = await sf.query("SELECT Id, Name FROM Account ORDER BY CreatedDate DESC LIMIT 5");
  console.log("✅ 接続成功！ 取引先（最新5件）:");
  console.log(JSON.stringify(stripAttributes(result.records), null, 2));
} catch (e) {
  console.error("❌ 接続失敗:", e instanceof Error ? e.message : e);
  process.exit(1);
}
