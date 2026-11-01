import { createMessagesList } from '.';

/**
 * Consume the `?q=` URL param that auto-submits the first message of a new
 * chat (fork feature, see .opencode/fork/features/url-query-auto-submit.md).
 *
 * Returns the query and the URL with the param removed, or null when there is
 * nothing to consume: no `q`, an empty `q`, or a query that was already
 * consumed by this component instance (SvelteKit's page-store URL can carry a
 * stale `q` until the next navigation, and initNewChat is also invoked
 * directly by the archive/delete handlers).
 */
export const consumeUrlQuery = (
	href: string,
	consumedQuery: string | null
): { query: string; strippedUrl: string } | null => {
	const url = new URL(href);
	const query = url.searchParams.get('q');
	if (!query || query === consumedQuery) {
		return null;
	}

	url.searchParams.delete('q');
	return { query, strippedUrl: url.pathname + url.search + url.hash };
};

/**
 * Interim tab title for temporary chats (fork feature, see
 * .opencode/fork/features/temporary-chat-titles.md): the first user message
 * is shown until a generated title arrives. Returns null when the chat is not
 * on its first turn, a title already exists, or the message has no usable
 * text content.
 */
export const tempChatInterimTitle = (
	history: {
		messages: Record<string, { parentId?: string | null; content?: unknown } | undefined>;
	},
	parentId: string,
	currentTitle: string
): string | null => {
	if (currentTitle) {
		return null;
	}

	if (createMessagesList(history, parentId).length !== 1) {
		return null;
	}

	const content = history.messages[parentId]?.content;
	return typeof content === 'string' && content.trim() ? content : null;
};
