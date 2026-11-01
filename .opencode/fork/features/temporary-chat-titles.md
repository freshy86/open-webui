# Temporary chat titles

Temporary chats get the two title features that saved chats already had:

- **Automatic chat title generation** — after the first response completes, the
  LLM generates a title (same task model + prompt template as saved chats).
- **Chat title in the browser tab** — the tab shows the title instead of just
  the site name. Before the generated title arrives, the first user message is
  shown as an interim tab title.
- **"Save Chat" adopts the title** — saving a temporary chat from the Navbar
  uses the generated/interim title instead of re-deriving one from the raw
  first message.

Upstream deliberately skips titles for temporary chats (`!$temporaryChatEnabled`
guard); this fork re-enables them because temp chats here are full-fledged
client-side conversations (see `src/lib/utils/chatId.ts`).

## How it works

1. **Frontend request** (`src/lib/components/chat/Chat.svelte`,
   `sendMessageSocket`): the `background_tasks` payload no longer excludes temp
   chats. On the first turn it now sends `title_generation` (per the
   `title.auto` user setting) for temp chats too; `tags_generation` is still
   saved-chat-only because tags have nowhere to persist for temp chats. The
   first-turn-only condition (`parentId === null` + message list length 2) is
   unchanged, so later turns and regenerations after turn one don't re-request
   titles.
2. **Backend gate** (`backend/open_webui/utils/middleware.py`,
   `background_tasks_handler`): the title/tags block previously required
   `is_saved_chat_id(chat_id)`. It now also admits
   `is_temporary_chat_id(chat_id)`:
   - `generate_title` runs the same for both (it only needs `model` +
     `messages`, which the temp branch already takes from `form_data`).
   - `Chats.update_chat_title_by_id` stays behind an `is_saved_chat` check —
     temp chats never touch the DB.
   - The `chat:title` socket event is emitted for both; the event emitter
     already delivers every event type to the user's socket room regardless of
     chat persistence, so no socket changes were needed.
   - Tags generation remains saved-only (`is_saved_chat` guard on the tags
     block).
   - `messages_map` is initialized to `None` at the top of the handler — the
     fallback-title condition referenced it unconditionally and would have
     raised `NameError` for temp chats.
   - Fallback title (when `title.auto` is off) is temp-aware: temp payloads
     include the system prompt in `messages` (saved chats don't), so the code
     filters system messages before the `len == 2` first-turn check and uses
     the last user message (not `messages[0]`) as the title text — otherwise a
     system prompt could leak in as the title.
3. **Interim tab title** (`Chat.svelte`, `sendMessage`): when a temp chat sends
   its very first message, `chatTitle` is set to the first user message (only
   if still empty). The existing `<svelte:head><title>` block renders
   `$chatTitle` truncated to 30 chars. The LLM-generated `chat:title` event
   overwrites it; if generation is disabled, the backend fallback (truncated
   first message) overwrites it with equivalent content.
4. **Tab title display**: no new code — the existing
   `showChatTitleInTab !== false && $chatTitle` check in the `<title>` block
   and the `chat:title` event handler (`chatTitle.set(data)`) do all the work.
5. **Save Chat** (`Chat.svelte`, `onSaveTempChat`): title preference is now
   `$chatTitle || first user message || 'New Chat'`, so a saved temp chat keeps
   its generated title.

## Behavior notes

- All existing gates still apply: admin `task.title.enable` config and the
  per-user `title.auto` setting (off ⇒ truncated-first-message fallback, same
  as saved chats).
- Temp chat IDs are stable per socket session (`temporary:<socketSessionId>`),
  so title generation needs no DB record.
- The `chat:title` handler also calls `refreshChatList` — a harmless no-op for
  temp chats (nothing in the DB changed).
- Saving a temp chat mid-title-generation can capture the interim
  first-message title; the save handler truncates to 50 chars as before.
- `chatTitle` is reset by `initNewChat`/`onSelect` as before, so a temp title
  never leaks into the next chat.

## Files touched

- `backend/open_webui/utils/middleware.py` — widened title gate, saved-only DB
  writes + tags, temp-aware fallback title, `messages_map` init.
- `src/lib/components/chat/Chat.svelte` — `background_tasks` payload includes
  temp chats (titles only), interim tab title in `sendMessage`, save handler
  title preference.
