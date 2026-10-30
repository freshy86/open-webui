<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';

	import { i18n, pinnedNotes } from '$lib/stores';
	import { getNoteById, deleteNoteById, getPinnedNoteList } from '$lib/apis/notes';
	import DeleteConfirmDialog from '$lib/components/common/ConfirmDialog.svelte';
	import { moveNoteToKnowledge } from '../utils';

	export let show = false;
	export let noteId: string | null = null;
	export let kb: { id: string; name: string } | null = null;
	// Navigate back to the notes list after the note is deleted (used by the editor)
	export let redirectToNotes = false;

	const dispatch = createEventDispatcher<{ moved: string; begin: undefined }>();

	const confirmHandler = async () => {
		dispatch('begin');
		show = false;

		if (!kb || !noteId) {
			return;
		}

		// The overview list truncates note content, so always fetch the full note
		const note = await getNoteById(localStorage.token, noteId).catch((error) => {
			toast.error(`${error}`);
			return null;
		});

		if (!note) {
			return;
		}

		if (!note.write_access) {
			toast.error($i18n.t('You do not have write access to this note'));
			return;
		}

		const moved = await moveNoteToKnowledge(localStorage.token, note, kb);

		if (moved) {
			toast.success($i18n.t('Note moved to {{name}}', { name: kb.name }));
			const res = await deleteNoteById(localStorage.token, note.id).catch(() => null);

			if (res) {
				pinnedNotes.set(await getPinnedNoteList(localStorage.token).catch(() => []));
				dispatch('moved', note.id);

				if (redirectToNotes) {
					goto('/notes');
				}
			} else {
				toast.error($i18n.t('Failed to delete note'));
			}
		} else {
			toast.error($i18n.t('Failed to move note to knowledge base'));
		}
	};
</script>

<DeleteConfirmDialog
	bind:show
	title={$i18n.t('Move note to "{{name}}"?', { name: kb?.name })}
	on:confirm={confirmHandler}
>
	<div class=" text-sm text-gray-500 truncate">
		{$i18n.t('This will copy the note to {{name}} as a markdown file and delete this note.', {
			name: kb?.name
		})}
	</div>
</DeleteConfirmDialog>
