<script lang="ts">
	import { createEventDispatcher, getContext } from 'svelte';
	import { goto } from '$app/navigation';

	import { moveNoteToKnowledgeFlow } from '../utils';
	import DeleteConfirmDialog from '$lib/components/common/ConfirmDialog.svelte';

	const i18n = getContext<typeof import('$lib/i18n').default>('i18n');
	const dispatch = createEventDispatcher<{ moved: string; begin: undefined }>();

	export let show = false;
	export let noteId: string | null = null;
	export let kb: { id: string; name: string } | null = null;
	// Persist the latest editor state before the note is fetched and moved
	// (used by the editor; a failing flush must not block the move).
	export let onBeforeMove: (() => Promise<void>) | undefined;
	// Navigate back to the notes list after the note is deleted (used by the editor)
	export let redirectToNotes = false;

	const confirmHandler = async () => {
		dispatch('begin');
		show = false;

		if (!kb || !noteId) {
			return;
		}

		const moved = await moveNoteToKnowledgeFlow(localStorage.token, noteId, kb, {
			onBeforeMove,
			onMoved: (id) => dispatch('moved', id),
			t: (key, vars) => $i18n.t(key, vars)
		});

		if (moved && redirectToNotes) {
			goto('/notes');
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
