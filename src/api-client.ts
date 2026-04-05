import { createHash, randomUUID } from "crypto";

// ── Region configuration ────────────────────────────────────────────────
const REGIONS: Record<string, string> = {
  eu: "https://plus-eu.fitdays.cn",
  us: "https://plus-us.fitdays.cn",
  cn: "https://plus.fitdays.cn",
};

const APP_VER = "1.2.9";
const PACKAGE_NAME = "cn.icomon.MyBodyCheck";
const USER_AGENT = `MyBodyCheck-${APP_VER}`;
const DEVICE_MODEL = "Claude-MCP";
const SIGN_SECRET = "fitdayspro";

// ── Types ───────────────────────────────────────────────────────────────

export interface AuthSession {
  account_id: number;
  token: string;
  region: string;
}

export interface UserProfile {
  uid: number;
  account_id: number;
  nickname: string;
  sex: number; // 0 = female, 1 = male
  birthday: string;
  height: number; // cm
  weight: string;
  target_weight: string;
  people_type: number;
  avatar: string;
  target_pbf: string;
}

export interface WeightRecord {
  data_id: string;
  account_id: number;
  uid: number;
  sex: number;
  age: number;
  height: number;
  people_type: number;
  measure_time: number; // unix timestamp
  device_id: string;
  weight_kg: number;
  weight_lb: number;
  bmi: string;
  pbf: string; // body fat %
  body_composition: string; // JSON string with detailed metrics
  segmental_data: string; // JSON string with segmental body analysis
  balance: string; // JSON string with balance data
  body_composition_ext: string;
  electrode: number;
  data_type: number;
  device_model: string;
}

export interface RulerRecord {
  data_id: string;
  account_id: number;
  uid: number;
  device_id: string;
  weight: string;
  sex: number;
  birthday: string;
  height: number;
  people_type: number;
  measure_time: number;
  type: number; // body part type
  mode: number;
  distance: number;
  distance_cm: number;
  distance_in: number;
}

export interface DeviceInfo {
  device_id: string;
  name: string;
  mac: string;
  model: string;
  device_type: number;
  device_sub_type: number;
  firmware_ver: string;
  hardware_ver: string;
  remark_name: string;
}

export interface FoodItem {
  food_id: string;
  name: string;
  unit: string;
  quantity: string;
  kcal: string;
  protein: string;
  fat: string;
  carbohydrates: string;
  dietary_fiber: string;
}

export interface SkipRecord {
  data_id: string;
  account_id: number;
  uid: number;
  device_id: string;
  weight: string;
  measure_time: number;
  mode: number;
  time: number; // duration in seconds
  skip_count: number;
  avg_freq: number;
  fastest_freq: number;
  calories_burned: number;
  fat_burn_efficiency: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

function generateRequestId(): string {
  return md5(randomUUID());
}

/**
 * Build the `sign` header for the Fitdays Plus API.
 * Algorithm (from binary analysis of MyBodyCheck iOS app):
 * 1. Build dict with 10 signing headers (sorted alphabetically)
 * 2. Concatenate as key=value&key=value&...
 * 3. Append "fitdayspro"
 * 4. URL-encode the entire string
 * 5. MD5 hash
 */
function buildSign(signingHeaders: Record<string, string>): string {
  const sorted = Object.keys(signingHeaders).sort();
  const raw = sorted.map((k) => `${k}=${signingHeaders[k]}`).join("&");
  const encoded = encodeURIComponent(raw + SIGN_SECRET)
    .replace(/%20/g, "+")     // Java URLEncoder uses + for space
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return md5(encoded);
}

function hashPassword(password: string): string {
  return md5(md5(password + SIGN_SECRET));
}

// ── API Client Class ────────────────────────────────────────────────────

export class MyBodyCheckAPI {
  private baseUrl: string;
  private clientId: string;
  private country: string;
  private session: AuthSession | null = null;

  constructor(region: string = "eu") {
    this.baseUrl = REGIONS[region] || REGIONS.eu;
    this.clientId = md5(randomUUID());
    this.country = "CH";
  }

  private async request(
    endpoint: string,
    body: Record<string, any> = {},
    method: "GET" | "POST" = "POST"
  ): Promise<any> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const requestId = generateRequestId();

    // The signing headers (from binary analysis of MyBodyCheck iOS app).
    // Empty-value headers are excluded: the server only signs headers it receives.
    const signingHeaders: Record<string, string> = {
      "account-id": this.session ? String(this.session.account_id) : "0",
      "app-ver": APP_VER,
      "client-id": this.clientId,
      "country": this.country,
      "device-model": DEVICE_MODEL,
      "package-name": PACKAGE_NAME,
      "request-id": requestId,
      "timestamp": timestamp,
      "user-agent": USER_AGENT,
    };
    if (this.session?.token) {
      signingHeaders["token"] = this.session.token;
    }

    const sign = buildSign(signingHeaders);

    const queryString = `os_type=1&bapp_ver=1.2.1&country=${this.country}&language=en&source=2204`;
    const url = `${this.baseUrl}/${endpoint}?${queryString}`;

    // Build HTTP headers. The signing used lowercase "user-agent" as a key,
    // but we send it as the standard "User-Agent" header for HTTP.
    const httpHeaders: Record<string, string> = {
      "account-id": signingHeaders["account-id"],
      "app-ver": signingHeaders["app-ver"],
      "client-id": signingHeaders["client-id"],
      "country": signingHeaders["country"],
      "device-model": signingHeaders["device-model"],
      "package-name": signingHeaders["package-name"],
      "request-id": signingHeaders["request-id"],
      "timestamp": signingHeaders["timestamp"],
      "User-Agent": USER_AGENT,
      "sign": sign,
      "timezone": String(Math.floor(new Date().getTimezoneOffset() / -60)),
      "type": "1",
      "Content-Type": "application/json",
    };
    if (this.session?.token) {
      httpHeaders["token"] = this.session.token;
    }

    const hasBody = method === "POST" && Object.keys(body).length > 0;

    const response = await fetch(url, {
      method,
      headers: httpHeaders,
      body: hasBody ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  }

  // ── Authentication ──────────────────────────────────────────────────

  async login(account: string, password: string): Promise<AuthSession> {
    const result = await this.request("api/account/login", {
      account,
      access_code: hashPassword(password),
      type: 1,
      vcode: "",
    });

    // Handle region redirect (code 302 = "Redirect Domain")
    if (result.code === 302 && result.data?.domain) {
      this.baseUrl = result.data.domain.replace(/\/$/, "");
      return this.login(account, password);
    }

    if (result.code !== 0 && result.code !== 200) {
      throw new Error(`Login failed: ${result.msg || JSON.stringify(result)}`);
    }

    this.session = {
      account_id: result.data?.account?.account_id || result.data?.account_id,
      token: result.data?.account?.token || result.data?.token,
      region: this.baseUrl,
    };

    return this.session;
  }

  setSession(session: AuthSession): void {
    this.session = session;
    this.baseUrl = session.region;
  }

  getSession(): AuthSession | null {
    return this.session;
  }

  async logout(): Promise<any> {
    return this.request("api/account/logout");
  }

  // ── User Management ─────────────────────────────────────────────────

  async getUsers(): Promise<any> {
    return this.request("api/device/v3/getUsers");
  }

  async createUser(params: {
    nickname: string;
    sex: number;
    birthday: string;
    height: number;
    weight: string;
    target_weight?: string;
    people_type?: number;
  }): Promise<any> {
    return this.request("api/user/create", params);
  }

  async updateUser(params: {
    uid: number;
    nickname?: string;
    sex?: number;
    birthday?: string;
    height?: number;
    weight?: string;
    target_weight?: string;
    target_pbf?: string;
  }): Promise<any> {
    return this.request("api/user/update", params);
  }

  async deleteUser(uid: number): Promise<any> {
    return this.request("api/user/delete", { uid });
  }

  async setActiveUser(uid: number): Promise<any> {
    return this.request("api/user/active", { uid });
  }

  // ── Weight / Body Composition Data ──────────────────────────────────

  async syncWeightFromServer(uid: number, last_sync_time?: number): Promise<any> {
    return this.request("api/sync/sync_from_server", {
      uid,
      last_sync_time: last_sync_time || 0,
    });
  }

  async syncIncrements(uid: number, last_sync_time?: number): Promise<any> {
    return this.request("api/sync/sync_increments", {
      uid,
      last_sync_time: last_sync_time || 0,
    });
  }

  async insertWeightData(data: Record<string, any>): Promise<any> {
    return this.request("api/device/insert_weight_datas", {
      datas: JSON.stringify([data]),
    });
  }

  async updateWeightData(data: Record<string, any>): Promise<any> {
    return this.request("api/device/update_weight_datas", {
      datas: JSON.stringify([data]),
    });
  }

  async deleteWeightData(data_ids: string[]): Promise<any> {
    return this.request("api/device/delete_weight_datas", {
      data_ids: JSON.stringify(data_ids),
    });
  }

  // ── Body Measurement (Ruler) Data ───────────────────────────────────

  async insertRulerData(data: Record<string, any>): Promise<any> {
    return this.request("api/device/insert_ruler_datas", {
      datas: JSON.stringify([data]),
    });
  }

  async updateRulerData(data: Record<string, any>): Promise<any> {
    return this.request("api/device/update_ruler_datas", {
      datas: JSON.stringify([data]),
    });
  }

  async deleteRulerData(data_ids: string[]): Promise<any> {
    return this.request("api/device/delete_ruler_datas", {
      data_ids: JSON.stringify(data_ids),
    });
  }

  // ── Skip Rope Data ──────────────────────────────────────────────────

  async insertSkipData(data: Record<string, any>): Promise<any> {
    return this.request("api/device/insert_skip_datas", {
      datas: JSON.stringify([data]),
    });
  }

  async deleteSkipData(data_ids: string[]): Promise<any> {
    return this.request("api/device/delete_skip_datas", {
      data_ids: JSON.stringify(data_ids),
    });
  }

  async getSkipMedals(uid: number): Promise<any> {
    return this.request("api/device/get_skip_medals", { uid });
  }

  // ── Device Management ───────────────────────────────────────────────

  async bindDevice(params: {
    mac: string;
    model: string;
    name?: string;
    device_type?: number;
  }): Promise<any> {
    return this.request("api/device/bind", params);
  }

  async unbindDevice(device_id: string): Promise<any> {
    return this.request("api/device/unbind", { device_id });
  }

  async getDeviceInfo(device_id: string): Promise<any> {
    return this.request("api/device/getDeviceInfo", { device_id });
  }

  async modifyDevice(params: {
    device_id: string;
    remark_name?: string;
  }): Promise<any> {
    return this.request("api/device/modify", params);
  }

  // ── Account Settings ────────────────────────────────────────────────

  async getSettings(): Promise<any> {
    return this.request("api/account/get_setting");
  }

  async setSettings(settings: Record<string, any>): Promise<any> {
    return this.request("api/account/set_setting", settings);
  }

  async updateAccount(params: Record<string, any>): Promise<any> {
    return this.request("api/account/update_account", params);
  }

  // ── Sync & Config ───────────────────────────────────────────────────

  async getConfig(): Promise<any> {
    return this.request("api/sync/get_config");
  }

  async getFoodCategory(language?: string): Promise<any> {
    return this.request("api/sync/get_food_category", {
      language: language || "en",
    });
  }

  // ── Report Data ─────────────────────────────────────────────────────

  async insertReportData(data: Record<string, any>): Promise<any> {
    return this.request("api/device/insert_report_datas", {
      datas: JSON.stringify([data]),
    });
  }

  async updateReportData(data: Record<string, any>): Promise<any> {
    return this.request("api/device/update_report_datas", {
      datas: JSON.stringify([data]),
    });
  }

  async deleteReportData(data_ids: string[]): Promise<any> {
    return this.request("api/device/delete_report_datas", {
      data_ids: JSON.stringify(data_ids),
    });
  }
}
