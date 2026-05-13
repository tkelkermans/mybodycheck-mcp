# Lessons

## 2026-05-13: MCP auth tools must match privacy-safe client behavior

When adding env-var authentication for Claude Desktop, do not leave the public MCP tool schema requiring `email` and `password`. Claude Desktop will correctly refuse to collect passwords in chat, so the server must expose a no-argument path that reads credentials from the MCP process environment.

Rule: For MCP servers with env-configured secrets, make credential parameters optional and document that Claude Desktop users should call the auth tool with no arguments.

## 2026-05-13: Validate cached bearer tokens with an authenticated endpoint

A cached token can be syntactically present but expired server-side. Do not trust a session file just because it exists. Also do not validate with unauthenticated or weak endpoints like config endpoints; they can return success even when the bearer token is invalid.

Rule: On startup/session restore, validate cached bearer tokens with an endpoint that fails on invalid auth, then refresh from env credentials when available.
