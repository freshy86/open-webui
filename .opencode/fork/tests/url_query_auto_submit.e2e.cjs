/**
 * End-to-end regression test for the ?q= URL auto-submit fork feature.
 *
 * Requires BOTH dev servers running (backend :8080, frontend :5173) and at
 * least one chat model configured. Playwright is NOT a repo dependency —
 * install it ad-hoc, e.g.:
 *
 *   cd /tmp && npm init -y && npm i playwright && npx playwright install chromium
 *   node /home/ubuntu/open-webui/.opencode/fork/tests/url_query_auto_submit.test.js
 *
 * Covers (see ../features/url-query-auto-submit.md):
 * - /?temporary-chat=true&q=... sends immediately, strips q from the URL,
 *   shows the interim query as tab title, then the generated title
 * - New Chat afterwards does not resubmit the query
 * - /?q=... sends in a saved chat and lands on /c/<id>
 */

const { chromium } = require('playwright');

const BASE = 'http://localhost:5173';
const API = 'http://localhost:8080';
const Q = 'What is the sun? One word answer.';

(async () => {
  const signin = await fetch(`${API}/api/v1/auths/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD }),
  });
  const { token } = await signin.json();
  if (!token) throw new Error('signin failed — set TEST_EMAIL/TEST_PASSWORD of a test user');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE + '/auth');
  await page.evaluate((t) => localStorage.setItem('token', t), token);

  const dismissModals = async () => {
    // Fresh users get the "What's New" changelog modal; close it if present.
    for (let i = 0; i < 3; i++) {
      if ((await page.locator('div[role="dialog"]').count()) === 0) return;
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
    }
  };

  // --- 1. temporary chat auto-submits ?q= ---
  await page.goto(`${BASE}/?temporary-chat=true&q=${encodeURIComponent(Q)}`);
  await dismissModals();
  await page.waitForSelector(`text=${Q}`, { timeout: 30000 });
  console.log('OK user message auto-submitted (temp chat)');

  // Read location.href directly — Playwright's page.url() can lag behind
  // same-document history.replaceState updates.
  const url = await page.evaluate(() => location.href);
  if (url.includes('q=')) throw new Error('q param still in URL: ' + url);
  console.log('OK q stripped from URL:', url);

  const interim = await page.title();
  if (!interim.startsWith('What is the sun')) throw new Error('unexpected interim title: ' + interim);
  console.log('OK interim tab title:', JSON.stringify(interim));

  await page.waitForFunction(() => !document.title.startsWith('What is the sun'), null, {
    timeout: 120000,
  });
  console.log('OK generated tab title:', await page.title());

  // --- 2. New Chat afterwards must NOT resubmit the query ---
  // Count real completion POSTs — text presence is ambiguous (a restored draft
  // in the input or the old bubble can still contain the query).
  await dismissModals();
  let completionsAfter = 0;
  const onReq = (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/chat/completions')) completionsAfter++;
  };
  page.on('request', onReq);
  await page
    .locator('#sidebar-new-chat-button:visible')
    .first()
    .evaluate((el) => el.click());
  await page.waitForTimeout(5000);
  page.off('request', onReq);
  if (completionsAfter > 0)
    throw new Error(`query was resubmitted after New Chat (${completionsAfter} completion POSTs)`);
  console.log('OK no resubmission after New Chat; title =', await page.title());

  // --- 3. saved (non-temp) chat auto-submits and lands on /c/<id> ---
  await page.goto(`${BASE}/?q=${encodeURIComponent(Q)}`);
  await dismissModals();
  await page.waitForSelector(`text=${Q}`, { timeout: 30000 });
  await page.waitForURL(/\/c\/[0-9a-f-]{36}/, { timeout: 30000 });
  console.log('OK saved chat auto-submitted, URL =', page.url());

  // The final title comes from the backend (fallback or LLM-generated — the
  // task model is a reasoning model and may exhaust its budget, in which case
  // the documented fallback title fires). Only assert it left the site name.
  await page.waitForFunction((name) => document.title !== name, 'Open WebUI', {
    timeout: 120000,
  });
  console.log('OK tab title updated =', await page.title());

  if (errors.length) {
    console.log('PAGE ERRORS:', errors);
    throw new Error('page errors detected');
  }

  await browser.close();
  console.log('ALL URL-AUTO-SUBMIT TESTS PASSED');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
