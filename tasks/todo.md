# MyBodyCheck MCP Login UX Fix

## Plan
- [x] Confirm the root cause of Claude Desktop asking for chat-supplied credentials.
- [x] Make the `login` tool callable without explicit credentials by reading env vars when args are omitted.
- [x] Keep explicit login available for clients that support secure credential entry.
- [x] Update README so Claude Desktop users are guided toward env-based auto-login, not chat passwords.
- [x] Verify with `npm run build`, MCP `tools/list`, no-arg `login`, and a protected data tool.
- [x] Update `tasks/lessons.md` with the correction pattern.

## Review
Root cause was twofold:

- The `login` MCP schema still required `email` and `password`, so Claude Desktop refused to call it from chat.
- Cached sessions were accepted without validation, and `get_config` was not a valid auth check because it can succeed with an invalid token.

Changes made:

- `login` can now be called without arguments and refreshes from `MBC_EMAIL`/`MBC_PASSWORD`.
- Cached sessions are validated with `getSettings`, which fails on invalid tokens.
- Invalid cached tokens are cleared and refreshed from env vars when available.
- README now tells Claude Desktop users not to type passwords into chat and to call `login` without arguments.

Verification:

- `npm run build` passes.
- `tools/list` shows `login` has no required args.
- No-arg `login` succeeds with environment credentials.
- Corrupted cached token + protected `get_latest_weight` call refreshes from env and returns real data.
