import { describe, expect, it } from 'vitest';

import { consumeUrlQuery, tempChatInterimTitle } from './chatEntry';

describe('consumeUrlQuery', () => {
	it('consumes the q param on first call and strips it from the URL', () => {
		const result = consumeUrlQuery(
			'http://localhost:5173/?temporary-chat=true&q=how%20is%20the%20weather',
			null
		);

		expect(result).toEqual({
			query: 'how is the weather',
			strippedUrl: '/?temporary-chat=true'
		});
	});

	it('preserves the pathname, other params, and the hash', () => {
		const result = consumeUrlQuery(
			'http://localhost:5173/folders/abc?models=m1&m2=ignored&q=test&q2=keep#section',
			null
		);

		expect(result?.query).toBe('test');
		// q2 stays; only q is removed.
		expect(result?.strippedUrl).toBe('/folders/abc?models=m1&m2=ignored&q2=keep#section');
	});

	it('returns null when there is no q param', () => {
		expect(consumeUrlQuery('http://localhost:5173/?temporary-chat=true', null)).toBeNull();
	});

	it('returns null for an empty q param', () => {
		expect(consumeUrlQuery('http://localhost:5173/?q=', null)).toBeNull();
	});

	it('refuses the same query twice (stale page-store URL / archive-delete re-runs)', () => {
		const href = 'http://localhost:5173/?q=hello';

		expect(consumeUrlQuery(href, 'hello')).toBeNull();
	});

	it('consumes a different query after a previous one', () => {
		const result = consumeUrlQuery('http://localhost:5173/?q=second', 'first');

		expect(result?.query).toBe('second');
		expect(result?.strippedUrl).toBe('/');
	});

	it('does not mutate the caller URL', () => {
		const href = 'http://localhost:5173/?q=keepme&x=1';

		consumeUrlQuery(href, null);

		expect(href).toBe('http://localhost:5173/?q=keepme&x=1');
	});
});

describe('tempChatInterimTitle', () => {
	const firstTurnHistory = {
		messages: {
			u1: { parentId: null, content: 'What is the sun? One word answer.' }
		}
	};

	it('returns the first user message on the first turn', () => {
		expect(tempChatInterimTitle(firstTurnHistory, 'u1', '')).toBe(
			'What is the sun? One word answer.'
		);
	});

	it('returns null when a title already exists', () => {
		expect(tempChatInterimTitle(firstTurnHistory, 'u1', 'Generated Title')).toBeNull();
	});

	it('returns null beyond the first turn', () => {
		const history = {
			messages: {
				u1: { parentId: null, content: 'first question' },
				a1: { parentId: 'u1', content: 'answer' },
				u2: { parentId: 'a1', content: 'second question' }
			}
		};

		expect(tempChatInterimTitle(history, 'u2', '')).toBeNull();
	});

	it('returns null for non-string content (e.g. multimodal parts)', () => {
		const history = {
			messages: {
				u1: { parentId: null, content: [{ type: 'text', text: 'look at this' }] }
			}
		};

		expect(tempChatInterimTitle(history, 'u1', '')).toBeNull();
	});

	it('returns null for whitespace-only content', () => {
		const history = { messages: { u1: { parentId: null, content: '   ' } } };

		expect(tempChatInterimTitle(history, 'u1', '')).toBeNull();
	});

	it('returns null when the message is missing', () => {
		expect(tempChatInterimTitle({ messages: {} }, 'missing', '')).toBeNull();
	});
});
