# Move note to knowledge

Copy a note into a knowledge base as a markdown file and delete the note.
Available from the notes overview (list item menu, pinned/unpinned), the note
editor menu, and the note menu. Added in fork commits `a69a3856e`,
`0ca73b266`, `9aa50790e`, `09df36955`, `c6e78c9df`.

## How it works

1. User picks "Move to Knowledge" in a note menu → `MoveNoteToKnowledgeDialog`
   lists writable knowledge bases only.
2. On confirm, the dialog:
   - fetches the **full** note via `getNoteById` (list responses truncate
     content) and re-checks `note.write_access`;
   - calls `moveNoteToKnowledge` (in `src/lib/components/notes/utils.ts`),
     which uploads the note's markdown as `noteFilename(title).md` via
     `uploadFile` with `{ knowledge_id: kb.id }`;
   - on success, deletes the note, refreshes `pinnedNotes`, and dispatches
     `moved` so the UI refreshes; the editor also navigates back to `/notes`.
3. Failure at any step shows a toast and leaves the note untouched.

## Files touched (fork-only additions)

- `src/lib/components/notes/Notes/MoveNoteToKnowledgeDialog.svelte` — the
  confirm dialog (new component).
- `src/lib/components/notes/Notes/NoteMenu.svelte` — `onMoveToKnowledge`
  callback prop + menu entry.
- `src/lib/components/notes/Notes.svelte` — wires the dialog for the two list
  menus (regular + pinned).
- `src/lib/components/notes/NoteEditor.svelte` — wires the dialog for the
  editor menu (with `redirectToNotes`).
- `src/lib/components/notes/utils.ts` — `noteFilename(title)` (sanitizes the
  title into a `.md` filename, ≤200 chars) and `moveNoteToKnowledge(token,
  note, kb)`.

## Reused component

`src/lib/components/chat/MessageInput/InputMenu/Knowledge.svelte` — the
existing knowledge picker, extended with two optional props:

- `writeAccessOnly` — shows only KBs with `write_access`; if a page has KBs
  but none writable, it skips ahead to the next page (end detection uses raw
  page size, not the global total, because the total covers non-writable KBs).
- `collectionsOnly` — hides the per-KB file expansion; collections only.

These props are additive and default to `false`, so the chat input picker
behaves exactly as upstream.

## i18n keys added by this fork

`Move note to "{{name}}"?`, `Move to Knowledge`,
`You do not have write access to this note`, `Note moved to {{name}}`,
`Failed to move note to knowledge base`, `Failed to delete note`.
All 64 locales carry the keys with empty values (upstream convention).
