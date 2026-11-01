"""End-to-end regression tests for the temporary-chat-titles fork feature.

Run against a live backend (dev.sh / uvicorn on localhost:8080) with at least
one chat model configured:

    cd backend && venv/bin/python ../.opencode/fork/tests/temp_chat_titles_e2e.py

Covers (see ../features/temporary-chat-titles.md):
- temporary chats emit `chat:title` via socket and never create a DB row
- saved (new) chats still generate and persist titles (regression)
- the fallback title fires with title_generation disabled and the system
  prompt never leaks into it
- throwaway test user + chats are cleaned up afterwards
"""

import json
import socketio  # python-socketio, already in the backend venv
import sqlite3
import time
import uuid

import requests

BASE = 'http://localhost:8080'
DB_PATH = '/home/ubuntu/open-webui/backend/data/webui.db'
TEST_EMAIL = 'fork-title-test@local.dev'
TEST_PASSWORD = 'fork-title-test-pw'


def setup_test_user():
    import bcrypt

    pw_hash = bcrypt.hashpw(TEST_PASSWORD.encode(), bcrypt.gensalt()).decode()
    db = sqlite3.connect(DB_PATH)
    c = db.cursor()
    uid = str(uuid.uuid4())
    now = int(time.time())
    # NOTE: auth.id must equal user.id — the login query JOINs on it.
    c.execute(
        'INSERT INTO user (id, name, email, role, profile_image_url, last_active_at,'
        ' updated_at, created_at, presence_state, settings) VALUES (?,?,?,?,?,?,?,?,?,?)',
        (uid, 'Fork Title Test', TEST_EMAIL, 'admin', '/user.png', now, now * 1000, now * 1000, 1, '{}'),
    )
    c.execute(
        'INSERT INTO auth (id, email, password, active, mfa) VALUES (?,?,?,?,?)',
        (uid, TEST_EMAIL, pw_hash, 1, '{}'),
    )
    db.commit()
    db.close()
    return uid


def cleanup_test_user(user_id):
    db = sqlite3.connect(DB_PATH)
    c = db.cursor()
    c.execute('DELETE FROM chat WHERE user_id=?', (user_id,))
    c.execute('DELETE FROM auth WHERE id=?', (user_id,))
    c.execute('DELETE FROM user WHERE id=?', (user_id,))
    db.commit()
    db.close()


def signin():
    r = requests.post(
        f'{BASE}/api/v1/auths/signin',
        json={'email': TEST_EMAIL, 'password': TEST_PASSWORD},
    )
    assert r.status_code == 200, r.text
    return r.json()['token']


def wait_for_title_event(received, timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for ev in received:
            if (ev.get('data') or {}).get('type') == 'chat:title':
                return ev['data']['data']
        time.sleep(0.5)
    return None


def run_completion(token, body):
    with requests.post(
        f'{BASE}/api/chat/completions',
        json=body,
        headers={'Authorization': f'Bearer {token}'},
        stream=True,
        timeout=300,
    ) as res:
        assert res.status_code == 200, res.text
        for _ in res.iter_lines():
            pass


def main():
    user_id = setup_test_user()
    try:
        token = signin()
        received = []
        sio = socketio.Client()

        @sio.on('events')
        def on_events(data):
            received.append(data)

        sio.connect(
            BASE,
            socketio_path='/ws/socket.io',
            transports=['websocket'],
            auth={'token': token},
            wait_timeout=10,
        )
        time.sleep(1)

        # --- 1. temporary chat: generated title event, no DB row ---
        received.clear()
        run_completion(
            token,
            {
                'stream': True,
                'model': first_model(token),
                'messages': [{'role': 'user', 'content': 'In one sentence, what is the sun?'}],
                'chat_id': 'temporary:e2e-title-test',
                'id': 'assistant-msg-t1',
                'background_tasks': {'title_generation': True},
            },
        )
        title = wait_for_title_event(received)
        assert title, 'no chat:title event for temporary chat'
        print('OK temp title event:', title)

        db = sqlite3.connect(DB_PATH)
        assert not db.execute("SELECT id FROM chat WHERE id LIKE 'temporary:%'").fetchall()
        db.close()
        print('OK no DB row for temporary chat')

        # --- 2. temporary chat, generation disabled: fallback title, no system leak ---
        received.clear()
        run_completion(
            token,
            {
                'stream': True,
                'model': first_model(token),
                'messages': [
                    {'role': 'system', 'content': 'You are a helpful assistant.'},
                    {'role': 'user', 'content': 'What is mars made of?'},
                ],
                'chat_id': 'temporary:e2e-fallback-test',
                'id': 'assistant-msg-t2',
                'background_tasks': {'title_generation': False},
            },
        )
        title = wait_for_title_event(received)
        assert title == 'What is mars made of?', f'unexpected fallback title: {title!r}'
        print('OK fallback title (no system-prompt leak):', title)

        # --- 3. saved new chat: regression — title generated and persisted ---
        received.clear()
        run_completion(
            token,
            {
                'stream': True,
                'model': first_model(token),
                'messages': [{'role': 'user', 'content': 'In one sentence, what is the moon?'}],
                'parent_id': None,
                'user_message': {
                    'id': 'user-msg-t3',
                    'role': 'user',
                    'content': 'In one sentence, what is the moon?',
                },
                'message_ids': [{'model_id': first_model(token), 'message_id': 'assistant-msg-t3'}],
                'background_tasks': {'title_generation': True},
            },
        )
        title = wait_for_title_event(received)
        assert title, 'no chat:title event for saved chat'
        time.sleep(2)
        db = sqlite3.connect(DB_PATH)
        row = db.execute(
            'SELECT title FROM chat WHERE user_id=? ORDER BY created_at DESC LIMIT 1', (user_id,)
        ).fetchone()
        db.close()
        assert row and row[0] == title, f'DB title {row!r} != event title {title!r}'
        print('OK saved chat title generated and persisted:', title)

        sio.disconnect()
        print('ALL TEMP-CHAT-TITLE TESTS PASSED')
    finally:
        cleanup_test_user(user_id)


def first_model(token):
    r = requests.get(f'{BASE}/api/models', headers={'Authorization': f'Bearer {token}'})
    models = r.json().get('data', [])
    assert models, 'no chat models configured — cannot run the test'
    return models[0]['id']


if __name__ == '__main__':
    main()
