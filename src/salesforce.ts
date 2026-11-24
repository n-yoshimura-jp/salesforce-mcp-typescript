// Salesforce REST API の小さなクライアント
// 認証: OAuth 2.0 クライアントログイン情報フロー（Client Credentials Flow）

type TokenResponse = {
  access_token: string;
  instance_url: string;
  token_type: string;
};

export class SalesforceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "SalesforceError";
  }
}

/** fetch のネットワークエラー（URL間違い・オフライン等）を分かりやすくする */
async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message ?? String(e);
    throw new Error(`Salesforce に接続できません (${detail}): ${new URL(url).origin} — SF_LOGIN_URL やネット接続を確認してください`);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていません（.env を確認してください）`);
  }
  return value;
}

export class SalesforceClient {
  private readonly loginUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly apiVersion: string;

  private accessToken: string | null = null;
  private instanceUrl: string | null = null;

  constructor() {
    this.loginUrl = requireEnv("SF_LOGIN_URL").replace(/\/+$/, "");
    // 秘密情報を平文で送らないよう、https 以外は拒否する
    if (!this.loginUrl.startsWith("https://")) {
      throw new Error("SF_LOGIN_URL は https:// で始まる My Domain の URL にしてください");
    }
    this.clientId = requireEnv("SF_CLIENT_ID");
    this.clientSecret = requireEnv("SF_CLIENT_SECRET");
    this.apiVersion = process.env.SF_API_VERSION?.trim() || "66.0";
  }

  /** アクセストークンを取得してキャッシュする */
  private async authenticate(): Promise<void> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const res = await safeFetch(`${this.loginUrl}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new SalesforceError(`認証に失敗しました (HTTP ${res.status}): ${text}`, res.status);
    }

    const data = JSON.parse(text) as TokenResponse;
    this.accessToken = data.access_token;
    this.instanceUrl = data.instance_url;
  }

  /** REST API を呼び出す。トークン切れ(401)のときは1回だけ再認証してやり直す */
  async request<T = unknown>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    retry = true,
  ): Promise<T> {
    if (!this.accessToken || !this.instanceUrl) {
      await this.authenticate();
    }

    const url = `${this.instanceUrl}/services/data/v${this.apiVersion}${path}`;
    const res = await safeFetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? null : JSON.stringify(body),
    });

    if (res.status === 401 && retry) {
      this.accessToken = null;
      return this.request<T>(method, path, body, false);
    }

    // 更新・削除の成功時は 204 No Content（本文なし）
    if (res.status === 204) {
      return undefined as T;
    }

    const text = await res.text();
    if (!res.ok) {
      throw new SalesforceError(`Salesforce API エラー (HTTP ${res.status}): ${text}`, res.status);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // ---- CRUD ----

  query(soql: string) {
    return this.request<{ totalSize: number; done: boolean; records: Record<string, unknown>[] }>(
      "GET",
      `/query?q=${encodeURIComponent(soql)}`,
    );
  }

  getRecord(objectName: string, id: string, fields?: string[]) {
    const qs = fields && fields.length > 0 ? `?fields=${encodeURIComponent(fields.join(","))}` : "";
    return this.request<Record<string, unknown>>("GET", `/sobjects/${objectName}/${id}${qs}`);
  }

  createRecord(objectName: string, fields: Record<string, unknown>) {
    return this.request<{ id: string; success: boolean; errors: unknown[] }>(
      "POST",
      `/sobjects/${objectName}`,
      fields,
    );
  }

  updateRecord(objectName: string, id: string, fields: Record<string, unknown>) {
    return this.request<void>("PATCH", `/sobjects/${objectName}/${id}`, fields);
  }

  deleteRecord(objectName: string, id: string) {
    return this.request<void>("DELETE", `/sobjects/${objectName}/${id}`);
  }

  describe(objectName: string) {
    return this.request<{
      name: string;
      label: string;
      fields: {
        name: string;
        label: string;
        type: string;
        nillable: boolean;
        createable: boolean;
        updateable: boolean;
        defaultedOnCreate: boolean;
        picklistValues?: { value: string; active: boolean }[];
        referenceTo?: string[];
      }[];
    }>("GET", `/sobjects/${objectName}/describe`);
  }
}

/** レコードから Salesforce が付ける "attributes" を取り除いて見やすくする */
export function stripAttributes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripAttributes);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "attributes") continue;
      out[k] = stripAttributes(v);
    }
    return out;
  }
  return value;
}
