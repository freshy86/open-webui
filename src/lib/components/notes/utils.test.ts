import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from 'svelte-sonner';

import { moveNoteToKnowledge, moveNoteToKnowledgeFlow, noteFilename } from './utils';
import { deleteNoteById, getNoteById, getPinnedNoteList } from '$lib/apis/notes';
import { uploadFile } from '$lib/apis/files';
import { pinnedNotes } from '$lib/stores';

vi.mock('svelte-sonner', () => ({
	toast: { success: vi.fn(), error: vi.fn() }
}));

const uploadFileMock = vi.mocked(uploadFile);
const getNoteByIdMock = vi.mocked(getNoteById);
const deleteNoteByIdMock = vi.mocked(deleteNoteById);
const getPinnedNoteListMock = vi.mocked(getPinnedNoteList);
const pinnedNotesSetMock = vi.mocked(pinnedNotes.set);

vi.mock('$lib/apis/files', () => ({ uploadFile: vi.fn() }));
vi.mock('$lib/apis/notes', () => ({
	createNewNote: vi.fn(),
	getNoteById: vi.fn(),
	deleteNoteById: vi.fn(),
	getPinnedNoteList: vi.fn()
}));
vi.mock('$lib/stores', () => ({ pinnedNotes: { set: vi.fn() } }));

const token = 'token';
const kb = { id: 'kb-1', name: 'Docs' };
const identityT = (key: string, vars?: Record<string, unknown>) => {
	if (vars) {
		return key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name]));
	}
	return key;
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('noteFilename', () => {
	it('replaces characters that are illegal in filenames with dashes', () => {
		expect(noteFilename('Notes: "quoted" <titles>?')).toBe('Notes- -quoted- -titles--.md');
	});

	it('caps the sanitized title at 200 characters', () => {
		expect(noteFilename('a'.repeat(300))).toBe(`${'a'.repeat(200)}.md`);
	});

	it('falls back to Untitled for an empty title', () => {
		expect(noteFilename('')).toBe('Untitled.md');
	});
});

describe('moveNoteToKnowledge', () => {
	const note = { id: 'note-1', title: 'My note', data: { content: { md: '# Hello' } } };

	it('uploads the markdown content under the note title into the knowledge base', async () => {
		uploadFileMock.mockResolvedValue({ id: 'file-1' });

		expect(await moveNoteToKnowledge(token, note, kb)).toBe(true);
		expect(uploadFileMock).toHaveBeenCalledWith(token, expect.any(File), {
			knowledge_id: 'kb-1'
		});

		const file = uploadFileMock.mock.calls[0][1] as File;
		expect(file.name).toBe('My note.md');
		expect(file.type).toBe('text/markdown');
		await expect(file.text()).resolves.toBe('# Hello');
	});

	it('uses Untitled when the note has no title', async () => {
		uploadFileMock.mockResolvedValue({ id: 'file-1' });

		await moveNoteToKnowledge(token, { ...note, title: '' }, kb);

		const file = uploadFileMock.mock.calls[0][1] as File;
		expect(file.name).toBe('Untitled.md');
	});

	it('falls back to empty content when the note has none', async () => {
		uploadFileMock.mockResolvedValue({ id: 'file-1' });

		await moveNoteToKnowledge(token, { id: 'note-1', title: 'My note' }, kb);

		const file = uploadFileMock.mock.calls[0][1] as File;
		await expect(file.text()).resolves.toBe('');
	});

	it('returns false and toasts when the upload fails', async () => {
		uploadFileMock.mockRejectedValue(new Error('upload failed'));

		expect(await moveNoteToKnowledge(token, note, kb)).toBe(false);
		expect(toast.error).toHaveBeenCalledWith('Error: upload failed');
	});
});

describe('moveNoteToKnowledgeFlow', () => {
	const note = {
		id: 'note-1',
		write_access: true,
		data: { content: { md: '# Hello' } }
	};

	const runFlow = async (options: {
		onBeforeMove?: () => Promise<void>;
		onMoved?: (id: string) => void;
	}) =>
		moveNoteToKnowledgeFlow(token, 'note-1', kb, {
			onBeforeMove: options.onBeforeMove,
			onMoved: options.onMoved ?? (() => {}),
			t: identityT
		});

	it('persists the editor state before the note is fetched, then moves it', async () => {
		const order: string[] = [];
		getNoteByIdMock.mockResolvedValue(note);
		uploadFileMock.mockResolvedValue({ id: 'file-1' });
		deleteNoteByIdMock.mockResolvedValue(note);
		getPinnedNoteListMock.mockResolvedValue([]);

		await runFlow({
			onBeforeMove: async () => order.push('flush'),
			onMoved: () => order.push('moved')
		});

		expect(order).toEqual(['flush', 'moved']);
		expect(getNoteByIdMock).toHaveBeenCalledWith(token, 'note-1');
	});

	it('aborts with a toast when the full note cannot be fetched', async () => {
		getNoteByIdMock.mockRejectedValue(new Error('404'));

		await runFlow({});

		expect(toast.error).toHaveBeenCalledWith('Error: 404');
		expect(uploadFileMock).not.toHaveBeenCalled();
		expect(deleteNoteByIdMock).not.toHaveBeenCalled();
		expect(pinnedNotesSetMock).not.toHaveBeenCalled();
	});

	it('refuses to move a note the user cannot write to', async () => {
		getNoteByIdMock.mockResolvedValue({ ...note, write_access: false });

		await runFlow({});

		expect(toast.error).toHaveBeenCalledWith('You do not have write access to this note');
		expect(uploadFileMock).not.toHaveBeenCalled();
		expect(deleteNoteByIdMock).not.toHaveBeenCalled();
	});

	it('deletes the note only after a successful upload', async () => {
		getNoteByIdMock.mockResolvedValue(note);
		uploadFileMock.mockRejectedValue(new Error('upload failed'));

		expect(await runFlow({})).toBe(false);

		expect(toast.error).toHaveBeenCalledWith('Failed to move note to knowledge base');
		expect(deleteNoteByIdMock).not.toHaveBeenCalled();
	});

	it('keeps the note when the delete fails and reports the error', async () => {
		getNoteByIdMock.mockResolvedValue(note);
		uploadFileMock.mockResolvedValue({ id: 'file-1' });
		deleteNoteByIdMock.mockResolvedValue(null);
		const onMoved = vi.fn();

		expect(await runFlow({ onMoved })).toBe(false);

		expect(toast.error).toHaveBeenCalledWith('Failed to delete note');
		expect(pinnedNotesSetMock).not.toHaveBeenCalled();
		expect(onMoved).not.toHaveBeenCalled();
	});

	it('refreshes pinned notes and signals the move after deleting the note', async () => {
		getNoteByIdMock.mockResolvedValue(note);
		uploadFileMock.mockResolvedValue({ id: 'file-1' });
		deleteNoteByIdMock.mockResolvedValue(note);
		getPinnedNoteListMock.mockResolvedValue([]);
		const onMoved = vi.fn();

		expect(await runFlow({ onMoved })).toBe(true);

		expect(toast.success).toHaveBeenCalledWith('Note moved to Docs');
		expect(deleteNoteByIdMock).toHaveBeenCalledWith(token, 'note-1');
		expect(getPinnedNoteListMock).toHaveBeenCalledWith(token);
		expect(pinnedNotesSetMock).toHaveBeenCalledWith([]);
		expect(onMoved).toHaveBeenCalledWith('note-1');
	});
});
