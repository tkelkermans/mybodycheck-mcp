#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "fs";
import { MyBodyCheckAPI, AuthSession } from "./api-client.js";

// ── Session persistence ─────────────────────────────────────────────────
// The session token survives across Claude Desktop restarts, so the user
// doesn't re-authenticate until the server invalidates the token.
const SESSION_DIR = join(homedir(), ".mybodycheck-mcp");
const SESSION_FILE = join(SESSION_DIR, "session.json");

function loadCachedSession(): AuthSession | null {
  try {
    if (!existsSync(SESSION_FILE)) return null;
    const raw = readFileSync(SESSION_FILE, "utf8");
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

function saveCachedSession(session: AuthSession): void {
  try {
    mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
    chmodSync(SESSION_FILE, 0o600);
  } catch (err) {
    console.error("Warning: could not persist session:", err);
  }
}

function clearCachedSession(): void {
  try {
    if (existsSync(SESSION_FILE)) {
      writeFileSync(SESSION_FILE, "");
    }
  } catch {}
}

// ── State ───────────────────────────────────────────────────────────────
let api: MyBodyCheckAPI | null = null;

// Configuration from environment variables (set in Claude Desktop config)
const ENV_EMAIL = process.env.MBC_EMAIL;
const ENV_PASSWORD = process.env.MBC_PASSWORD;
const ENV_REGION = (process.env.MBC_REGION || "eu") as "eu" | "us" | "cn";

/**
 * Returns a ready-to-use API client. Resolution order:
 *  1. If we already have a live API instance, use it.
 *  2. Try to restore a cached session from disk.
 *  3. If MBC_EMAIL/MBC_PASSWORD are set, log in automatically.
 *  4. Otherwise, throw and let the user call the `login` tool.
 */
async function getApi(): Promise<MyBodyCheckAPI> {
  if (api?.getSession()) return api;

  const cached = loadCachedSession();
  if (cached?.token) {
    api = new MyBodyCheckAPI(ENV_REGION);
    api.setSession(cached);
    return api;
  }

  if (ENV_EMAIL && ENV_PASSWORD) {
    api = new MyBodyCheckAPI(ENV_REGION);
    const session = await api.login(ENV_EMAIL, ENV_PASSWORD);
    saveCachedSession(session);
    return api;
  }

  throw new Error(
    "Not authenticated. Either set MBC_EMAIL/MBC_PASSWORD in your Claude Desktop " +
      "config, or call the 'login' tool with your credentials."
  );
}

/**
 * Resolves a UID: uses the explicit value if given, otherwise falls back to
 * the authenticated account's primary user. Throws if neither is available.
 */
async function resolveUid(uid: number | undefined): Promise<number> {
  if (typeof uid === "number") return uid;
  const client = await getApi();
  const defaultUid = client.getDefaultUid();
  if (!defaultUid) {
    throw new Error(
      "No user ID provided and no default user found. Call 'get_users' to see available profiles, then pass one with uid=..."
    );
  }
  return defaultUid;
}

// ── Helpers for response parsing ────────────────────────────────────────
function parseExt(raw: string | undefined): Record<string, any> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function round1(n: number | undefined): string {
  return typeof n === "number" ? (Math.round(n * 10) / 10).toString() : "";
}

function formatWeight(record: any): string {
  const date = new Date(record.measure_time * 1000).toISOString().split("T")[0];
  const time = new Date(record.measure_time * 1000).toISOString().split("T")[1]?.slice(0, 5);
  let out = `📅 ${date} ${time} — ${round1(record.weight_kg)} kg`;

  if (record.bmi) out += ` | BMI: ${record.bmi}`;
  if (record.pbf) out += ` | Body Fat: ${record.pbf}%`;

  const ext = parseExt(record.ext);
  const bc = ext.body_composition ?? {};
  if (bc.bmr) out += ` | BMR: ${bc.bmr} kcal`;
  if (bc.musclePercent) out += ` | Muscle: ${round1(bc.musclePercent)}%`;
  if (bc.boneMass) out += ` | Bone: ${round1(bc.boneMass)} kg`;
  if (bc.moisturePercent) out += ` | Water: ${round1(bc.moisturePercent)}%`;
  if (bc.visceralFat) out += ` | Visceral Fat: ${bc.visceralFat}`;
  if (bc.subcutaneousFatPercent) out += ` | Subcut Fat: ${round1(bc.subcutaneousFatPercent)}%`;
  if (bc.proteinPercent) out += ` | Protein: ${round1(bc.proteinPercent)}%`;
  if (bc.physicalAge) out += ` | Body Age: ${bc.physicalAge}`;
  if (bc.bodyScore) out += ` | Score: ${bc.bodyScore}`;

  return out;
}

// ── MCP Server ──────────────────────────────────────────────────────────

const server = new McpServer({
  name: "mybodycheck",
  version: "1.0.0",
  description:
    "MCP server for MyBodyCheck / Terraillon smart scale data. " +
    "Access weight, body composition, body measurements, skip rope data, " +
    "and device management through the Fitdays cloud API.",
});

// ════════════════════════════════════════════════════════════════════════
// TOOLS
// ════════════════════════════════════════════════════════════════════════

// ── Authentication ──────────────────────────────────────────────────────

server.tool(
  "login",
  "Log in to your MyBodyCheck / Terraillon account. Required before using any other tool.",
  {
    email: z.string().describe("Your MyBodyCheck account email"),
    password: z.string().describe("Your MyBodyCheck account password"),
    region: z
      .enum(["eu", "us", "cn"])
      .default("eu")
      .describe("Server region: eu (Europe), us (USA), cn (China). Default: eu"),
  },
  async ({ email, password, region }) => {
    api = new MyBodyCheckAPI(region);
    try {
      const session = await api.login(email, password);
      saveCachedSession(session);
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Logged in successfully!\nAccount ID: ${session.account_id}\nRegion: ${region}\n\nSession persisted — you won't need to log in again until the token expires.`,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `❌ Login failed: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool("logout", "Log out of your MyBodyCheck account.", {}, async () => {
  try {
    const client = await getApi();
    await client.logout();
    api = null;
    clearCachedSession();
    return { content: [{ type: "text" as const, text: "✅ Logged out successfully." }] };
  } catch (err: any) {
    return { content: [{ type: "text" as const, text: `❌ ${err.message}` }], isError: true };
  }
});

// ── User Profiles ───────────────────────────────────────────────────────

server.tool(
  "get_users",
  "Get all user profiles linked to this account (family members, etc.). Returns the list captured at login — these are the UIDs to pass to other tools.",
  {},
  async () => {
    try {
      const client = await getApi();
      const session = client.getSession();
      const users = session?.users ?? [];
      if (users.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No user profiles found. Try logging out and back in to refresh.",
            },
          ],
        };
      }
      const summary = users
        .map(
          (u) =>
            `• uid=${u.uid} — ${u.nickname} (${u.sex === 1 ? "M" : "F"}, ${u.height}cm, ${u.weight}kg)`
        )
        .join("\n");
      const defaultUid = client.getDefaultUid();
      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${users.length} user profile(s). Default uid: ${defaultUid}\n\n${summary}\n\nFull data:\n${JSON.stringify(users, null, 2)}`,
          },
        ],
      };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "create_user",
  "Create a new user profile (e.g. a family member).",
  {
    nickname: z.string().describe("Display name"),
    sex: z.number().min(0).max(1).describe("0 = female, 1 = male"),
    birthday: z.string().describe("Birthday in YYYY-MM-DD format"),
    height: z.number().describe("Height in cm"),
    weight: z.string().describe("Current weight in kg (as string, e.g. '75.5')"),
    target_weight: z.string().optional().describe("Target weight in kg"),
    people_type: z
      .number()
      .optional()
      .describe("0 = normal adult, 1 = athlete, 2 = elderly, 3 = child"),
  },
  async (params) => {
    try {
      const result = await (await getApi()).createUser(params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "update_user",
  "Update an existing user profile.",
  {
    uid: z.number().describe("User ID to update"),
    nickname: z.string().optional().describe("New display name"),
    sex: z.number().optional().describe("0 = female, 1 = male"),
    birthday: z.string().optional().describe("Birthday YYYY-MM-DD"),
    height: z.number().optional().describe("Height in cm"),
    weight: z.string().optional().describe("Weight in kg"),
    target_weight: z.string().optional().describe("Target weight in kg"),
    target_pbf: z.string().optional().describe("Target body fat percentage"),
  },
  async (params) => {
    try {
      const result = await (await getApi()).updateUser(params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }], isError: true };
    }
  }
);

// ── Weight & Body Composition ───────────────────────────────────────────

server.tool(
  "get_weight_data",
  "Fetch all weight and body composition measurements for a user from the server. " +
    "Returns weight, BMI, body fat %, muscle mass, bone mass, water %, visceral fat, " +
    "subcutaneous fat, protein, body age, body score, BMR, and segmental analysis.",
  {
    uid: z.number().optional().describe("User ID. Omit to use the account's primary user."),
    since: z
      .string()
      .optional()
      .describe("Only fetch data after this date (YYYY-MM-DD). Default: all data"),
    format: z
      .enum(["summary", "detailed", "raw"])
      .default("summary")
      .describe("Output format: summary (human readable), detailed (full metrics), raw (JSON)"),
  },
  async ({ uid, since, format }) => {
    try {
      const resolvedUid = await resolveUid(uid);
      const sinceTs = since ? Math.floor(new Date(since).getTime() / 1000) : 0;
      const result = await (await getApi()).syncWeightFromServer(resolvedUid, sinceTs);

      if (format === "raw") {
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      }

      const records = result?.data?.weights || result?.weights || [];
      if (records.length === 0) {
        return { content: [{ type: "text" as const, text: "No weight records found." }] };
      }

      if (format === "summary") {
        const lines = records.map(formatWeight);
        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${records.length} weight record(s):\n\n${lines.join("\n")}`,
            },
          ],
        };
      }

      // detailed
      const detailed = records.map((r: any) => {
        const ext = parseExt(r.ext);
        const bc = ext.body_composition ?? {};
        const seg = ext.segmental_data ?? {};
        return {
          date: new Date(r.measure_time * 1000).toISOString(),
          weight_kg: r.weight_kg,
          bmi: r.bmi,
          body_fat_pct: r.pbf,
          ...bc,
          segmental: seg,
          device_model: ext.device_model,
          electrode: r.electrode,
        };
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(detailed, null, 2) }],
      };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "get_latest_weight",
  "Get only the most recent weight/body composition measurement for a user.",
  {
    uid: z.number().optional().describe("User ID. Omit to use the account's primary user."),
  },
  async ({ uid }) => {
    try {
      const resolvedUid = await resolveUid(uid);
      const result = await (await getApi()).syncWeightFromServer(resolvedUid, 0);
      const records = result?.data?.weights || result?.weights || [];
      if (records.length === 0) {
        return { content: [{ type: "text" as const, text: "No weight records found." }] };
      }

      // Sort by measure_time descending, take first
      records.sort((a: any, b: any) => b.measure_time - a.measure_time);
      const latest = records[0];
      const ext = parseExt(latest.ext);
      const bc = ext.body_composition ?? {};
      const seg = ext.segmental_data ?? {};

      const output = {
        date: new Date(latest.measure_time * 1000).toISOString(),
        weight_kg: latest.weight_kg,
        weight_lb: latest.weight_lb,
        bmi: latest.bmi,
        body_fat_pct: latest.pbf,
        body_composition: bc,
        segmental_analysis: seg,
        device_model: ext.device_model,
      };

      return {
        content: [
          {
            type: "text" as const,
            text: `Latest measurement:\n\n${formatWeight(latest)}\n\nFull data:\n${JSON.stringify(output, null, 2)}`,
          },
        ],
      };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "delete_weight_data",
  "Delete specific weight measurement records by their data IDs.",
  {
    data_ids: z.array(z.string()).describe("Array of data_id values to delete"),
  },
  async ({ data_ids }) => {
    try {
      const result = await (await getApi()).deleteWeightData(data_ids);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }], isError: true };
    }
  }
);

// ── Body Measurements (Ruler / Tape) ────────────────────────────────────

server.tool(
  "get_ruler_data",
  "Get body girth/tape measurements (chest, waist, hips, arms, legs, etc.).",
  {
    uid: z.number().optional().describe("User ID. Omit to use the account's primary user."),
    since: z.string().optional().describe("Only fetch data after this date (YYYY-MM-DD)"),
  },
  async ({ uid, since }) => {
    try {
      const resolvedUid = await resolveUid(uid);
      const sinceTs = since ? Math.floor(new Date(since).getTime() / 1000) : 0;
      const result = await (await getApi()).syncWeightFromServer(resolvedUid, sinceTs);
      const rulerData = result?.data?.rulers || result?.rulers || [];

      if (rulerData.length === 0) {
        return { content: [{ type: "text" as const, text: "No body measurement records found." }] };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(rulerData, null, 2) }],
      };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }], isError: true };
    }
  }
);

// ── Skip Rope Data ──────────────────────────────────────────────────────

server.tool(
  "get_skip_data",
  "Get jump rope / skip rope workout data.",
  {
    uid: z.number().optional().describe("User ID. Omit to use the account's primary user."),
    since: z.string().optional().describe("Only fetch data after this date (YYYY-MM-DD)"),
  },
  async ({ uid, since }) => {
    try {
      const resolvedUid = await resolveUid(uid);
      const sinceTs = since ? Math.floor(new Date(since).getTime() / 1000) : 0;
      const result = await (await getApi()).syncWeightFromServer(resolvedUid, sinceTs);
      const skipData = result?.data?.skips || result?.skips || [];

      if (skipData.length === 0) {
        return { content: [{ type: "text" as const, text: "No skip rope records found." }] };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(skipData, null, 2) }],
      };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "get_skip_medals",
  "Get skip rope achievement medals for a user.",
  {
    uid: z.number().optional().describe("User ID. Omit to use the account's primary user."),
  },
  async ({ uid }) => {
    try {
      const resolvedUid = await resolveUid(uid);
      const result = await (await getApi()).getSkipMedals(resolvedUid);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }], isError: true };
    }
  }
);

// ── Device Management ───────────────────────────────────────────────────

server.tool(
  "get_device_info",
  "Get information about a connected Terraillon device (scale, ruler, etc.).",
  {
    device_id: z.string().describe("The device ID to look up"),
  },
  async ({ device_id }) => {
    try {
      const result = await (await getApi()).getDeviceInfo(device_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }], isError: true };
    }
  }
);

// ── Account Settings ────────────────────────────────────────────────────

server.tool(
  "get_settings",
  "Get account settings (units, preferences, etc.).",
  {},
  async () => {
    try {
      const result = await (await getApi()).getSettings();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "update_settings",
  "Update account settings.",
  {
    settings: z.string().describe("JSON string of settings to update"),
  },
  async ({ settings }) => {
    try {
      const parsed = JSON.parse(settings);
      const result = await (await getApi()).setSettings(parsed);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }], isError: true };
    }
  }
);

// ── Food Database ───────────────────────────────────────────────────────

server.tool(
  "get_food_categories",
  "Get the food category list from the nutrition database.",
  {
    language: z
      .string()
      .default("en")
      .describe("Language code (en, fr, de, zh_hans, etc.)"),
  },
  async ({ language }) => {
    try {
      const result = await (await getApi()).getFoodCategory(language);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }], isError: true };
    }
  }
);

// ── Sync / Config ───────────────────────────────────────────────────────

server.tool(
  "sync_all_data",
  "Full sync of all data types (weight, ruler, skip, reports) for a user from the server. " +
    "Use this for a comprehensive data pull.",
  {
    uid: z.number().optional().describe("User ID. Omit to use the account's primary user."),
    since: z.string().optional().describe("Only sync data after this date (YYYY-MM-DD)"),
  },
  async ({ uid, since }) => {
    try {
      const resolvedUid = await resolveUid(uid);
      const sinceTs = since ? Math.floor(new Date(since).getTime() / 1000) : 0;
      const result = await (await getApi()).syncWeightFromServer(resolvedUid, sinceTs);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "get_config",
  "Get server configuration and sync settings.",
  {},
  async () => {
    try {
      const result = await (await getApi()).getConfig();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }], isError: true };
    }
  }
);

// ════════════════════════════════════════════════════════════════════════
// RESOURCES
// ════════════════════════════════════════════════════════════════════════

server.resource(
  "session-info",
  "mybodycheck://session",
  async () => {
    const session = api?.getSession();
    return {
      contents: [
        {
          uri: "mybodycheck://session",
          text: session
            ? `Logged in as account_id: ${session.account_id}, region: ${session.region}`
            : "Not logged in",
          mimeType: "text/plain",
        },
      ],
    };
  }
);

// ════════════════════════════════════════════════════════════════════════
// START SERVER
// ════════════════════════════════════════════════════════════════════════

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MyBodyCheck MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
