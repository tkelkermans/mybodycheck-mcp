#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MyBodyCheckAPI } from "./api-client.js";

// ── State ───────────────────────────────────────────────────────────────
let api: MyBodyCheckAPI | null = null;

function getApi(): MyBodyCheckAPI {
  if (!api) throw new Error("Not logged in. Use the 'login' tool first.");
  if (!api.getSession()) throw new Error("No active session. Use the 'login' tool first.");
  return api;
}

// ── Helper: parse body_composition JSON safely ──────────────────────────
function parseBodyComposition(raw: string): Record<string, any> | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatWeight(record: any): string {
  const date = new Date(record.measure_time * 1000).toISOString().split("T")[0];
  const time = new Date(record.measure_time * 1000).toISOString().split("T")[1]?.slice(0, 5);
  let out = `📅 ${date} ${time} — ${record.weight_kg} kg`;

  if (record.bmi && record.bmi !== "0") out += ` | BMI: ${record.bmi}`;
  if (record.pbf && record.pbf !== "0") out += ` | Body Fat: ${record.pbf}%`;

  const bc = parseBodyComposition(record.body_composition);
  if (bc) {
    if (bc.bmr) out += ` | BMR: ${bc.bmr} kcal`;
    if (bc.muscle) out += ` | Muscle: ${bc.muscle}%`;
    if (bc.bone) out += ` | Bone: ${bc.bone} kg`;
    if (bc.water) out += ` | Water: ${bc.water}%`;
    if (bc.visceral_fat) out += ` | Visceral Fat: ${bc.visceral_fat}`;
    if (bc.subcutaneous_fat) out += ` | Subcut Fat: ${bc.subcutaneous_fat}%`;
    if (bc.protein) out += ` | Protein: ${bc.protein}%`;
    if (bc.body_age) out += ` | Body Age: ${bc.body_age}`;
    if (bc.body_score) out += ` | Score: ${bc.body_score}`;
  }

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
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Logged in successfully!\nAccount ID: ${session.account_id}\nRegion: ${region}\n\nYou can now use other tools to access your data.`,
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
    const client = getApi();
    await client.logout();
    api = null;
    return { content: [{ type: "text" as const, text: "✅ Logged out successfully." }] };
  } catch (err: any) {
    return { content: [{ type: "text" as const, text: `❌ ${err.message}` }], isError: true };
  }
});

// ── User Profiles ───────────────────────────────────────────────────────

server.tool(
  "get_users",
  "Get all user profiles linked to this account (family members, etc.).",
  {},
  async () => {
    try {
      const result = await getApi().getUsers();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
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
      const result = await getApi().createUser(params);
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
      const result = await getApi().updateUser(params);
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
    uid: z.number().describe("User ID to fetch data for"),
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
      const sinceTs = since ? Math.floor(new Date(since).getTime() / 1000) : 0;
      const result = await getApi().syncWeightFromServer(uid, sinceTs);

      if (format === "raw") {
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      }

      const records = result?.data?.weight_datas || result?.weight_datas || [];
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
        const bc = parseBodyComposition(r.body_composition) || {};
        const seg = parseBodyComposition(r.segmental_data) || {};
        return {
          date: new Date(r.measure_time * 1000).toISOString(),
          weight_kg: r.weight_kg,
          bmi: r.bmi,
          body_fat_pct: r.pbf,
          ...bc,
          segmental: seg,
          device_model: r.device_model,
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
    uid: z.number().describe("User ID"),
  },
  async ({ uid }) => {
    try {
      const result = await getApi().syncWeightFromServer(uid, 0);
      const records = result?.data?.weight_datas || result?.weight_datas || [];
      if (records.length === 0) {
        return { content: [{ type: "text" as const, text: "No weight records found." }] };
      }

      // Sort by measure_time descending, take first
      records.sort((a: any, b: any) => b.measure_time - a.measure_time);
      const latest = records[0];
      const bc = parseBodyComposition(latest.body_composition) || {};
      const seg = parseBodyComposition(latest.segmental_data) || {};

      const output = {
        date: new Date(latest.measure_time * 1000).toISOString(),
        weight_kg: latest.weight_kg,
        weight_lb: latest.weight_lb,
        bmi: latest.bmi,
        body_fat_pct: latest.pbf,
        body_composition: bc,
        segmental_analysis: seg,
        device_model: latest.device_model,
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
      const result = await getApi().deleteWeightData(data_ids);
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
    uid: z.number().describe("User ID"),
    since: z.string().optional().describe("Only fetch data after this date (YYYY-MM-DD)"),
  },
  async ({ uid, since }) => {
    try {
      const sinceTs = since ? Math.floor(new Date(since).getTime() / 1000) : 0;
      const result = await getApi().syncWeightFromServer(uid, sinceTs);
      const rulerData = result?.data?.ruler_datas || result?.ruler_datas || [];

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
    uid: z.number().describe("User ID"),
    since: z.string().optional().describe("Only fetch data after this date (YYYY-MM-DD)"),
  },
  async ({ uid, since }) => {
    try {
      const sinceTs = since ? Math.floor(new Date(since).getTime() / 1000) : 0;
      const result = await getApi().syncWeightFromServer(uid, sinceTs);
      const skipData = result?.data?.skip_datas || result?.skip_datas || [];

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
    uid: z.number().describe("User ID"),
  },
  async ({ uid }) => {
    try {
      const result = await getApi().getSkipMedals(uid);
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
      const result = await getApi().getDeviceInfo(device_id);
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
      const result = await getApi().getSettings();
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
      const result = await getApi().setSettings(parsed);
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
      const result = await getApi().getFoodCategory(language);
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
    uid: z.number().describe("User ID"),
    since: z.string().optional().describe("Only sync data after this date (YYYY-MM-DD)"),
  },
  async ({ uid, since }) => {
    try {
      const sinceTs = since ? Math.floor(new Date(since).getTime() / 1000) : 0;
      const result = await getApi().syncWeightFromServer(uid, sinceTs);
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
      const result = await getApi().getConfig();
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
