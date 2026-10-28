/** Executes the actual auth session module with controlled HTTP timing, no browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

let moduleId = 0;
async function session() {
  const source = (await readFile(new URL('../src/api/authSession.ts', import.meta.url), 'utf8')).replace("'./apiConfig'", JSON.stringify(new URL('../src/api/apiConfig.ts', import.meta.url).href));
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

/** Executes AuthPage render/handlers; does not emulate native browser validation. */
async function authPage(registering, options = {}) {
  const slots = [];
  let cursor = 0;
  const calls = [], navigations = [];
  const key = `__authPageHarness${moduleId++}`;
  const hooks = {
    useState: initial => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef: initial => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useAuth: () => ({ error: options.authError || '', register: options.register || (async (...args) => { calls.push({ method: 'register', args }); }), login: options.login || (async (...args) => { calls.push({ method: 'login', args }); }) }),
    useNavigate: () => (to, settings) => navigations.push({ to, settings }),
    useLocation: () => ({ state: options.locationState || null }),
    __jsx: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(child => child !== false && child != null) }),
  };
  globalThis[key] = hooks;
  try {
    let source = await readFile(new URL('../src/pages/AuthPage.tsx', import.meta.url), 'utf8');
    const icons = source.match(/import \{([^}]+)\} from 'lucide-react';/)[1].split(',').map(name => name.trim());
    source = source.replace(/^import .*$/gm, '');
    source = `const AveroBrand='brand'; const useTheme=()=>{};\nconst {useState,useRef,useAuth,useNavigate,useLocation,__jsx}=globalThis.${key};\n${icons.map(name => `const ${name}=${JSON.stringify(name)};`).join('\n')}\n${source}`;
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, jsxFactory: '__jsx' } }).outputText;
    const { default: Page } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    const render = () => { cursor = 0; return Page({ registering }); };
    const nodes = () => {
      const result = [];
      function visit(node, parent) {
        if (!node || typeof node !== 'object') return;
        const record = { ...node, parent };
        result.push(record);
        node.children.forEach(child => visit(child, record));
      }
      visit(render(), null);
      return result;
    };
    const find = (type, predicate = () => true) => {
      const found = nodes().filter(node => node.type === type && predicate(node.props));
      assert.equal(found.length, 1, `Expected one ${type} matching requested props`);
      return found[0];
    };
    return {
      calls, navigations, nodes, find,
      input: label => find('input', props => props['aria-label'] === label),
      button: name => find('button', props => props['aria-label'] === name),
      change: (label, value) => find('input', props => props['aria-label'] === label).props.onChange({ target: { value } }),
      submit: () => find('form').props.onSubmit({ preventDefault() {} }),
    };
  } finally { delete globalThis[key]; }
}

test('login password starts hidden, toggles reversibly and preserves typed values without submitting', async () => {
  const page = await authPage(false);
  page.change('Password', 'synthetic-value');
  assert.equal(page.input('Password').props.type, 'password');
  assert.equal(page.nodes().filter(node => node.type === 'input' && node.props['aria-label'] === 'Confirm password').length, 0);
  assert.equal(page.button('Show password').props['aria-pressed'], false);
  page.button('Show password').props.onClick();
  assert.equal(page.input('Password').props.type, 'text');
  assert.equal(page.input('Password').props.value, 'synthetic-value');
  assert.equal(page.button('Hide password').props['aria-pressed'], true);
  page.button('Hide password').props.onClick();
  assert.equal(page.input('Password').props.type, 'password');
  assert.equal(page.input('Password').props.value, 'synthetic-value');
  assert.equal(page.calls.length, 0);
});

test('registration password and confirmation visibility are independent and accessible', async () => {
  const page = await authPage(true);
  page.change('Password', 'synthetic-password');
  page.change('Confirm password', 'independent-confirmation');
  for (const [label, button] of [['Password', 'Show password'], ['Confirm password', 'Show password confirmation']]) {
    const input = page.input(label), control = page.button(button);
    assert.equal(input.props.type, 'password');
    assert.equal(control.props.type, 'button');
    assert.equal(control.props['aria-controls'], input.props.id);
    assert.equal(control.props['aria-pressed'], false);
    assert.ok(page.nodes().some(node => node.type === 'label' && node.props.htmlFor === input.props.id));
    let parent = control.parent;
    while (parent) {
      assert.notEqual(parent.type, 'label', 'Visibility button must not be nested inside an input label');
      parent = parent.parent;
    }
    assert.ok(control.children.some(icon => [true, 'true'].includes(icon.props?.['aria-hidden'])));
  }
  page.button('Show password').props.onClick();
  assert.equal(page.input('Password').props.type, 'text');
  assert.equal(page.input('Confirm password').props.type, 'password');
  page.button('Show password confirmation').props.onClick();
  page.button('Hide password').props.onClick();
  assert.equal(page.input('Password').props.type, 'password');
  assert.equal(page.input('Confirm password').props.type, 'text');
  assert.equal(page.input('Password').props.value, 'synthetic-password');
  assert.equal(page.input('Confirm password').props.value, 'independent-confirmation');
  assert.equal(page.calls.length, 0);
});

test('registration declares native eight-character boundary and submits matching eight-character password unchanged', async () => {
  const page = await authPage(true);
  for (const label of ['Password', 'Confirm password']) {
    const input = page.input(label).props;
    assert.equal(input.minLength, 8);
    assert.equal(input.maxLength, 128);
    assert.equal(input.required, true);
    assert.equal(input.autoComplete, 'new-password');
    // Native constraint validation uses these props; it is not executed in this source harness.
    assert.ok('1234567'.length < input.minLength && '12345678'.length >= input.minLength);
  }
  page.change('Email address', ' synthetic@example.test ');
  page.change('Password', ' eight!!');
  page.change('Confirm password', ' eight!!');
  await page.submit();
  assert.deepEqual(page.calls, [{ method: 'register', args: ['synthetic@example.test', ' eight!!'] }]);
  assert.equal(page.input('Password').props.value, '');
  assert.equal(page.input('Confirm password').props.value, '');
  const login = await authPage(false);
  assert.equal(login.input('Password').props.minLength, undefined);
  assert.equal(login.input('Password').props.autoComplete, 'current-password');
});

test('mismatched registration confirmation never reaches auth and retains entered values', async () => {
  const page = await authPage(true);
  page.change('Password', '12345678');
  page.change('Confirm password', '87654321');
  await page.submit();
  assert.equal(page.calls.length, 0);
  assert.equal(page.input('Password').props.value, '12345678');
  assert.equal(page.input('Confirm password').props.value, '87654321');
  const alert = page.nodes().find(node => node.props.role === 'alert');
  assert.ok(alert.children.includes('Passwords do not match.'));
});

for (const [name, short, valid] of [['ASCII', '1234567', '12345678'], ['Unicode code points', '😀'.repeat(7), '😀'.repeat(8)]]) {
  test(`registration rejects seven and accepts eight ${name} before transport`, async () => {
    const page = await authPage(true);
    page.change('Email address', 'synthetic@example.test');
    page.change('Password', short);
    page.change('Confirm password', short);
    await page.submit();
    assert.equal(page.calls.length, 0);
    assert.ok(page.nodes().find(node => node.props.role === 'alert').children.includes('Password must contain at least 8 characters.'));
    assert.equal(page.input('Password').props.value, short);
    page.change('Password', valid);
    page.change('Confirm password', valid);
    await page.submit();
    assert.deepEqual(page.calls, [{ method: 'register', args: ['synthetic@example.test', valid] }]);
  });
}


test('auth form switching preserves the original redirect state in both directions', async () => {
  const locationState = { from: '/transactions?type=income' };
  for (const registering of [false, true]) {
    const page = await authPage(registering, { locationState });
    const label = registering ? 'Sign in' : 'Create an account';
    const button = page.nodes().find(node => node.type === 'button' && node.children.includes(label));
    button.props.onClick();
    assert.deepEqual(page.navigations, [{ to: registering ? '/login' : '/register', settings: { state: locationState } }]);
  }
});

test('auth failures remain visible and preserve form input after the layout redesign', async () => {
  const page = await authPage(false, { login: async () => { throw new Error('Synthetic sign-in error'); } });
  page.change('Email address', 'synthetic@example.test'); page.change('Password', 'synthetic-password');
  await page.submit();
  assert.ok(page.nodes().some(node => node.props.role === 'alert' && node.children.includes('Synthetic sign-in error')));
  assert.equal(page.input('Email address').props.value, 'synthetic@example.test');
  assert.equal(page.input('Password').props.value, 'synthetic-password');
  const restored = await authPage(false, { authError: 'Synthetic session error' });
  assert.ok(restored.nodes().some(node => node.props.role === 'alert' && node.children.includes('Synthetic session error')));
});

test('pending authentication disables submission and page switching, then clears passwords only on success', async () => {
  const pending = deferred();
  const page = await authPage(true, { register: () => pending.promise });
  page.change('Email address', 'synthetic@example.test'); page.change('Password', 'synthetic-password'); page.change('Confirm password', 'synthetic-password');
  const saving = page.submit();
  assert.equal(page.find('button', props => props.type === 'submit').props.disabled, true);
  assert.equal(page.nodes().find(node => node.type === 'button' && node.children.includes('Sign in')).props.disabled, true);
  assert.equal(page.input('Password').props.value, 'synthetic-password');
  pending.resolve(userA); await saving;
  assert.equal(page.input('Password').props.value, ''); assert.equal(page.input('Confirm password').props.value, '');
  assert.equal(page.find('button', props => props.type === 'submit').props.disabled, false);
});
