import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { type Middleman, createMiddleman } from '../../src/main/helper/middleman.js';

let mm: Middleman;
let port: number;

/** POST JSON to the middleman with an optional bearer token. */
async function post(
  route: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

beforeEach(async () => {
  mm = createMiddleman();
  port = await mm.listen();
});

afterEach(async () => {
  await mm.close();
});

test('listen is idempotent and reports the bound port', async () => {
  const again = await mm.listen();
  assert.equal(again, port);
  assert.equal(mm.port(), port);
});

test('a registered session routes started + result to its callbacks', async () => {
  const started: number[] = [];
  const answers: string[] = [];
  mm.register({
    sessionId: 's1',
    token: 'tok',
    onStarted: () => started.push(1),
    onResult: (a) => answers.push(a),
  });

  const r1 = await post('/session/started', { sessionId: 's1' }, 'tok');
  assert.equal(r1.status, 200);
  assert.deepEqual(started, [1]);

  const r2 = await post('/session/result', { sessionId: 's1', answer: 'hello' }, 'tok');
  assert.equal(r2.status, 200);
  assert.deepEqual(answers, ['hello']);
});

test('a missing answer resolves to empty string', async () => {
  const answers: string[] = [];
  mm.register({
    sessionId: 's1',
    token: 'tok',
    onStarted: () => {},
    onResult: (a) => answers.push(a),
  });
  await post('/session/result', { sessionId: 's1' }, 'tok');
  assert.deepEqual(answers, ['']);
});

test('a wrong token is rejected 401 and the callback never fires', async () => {
  let fired = false;
  mm.register({
    sessionId: 's1',
    token: 'tok',
    onStarted: () => {},
    onResult: () => {
      fired = true;
    },
  });
  const r = await post('/session/result', { sessionId: 's1', answer: 'x' }, 'wrong');
  assert.equal(r.status, 401);
  assert.equal(fired, false);
});

test('an absent token is rejected 401 and the callback never fires', async () => {
  let fired = false;
  mm.register({
    sessionId: 's1',
    token: 'tok',
    onStarted: () => {},
    onResult: () => {
      fired = true;
    },
  });
  // No bearer header at all (token left undefined) — a stray local process that
  // found the port but never had the per-session token.
  const r = await post('/session/result', { sessionId: 's1', answer: 'x' });
  assert.equal(r.status, 401);
  assert.equal(fired, false);
});

test('an unknown session is 404', async () => {
  const r = await post('/session/result', { sessionId: 'ghost', answer: 'x' }, 'tok');
  assert.equal(r.status, 404);
});

test('a non-POST method is 405', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/session/result`, { method: 'GET' });
  assert.equal(res.status, 405);
});

test('an oversized body is refused and never routes to a callback', async () => {
  let fired = false;
  mm.register({
    sessionId: 's1',
    token: 'tok',
    onStarted: () => {},
    onResult: () => {
      fired = true;
    },
  });
  // Over the 1 MB readBody cap — the server destroys the request before it can
  // route, so the fetch may reject; either way no payload reaches the callback.
  const huge = 'x'.repeat(1_100_000);
  try {
    await post('/session/result', { sessionId: 's1', answer: huge }, 'tok');
  } catch {
    // Connection destroyed when the cap tripped — that is the refusal.
  }
  assert.equal(fired, false);
});

test('a malformed body is 400', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/session/started`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
    body: 'not json',
  });
  assert.equal(res.status, 400);
});

test('an unknown route is 404', async () => {
  const r = await post('/nope', { sessionId: 's1' }, 'tok');
  assert.equal(r.status, 404);
});

test('an unregistered session (after unregister) is 404', async () => {
  mm.register({ sessionId: 's1', token: 'tok', onStarted: () => {}, onResult: () => {} });
  mm.unregister('s1');
  const r = await post('/session/started', { sessionId: 's1' }, 'tok');
  assert.equal(r.status, 404);
});
