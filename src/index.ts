#!/usr/bin/env node
// Salesforce CRUD 用 MCP サーバー（stdio）
// 注意: stdout は MCP の通信に使うので、ログは必ず console.error（stderr）に出す

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { SalesforceClient, SalesforceError, stripAttributes } from "./salesforce.js";

// プロジェクト直下の .env を読み込む（dist/index.js から見て1つ上の階層）
const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const sf = new SalesforceClient();

// 入力チェック用（URL に埋め込むので厳しめに）
const objectName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "オブジェクトのAPI参照名（例: Account, Contact, MyObject__c）")
  .describe("オブジェクトのAPI参照名。例: Account, Contact, Opportunity, MyObject__c");
const recordId = z
  .string()
  .regex(/^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/, "15桁または18桁のレコードID")
  .describe("レコードID（15桁または18桁）");
const fieldValues = z
  .record(z.string(), z.unknown())
  .describe('項目のAPI参照名と値の組。例: {"Name": "テスト株式会社", "Phone": "03-1234-5678"}');

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  // エラー本文には SOQL の条件値などが含まれることがあるため、ログには HTTP ステータスだけを残す
  const status = error instanceof SalesforceError ? `HTTP ${error.status}` : "接続または設定のエラー";
  console.error("[salesforce-mcp] ツールの実行に失敗しました:", status);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function createServer(): McpServer {
  const server = new McpServer({ name: "salesforce", version: "1.0.0" });

  // ---------- Read: SOQL ----------
  server.registerTool(
    "sf_query",
    {
      title: "SOQLでレコードを検索",
      description:
        "SOQLを実行してレコードを取得します。例: SELECT Id, Name FROM Account ORDER BY CreatedDate DESC LIMIT 10。件数が多くなりそうなときは必ず LIMIT を付けてください。",
      inputSchema: z.object({
        soql: z.string().min(1).describe("実行するSOQL文"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ soql }) => {
      try {
        const result = await sf.query(soql);
        return ok({ totalSize: result.totalSize, done: result.done, records: stripAttributes(result.records) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- Read: 1件取得 ----------
  server.registerTool(
    "sf_get_record",
    {
      title: "IDでレコードを1件取得",
      description: "オブジェクト名とレコードIDを指定して1件取得します。fields を省略すると全項目を返します。",
      inputSchema: z.object({
        objectName,
        id: recordId,
        fields: z.array(z.string()).optional().describe("取得する項目のAPI参照名の配列（省略可）"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ objectName, id, fields }) => {
      try {
        return ok(stripAttributes(await sf.getRecord(objectName, id, fields)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- Create ----------
  server.registerTool(
    "sf_create_record",
    {
      title: "レコードを作成",
      description: "指定したオブジェクトにレコードを1件作成し、作成されたIDを返します。",
      inputSchema: z.object({ objectName, fields: fieldValues }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ objectName, fields }) => {
      try {
        const result = await sf.createRecord(objectName, fields);
        return ok({ message: "作成しました", id: result.id });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- Update ----------
  server.registerTool(
    "sf_update_record",
    {
      title: "レコードを更新",
      description: "レコードIDを指定して、渡した項目だけを更新します。",
      inputSchema: z.object({ objectName, id: recordId, fields: fieldValues }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ objectName, id, fields }) => {
      try {
        await sf.updateRecord(objectName, id, fields);
        return ok({ message: "更新しました", id });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- Delete ----------
  server.registerTool(
    "sf_delete_record",
    {
      title: "レコードを削除",
      description: "レコードIDを指定して削除します（ごみ箱に移動）。実行前に対象レコードをユーザーに確認してください。",
      inputSchema: z.object({ objectName, id: recordId }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ objectName, id }) => {
      try {
        await sf.deleteRecord(objectName, id);
        return ok({ message: "削除しました", id });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- 補助: 項目一覧 ----------
  server.registerTool(
    "sf_describe_object",
    {
      title: "オブジェクトの項目一覧を取得",
      description:
        "オブジェクトの項目（API参照名・型・必須かどうか・選択リスト値）を返します。作成や更新の前に、項目名がわからないときに使います。",
      inputSchema: z.object({ objectName }),
      annotations: { readOnlyHint: true },
    },
    async ({ objectName }) => {
      try {
        const d = await sf.describe(objectName);
        const fields = d.fields.map((f) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          requiredOnCreate: f.createable && !f.nillable && !f.defaultedOnCreate,
          createable: f.createable,
          updateable: f.updateable,
          ...(f.picklistValues && f.picklistValues.length > 0
            ? { picklistValues: f.picklistValues.filter((p) => p.active).map((p) => p.value) }
            : {}),
          ...(f.referenceTo && f.referenceTo.length > 0 ? { referenceTo: f.referenceTo } : {}),
        }));
        return ok({ name: d.name, label: d.label, fields });
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

serveStdio(createServer, {
  onerror: (err) => console.error("[salesforce-mcp] error:", err),
});
console.error("[salesforce-mcp] stdio で起動しました");
