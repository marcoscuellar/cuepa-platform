# Connected CUEPA assistant

The persistent chat on authenticated workspace pages calls `/api/assistant`, which calls Anthropic Messages. No canned fallback is used. If configuration is absent or the provider fails, the UI shows an error.

## Deployment configuration

Set these server-only environment variables on the intended Vercel deployment:

- `ANTHROPIC_API_KEY`: a valid Anthropic API key, with provider billing enabled.
- `ANTHROPIC_MODEL`: the exact model ID enabled for that account.

Redeploy after setting variables. Do not place a key in browser code or commit it. No credentials are included in this branch. The implementation environment has neither variable; Vercel environment state has not been inspected.

## Verification before release

Sign in to the preview, open Ask CUEPA, and confirm it reports Ready. Ask an open-ended question and verify a provider-generated answer. Switch to Inbox and Calendar and confirm the same chat reappears. Verify a different user cannot inherit that conversation. Confirm failures show errors rather than generated-looking placeholders.

## Scope

Only typed conversation is sent. Automatic Gmail, calendar, timecard, file retrieval and action tools are not implemented. The assistant can help brainstorm, prepare, and draft from information the user supplies; it cannot send emails, approve payroll, or change calendars.

Conversation history is retained in sessionStorage per workspace and user, for the current browser tab, and cleared on sign out or New chat. It is not encrypted server-side persistence. The request includes up to 19 prior/current messages and a 1,200-token output cap. The per-process 12-request/minute guard is a best-effort burst limit, not a distributed billing cap; configure provider spending limits separately.

Automated tests mock the provider. A live provider smoke test and visual browser QA remain pending.
