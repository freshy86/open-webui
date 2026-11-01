# URL query auto-submit

Opening a new chat — saved or temporary — with a `?q=` URL parameter prefills
the input **and immediately sends the message**, no Enter required:

- `/?q=How is the weather today` → new saved chat, message sent at once.
- `/?temporary-chat=true&q=How is the weather today` → new temporary chat,
  message sent at once.
- Composes with the other new-chat params (`model`/`models`, `web-search`,
  `tools`, `youtube`, …).

Upstream behavior for `?q=` was prefill-only (it existed for the workspace
SearchModal "create chat" action, which navigates to `/?q=<query>`); that flow
now auto-sends too, matching its "start a chat about this" intent.

## How it works

All inside `src/lib/components/chat/Chat.svelte`, with the pure decision logic
extracted to `src/lib/utils/chatEntry.ts` (unit-tested, see Testing):

1. **Consume + prefill** (`initNewChat`, the `?q=` branch): the query is read
   once per component instance (`consumedUrlQuery` guard), the `q` param is
   removed from the address bar with a **native** `history.replaceState`, the
   input is prefilled via `messageInput.setTextHandler(q)`, and the query is
   parked in `urlQuerySubmitPending`.
2. **Deferred submit** (reactive block near the model-defaults logic): once
   `!loading` and `selectedModels` has a real model, `submitHandler(query)`
   fires and the pending value is cleared. The deferral matters because on a
   fresh deep-link visit the layout sets `$user` (which unlocks the chat) *
   before* `setModels()` resolves — models are simply not in the store yet when
   `initNewChat` runs, and submitting then would toast "Model not selected".
   With models already loaded (SPA navigation, e.g. SearchModal) the submit
   fires on the next reactive cycle.
3. If models never resolve (no model configured), the text stays prefilled and
   the user can send manually — auto-submit silently never fires.

## Why native `replaceState` (not `$app/navigation`)

- SvelteKit's dev-mode wrapper for native `replaceState` only logs a warning
  and does **not** notify the page store — so `page.subscribe` does not re-run
  `initNewChat` mid-send (a re-run would reset the in-flight chat). The repo
  already uses native `replaceState` for the temporary-chat toggle.
- `$app/navigation`'s `replaceState` **would** update the page store and
  re-trigger `initNewChat` — that's why it must not be used here.

## Resubmission guards

- **URL strip**: the `q` param is removed at consumption, so a reload or
  back-navigation cannot resubmit it (the history entry itself is replaced).
  For temporary chats the URL keeps `?temporary-chat=true`, so a refresh
  yields a fresh *empty* temp chat. Saved chats move to `/c/<id>` as usual.
- **Stale-store guard**: SvelteKit's `$page.url` keeps the old `q` until the
  next navigation, and `initNewChat` is also invoked directly by the
  archive/delete handlers — the `consumedUrlQuery` check stops those runs from
  re-consuming the same query.
- **Pending clear**: `urlQuerySubmitPending` is reset in `initNewChat`,
  `navigateHandler`, and `initEmbeddedDraft`, so a query can never leak into a
  different chat that happens to open before models resolve.

## Testing

**Unit** (runs in CI via `npm run test:frontend`):
`src/lib/utils/chatEntry.test.ts` — 13 Vitest tests over the extracted
decision logic in `src/lib/utils/chatEntry.ts`:

- `consumeUrlQuery` — consume-once semantics (first call consumes, same query
  refused, different query accepted), empty/missing `q` → null, strip preserves
  pathname/other params/hash, input URL never mutated.
- `tempChatInterimTitle` — first-turn user message returned; null when a title
  exists, beyond the first turn, for non-string (multimodal) content,
  whitespace-only content, or a missing message.

**End-to-end** (manual, against dev servers):
`../tests/url_query_auto_submit.e2e.cjs` — Playwright browser test against
both dev servers (Playwright is not a repo dependency; install it ad-hoc, e.g.
`cd /tmp && npm i playwright && npx playwright install chromium`). Needs a
test user's credentials via `TEST_EMAIL` / `TEST_PASSWORD` env vars. The
`.cjs` extension is deliberate: the repo root is `"type": "module"` and a
`*.test.*` name would be collected by Vitest, which has no Playwright.

```sh
TEST_EMAIL=… TEST_PASSWORD=… node .opencode/fork/tests/url_query_auto_submit.e2e.cjs
```

Covers: `/?temporary-chat=true&q=…` sends immediately, strips `q` from the
URL, shows the interim query as tab title then the generated title; New Chat
afterwards does not resubmit; `/?q=…` sends in a saved chat and lands on
`/c/<uuid>`.

Title generation itself is covered by the temporary-chat-titles feature
(`temporary-chat-titles.md`) and its socket-level test
(`../tests/temp_chat_titles_e2e.py`).
