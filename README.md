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
      "args": ["/path/to/mybodycheck-mcp/dist/index.js"],
      "env": {
        "MBC_EMAIL": "your-email@example.com",
        "MBC_PASSWORD": "your-password",
        "MBC_REGION": "eu"
      }
    }
  }
}
```

With `MBC_EMAIL` and `MBC_PASSWORD` set, the server logs in automatically on first use and caches the session token in `~/.mybodycheck-mcp/session.json` (permissions `0600`). You won't need to re-authenticate between Claude Desktop restarts until the token is invalidated server-side.

If you'd rather not store credentials in the config, omit the `env` block and use the `login` tool interactively instead — the session is still cached.

### 3. Use in conversation

Just ask — no explicit login needed:

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

## Configuration

Environment variables (set in `claude_desktop_config.json` under `env`):

| Variable       | Required | Description                                  |
|----------------|----------|----------------------------------------------|
| `MBC_EMAIL`    | optional | Your MyBodyCheck email — enables auto-login  |
| `MBC_PASSWORD` | optional | Your MyBodyCheck password                    |
| `MBC_REGION`   | optional | `eu` (default), `us`, or `cn`                |

Session cache: `~/.mybodycheck-mcp/session.json` (permissions `0600`). Delete this file to force a fresh login.

## Technical Details

- Built with the official [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- Communicates via stdio transport
- API protocol reverse-engineered from the MyBodyCheck iOS app binary using static analysis (`otool`, `strings`, CFString parsing)
- Authentication uses header-based signing: sorted headers are URL-encoded and MD5-hashed
- JSON request bodies with auth state passed via custom HTTP headers
- Session tokens are persisted to disk with `0600` permissions; auto-login triggers only when no cached session exists
- Automatic region detection via server-side redirect
