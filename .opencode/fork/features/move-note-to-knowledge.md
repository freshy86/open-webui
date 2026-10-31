# Move note to knowledge

Copy a note into a knowledge base as a markdown file and delete the note.
Available from the notes overview (list item menu, pinned/unpinned), the note
editor menu, and the note menu. Added in fork commits `a69a3856e`,
`0ca73b266`, `9aa50790e`, `09df36955`, `c6e78c9df`.

## How it works

1. User picks "Move to Knowledge" in a note menu → `MoveNoteToKnowledgeDialog`
   lists writable knowledge bases only.
2. On confirm, the dialog calls `moveNoteToKnowledgeFlow` (in
   `src/lib/components/notes/utils.ts`), which:
   - optionally persists the latest editor state first (`onBeforeMove`, the
     editor passes a best-effort `flushActivePage()` — so the copy is current
     even when the user just typed, and a failing flush never blocks the move);
   - fetches the **full** note via `getNoteById` (list responses truncate
     content) and re-checks `note.write_access`;
   - uploads the note's markdown as `noteFilename(title).md` via
     `moveNoteToKnowledge` → `uploadFile` with `{ knowledge_id: kb.id }`;
   - on success, deletes the note, refreshes `pinnedNotes`, and signals
     `onMoved`/dispatches `moved` so the UI refreshes; the editor also
     navigates back to `/notes`.
3. Failure at any step shows a toast and leaves the note untouched.

## Files touched (fork-only additions)

- `src/lib/components/notes/Notes/MoveNoteToKnowledgeDialog.svelte` — the
  confirm dialog (new component); accepts an `onBeforeMove` callback.
- `src/lib/components/notes/Notes/NoteMenu.svelte` — `onMoveToKnowledge`
  callback prop + menu entry.
- `src/lib/components/notes/Notes.svelte` — wires the dialog for the two list
  menus (regular + pinned).
- `src/lib/components/notes/NoteEditor.svelte` — wires the dialog for the
  editor menu (with `redirectToNotes`); passes a best-effort flush as
  `onBeforeMove` and sets a `noteRemoved` guard on `moved` so
  `flushActivePage()` short-circuits after the note is gone.
- `src/lib/components/notes/utils.ts` — `noteFilename(title)` (sanitizes the
  title into a `.md` filename, ≤200 chars), `moveNoteToKnowledge(token, note,
  kb)` (single upload), and `moveNoteToKnowledgeFlow(...)` (the full
  persist → fetch → check → upload → delete → refresh → signal sequence).

## Reused component

`src/lib/components/chat/MessageInput/InputMenu/Knowledge.svelte` — the
existing knowledge picker, extended with two optional props:

- `writeAccessOnly` — shows only KBs with `write_access`; if a page has KBs
  but none writable, it skips ahead to the next page (end detection uses raw
  page size, not the global total, because the total covers non-writable KBs).
- `collectionsOnly` — hides the per-KB file expansion; collections only.

These props are additive and default to `false`, so the chat input picker
behaves exactly as upstream.

## Regression tests

`src/lib/components/notes/utils.test.ts` (13 tests, `npx vitest run`) covers
the move flow end-to-end with mocked API calls:

- `noteFilename` — illegal-filename characters sanitized to dashes, 200-char
  cap, `Untitled.md` fallback.
- `moveNoteToKnowledge` — uploads the note's markdown under the note title
  into the right KB (`uploadFile` called with `{ knowledge_id }`), `Untitled`
  fallback for missing titles, empty-content fallback, and the upload-failure
  path (returns false, error toast, note untouched).
- `moveNoteToKnowledgeFlow` — the regression-critical sequences:
  - **persist before fetch**: `onBeforeMove` flush runs before the full note
    is fetched, so the copy in the KB is never stale (bug found 2026-10-31:
    the copy used the last persisted content, not the latest edits).
  - abort with toast when the full note cannot be fetched; nothing uploaded,
    nothing deleted.
  - refuse to move a note without `write_access`.
  - **no delete on failed upload** (bug class this guards: a failed upload
    must never delete the note).
  - **failed delete keeps the note** and reports an error instead of
    signalling success.
  - success path: pinned notes refreshed and `onMoved` fired only after the
    server-side delete.
  - A historical bug this file documents in the editor wiring: after the move
    deletes the note server-side, the editor's `onNavigate` still flushed the
    collaboration document, which 404'd and threw "Failed to save page",
    blocking all navigation. The editor now sets `noteRemoved` (from the
    `moved` event) and `flushActivePage()` short-circuits. This part lives in
    `NoteEditor.svelte` wiring, not in the tested function — if navigation
    after a move ever blocks again, check that the `noteRemoved` guard is
    still in place.

Run with `npx vitest run` (the `npm run test:frontend` watch script can fail
with an inotify `ENOSPC` while the dev servers are running).

## i18n keys added by this fork

`Move note to "{{name}}"?`, `Move to Knowledge`,
`You do not have write access to this note`, `Note moved to {{name}}`,
`Failed to move note to knowledge base`, `Failed to delete note`.
All 64 locales carry the keys with empty values (upstream convention).
