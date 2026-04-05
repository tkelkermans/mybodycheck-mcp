# MyBodyCheck MCP Server

An MCP (Model Context Protocol) server that provides access to your **MyBodyCheck / Terraillon** smart scale data through the Fitdays cloud API.

## What it does

This MCP server reverse-engineers and wraps the Fitdays API used by the MyBodyCheck app (by Terraillon) to give you programmatic access to:

- **Weight & Body Composition** — weight, BMI, body fat %, muscle mass, bone mass, body water %, visceral fat, subcutaneous fat, protein %, body age, body score, BMR, and 8-electrode segmental analysis
- **Body Measurements** — girth/tape measurements (chest, waist, hips, arms, legs)
- **Jump Rope Workouts** — skip count, frequency, calories, duration, medals
- **User Profiles** — manage family member profiles
- **Device Management** — info about connected Terraillon devices
- **Food Database** — nutritional data from the built-in food database
- **Account Settings** — units, preferences, sync configuration

## Setup

### 1. Install dependencies and build

```bash
cd mybodycheck-mcp
npm install
npm run build
```

### 2. Configure in Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mybodycheck": {
      "command": "node",
      "args": ["/path/to/mybodycheck-mcp/dist/index.js"]
    }
  }
}
```

### 3. Use in conversation

Once connected, start by logging in:

> "Log in to MyBodyCheck with my email tristan@example.com"

Then you can ask things like:

> "Show me my latest weight and body composition"
> "Get my weight trend for the last 30 days"
> "List all family member profiles"
> "What are my body measurements?"

## Available Tools

| Tool | Description |
|------|-------------|
| `login` | Authenticate with email/password (required first) |
| `logout` | End the session |
| `get_users` | List all user profiles on the account |
| `create_user` | Add a new family member profile |
| `update_user` | Modify a user profile |
| `get_weight_data` | Fetch weight & body composition history |
| `get_latest_weight` | Get the most recent measurement |
| `delete_weight_data` | Remove specific weight records |
| `get_ruler_data` | Fetch body tape measurements |
| `get_skip_data` | Fetch jump rope workout data |
| `get_skip_medals` | Get skip rope achievements |
| `get_device_info` | Look up a connected device |
| `get_settings` | Read account settings |
| `update_settings` | Modify account settings |
| `get_food_categories` | Browse the nutrition database |
| `sync_all_data` | Full data sync for a user |
| `get_config` | Get server sync configuration |

## Regions

The API supports three regions — pick the one matching your account. The server automatically follows redirects if your account is on a different region.

- `eu` — Europe (default): `plus-eu.fitdays.cn`
- `us` — USA: `plus-us.fitdays.cn`
- `cn` — China: `plus.fitdays.cn`

## Body Composition Metrics

With an 8-electrode Terraillon scale (like the Master Coach Expert), you get:

- Weight (kg / lb / st)
- BMI
- Body Fat %
- Muscle Mass %
- Bone Mass (kg)
- Body Water %
- Visceral Fat rating
- Subcutaneous Fat %
- Protein %
- BMR (Basal Metabolic Rate)
- Body Age
- Body Score
- Segmental analysis (left arm, right arm, left leg, right leg, trunk)

## Technical Details

- Built with the official [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- Communicates via stdio transport
- API protocol reverse-engineered from the MyBodyCheck iOS app binary using static analysis (`otool`, `strings`, CFString parsing)
- Authentication uses header-based signing: sorted headers are URL-encoded and MD5-hashed
- JSON request bodies with auth state passed via custom HTTP headers
- Session-based (login required per server session)
- Automatic region detection via server-side redirect
