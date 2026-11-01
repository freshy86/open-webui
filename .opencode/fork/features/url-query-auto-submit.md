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

All inside `src/lib/components/chat/Chat.svelte`:

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

Verified with Playwright (chromium headless, installed ad-hoc under /tmp — not
a repo dependency) against the dev servers, using a throwaway DB user:

- `/?temporary-chat=true&q=…` → message sent without input; URL becomes
  `?temporary-chat=true`; tab title shows the query, then the generated title.
- New Chat afterwards → no resubmission; tab title resets.
- `/?q=…` → message sent, URL becomes `/c/<uuid>`, title generated.

Title generation itself is covered by the temporary-chat-titles feature
(`temporary-chat-titles.md`) and its socket-level tests.
