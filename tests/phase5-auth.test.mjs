/** Executes the actual auth session module with controlled HTTP timing, no browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

let moduleId = 0;
async function session() {
  const source = await readFile(new URL('../src/api/authSession.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const value = await import(`data:text/javascript;base64,${Buffer.from(code + `\n// isolated test ${moduleId++}`).toString('base64')}`);
  value.configureAuthApi('http://127.0.0.1:18085/api/v1');
  return value;
}
const userA = { id: 'user-A', email: 'a@example.test' };
const userB = { id: 'user-B', email: 'b@example.test' };
const token = (user = userA, access = 'test-access-A') => Response.json({ user, access_token: access, token_type: 'bearer', expires_in: 300 });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function withFetch(run) { const previous = globalThis.fetch; try { await run(); } finally { globalThis.fetch = previous; } }

test('restoration shares one refresh, sends CSRF+cookie credentials and keeps auth in memory', () => withFetch(async () => {
  const auth = await session();
  const pending = deferred();
  const calls = [];
  globalThis.fetch = (url, options) => { calls.push({ url, options }); return pending.promise; };
  const first = auth.restoreSession();
  const second = auth.restoreSession();
  assert.equal(first, second);
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal(calls[0].options.headers['X-CSRF-Protection'], '1');
  assert.equal(calls[0].url, 'http://127.0.0.1:18085/api/v1/auth/refresh');
  pending.resolve(token());
  assert.deepEqual(await first, userA);
  assert.equal(auth.getAuthSnapshot().status, 'authenticated');
  assert.equal('access_token' in auth.getAuthSnapshot(), false);
  const source = await readFile(new URL('../src/api/authSession.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
}));

test('concurrent 401 responses share refresh and retry once with the new bearer', () => withFetch(async () => {
  const auth = await session();
  globalThis.fetch = async () => token();
  await auth.login('a@example.test', 'synthetic-password');
  const calls = [], counts = new Map();
  let refreshes = 0;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/auth/refresh')) { refreshes++; return token(userA, 'rotated-access'); }
    calls.push({ url, options });
    counts.set(url, (counts.get(url) || 0) + 1);
    return counts.get(url) === 1 ? new Response(null, { status: 401 }) : Response.json({ ok: true });
  };
  const body = JSON.stringify({ amount_usd: '0.00000001' });
  const results = await Promise.all([auth.authenticatedFetch('http://127.0.0.1:18085/api/v1/transactions', { method: 'POST', body }), auth.authenticatedFetch('http://127.0.0.1:18085/api/v1/dashboard')]);
  assert.ok(results.every(response => response.status === 200));
  assert.equal(refreshes, 1);
  assert.equal(calls.length, 4);
  for (const call of calls) assert.equal(call.options.credentials, 'omit');
  assert.equal(calls.filter(call => call.options.headers.get('Authorization') === 'Bearer rotated-access').length, 2);
  assert.ok(calls.filter(call => call.url.endsWith('/transactions')).every(call => call.options.body === body));
}));

test('unknown write network outcome is never automatically replayed', () => withFetch(async () => {
  const auth = await session();
  globalThis.fetch = async () => token();
  await auth.login('a@example.test', 'synthetic-password');
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError('connection lost after send'); };
  await assert.rejects(auth.authenticatedFetch('http://127.0.0.1:18085/api/v1/transactions', { method: 'POST', body: '{}' }), TypeError);
  assert.equal(calls, 1);
}));

test('logout queues after an in-flight refresh and stale restoration cannot restore the session', () => withFetch(async () => {
  const auth = await session();
  globalThis.fetch = async () => token();
  await auth.login('a@example.test', 'synthetic-password');
  const pending = deferred(), calls = [];
  globalThis.fetch = (url) => { calls.push(url); return url.endsWith('/refresh') ? pending.promise : Promise.resolve(new Response(null, { status: 204 })); };
  const restoration = auth.restoreSession();
  const rejectedRestore = assert.rejects(restoration, auth.SessionChangedError);
  await tick();
  const logout = auth.logout();
  await tick();
  assert.equal(auth.getAuthSnapshot().user, null);
  assert.equal(auth.getAuthSnapshot().status, 'signing-out');
  assert.equal(calls.length, 1, 'Cookie operations must stay serialized until refresh settles');
  pending.resolve(token());
  await rejectedRestore;
  await logout;
  assert.equal(calls.length, 2);
  assert.equal(calls[1].endsWith('/logout'), true);
  assert.equal(auth.getAuthSnapshot().status, 'anonymous');
  assert.equal(auth.getAuthSnapshot().user, null);
}));

test('switching accounts discards old GETs and never retries an old write as the new account', () => withFetch(async () => {
  const auth = await session();
  globalThis.fetch = async () => token();
  await auth.login('a@example.test', 'synthetic-password');
  const oldGet = deferred(), oldWrite = deferred();
  let financialCalls = 0;
  globalThis.fetch = (url) => {
    if (url.endsWith('/auth/login')) return Promise.resolve(token(userB, 'access-B'));
    financialCalls++;
    return url.endsWith('/dashboard') ? oldGet.promise : oldWrite.promise;
  };
  const get = auth.authenticatedFetch('http://127.0.0.1:18085/api/v1/dashboard');
  const write = auth.authenticatedFetch('http://127.0.0.1:18085/api/v1/transactions', { method: 'POST', body: '{}' });
  const getRejected = assert.rejects(get, auth.SessionChangedError);
  const writeRejected = assert.rejects(write, auth.SessionChangedError);
  await auth.login('b@example.test', 'synthetic-password');
  oldGet.resolve(Response.json({ private: 'A' }));
  oldWrite.resolve(new Response(null, { status: 401 }));
  await Promise.all([getRejected, writeRejected]);
  assert.deepEqual(auth.getAuthSnapshot().user, userB);
  assert.equal(financialCalls, 2);
}));

test('failed server logout keeps local data cleared and blocks account switching until confirmed', () => withFetch(async () => {
  const auth = await session();
  globalThis.fetch = async () => token();
  await auth.login('a@example.test', 'synthetic-password');
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(auth.logout(), /Cannot reach/);
  assert.equal(auth.getAuthSnapshot().user, null);
  assert.equal(auth.getAuthSnapshot().status, 'logout-error');
  await assert.rejects(auth.login('b@example.test', 'synthetic-password'), /Finish signing out/);
  globalThis.fetch = async () => new Response(null, { status: 204 });
  await auth.logout();
  assert.equal(auth.getAuthSnapshot().status, 'anonymous');
}));
