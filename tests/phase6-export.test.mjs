/** Export module and Settings handlers executed with fake transport/DOM; no browser or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

let serial = 0;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const bundle = () => ({ format: 'finance-dashboard', schema_version: 1, exported_at: '2026-10-25T00:00:00Z', base_currency: 'USD', data: {
  transactions: [{ title: 'Export 😀', amount_usd: '999999999999.99999999', type: 'income', category: 'Synthetic', transaction_date: '2026-10-25' }],
  subscriptions: [], budget: null, preferences: { display_currency: 'EUR' },
} });

async function loadExport({ response = () => Response.json(bundle()), base = 'http://127.0.0.1:18085/api/v1' } = {}) {
  let epoch = 1;
  const calls = [];
  class SessionChangedError extends Error {}
  const key = `__export${serial++}`;
  const dependencies = { API_BASE_URL: base, getSessionEpoch: () => epoch, SessionChangedError,
    authenticatedFetch: async (...args) => { calls.push(args); return response(...args); } };
  globalThis[key] = dependencies;
  try {
    let source = await readFile(new URL('../src/api/dataExport.ts', import.meta.url), 'utf8');
    source = source.replace(/^import .*$/gm, '');
    source = `const {API_BASE_URL,getSessionEpoch,SessionChangedError,authenticatedFetch}=globalThis.${key};\n${source}`;
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const value = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    return { ...value, calls, switchAccount: () => { epoch++; }, SessionChangedError };
  } finally { delete globalThis[key]; }
}

async function withDownloadDom(run) {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL, oldTimeout = globalThis.setTimeout;
  const events = [], anchors = [], blobs = [], timers = [];
  const dom = { events, anchors, blobs, timers, failClick: false };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: tag => { assert.equal(tag, 'a'); const anchor = { href: '', download: '', click: () => { events.push('click'); if (dom.failClick) throw new Error('Synthetic DOM failure'); }, remove: () => events.push('remove') }; anchors.push(anchor); return anchor; },
    body: { appendChild: () => events.push('append') },
  } });
  URL.createObjectURL = blob => { blobs.push(blob); events.push('create-url'); return 'blob:synthetic'; };
  URL.revokeObjectURL = url => { assert.equal(url, 'blob:synthetic'); events.push('revoke'); };
  globalThis.setTimeout = (callback, delay) => { timers.push({ callback, delay }); return 0; };
  try { await run(dom); } finally {
    URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; globalThis.setTimeout = oldTimeout;
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else delete globalThis.document;
  }
}

test('export uses one authenticated GET with no owner and preserves exact downloaded bytes and USD strings', async () => {
  const text = JSON.stringify(bundle(), null, 2);
  const api = await loadExport({ response: () => new Response(text, { headers: { 'Content-Type': 'application/json' } }) });
  const controller = new AbortController();
  const value = await api.fetchAccountExport(controller.signal);
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0][0], 'http://127.0.0.1:18085/api/v1/data/export');
  assert.equal(api.calls[0][1]?.body, undefined);
  assert.ok(!api.calls[0][1]?.method || api.calls[0][1].method === 'GET');
  assert.equal(api.calls[0][1]?.signal, controller.signal);
  assert.equal(api.calls[0][1]?.cache, 'no-store');
  assert.equal(await value.blob.text(), text);
  assert.equal(value.bundle.data.transactions[0].amount_usd, '999999999999.99999999');
  assert.equal(value.bundle.base_currency, 'USD');
});

test('download ignores server filenames, clicks once and releases anchor/object URL', () => withDownloadDom(async dom => {
  const api = await loadExport({ response: () => Response.json(bundle(), { headers: { 'Content-Disposition': 'attachment; filename="../../untrusted.html"' } }) });
  await api.downloadAccountExport();
  assert.equal(dom.anchors.length, 1);
  assert.match(dom.anchors[0].download, /^finance-dashboard-v1-.*\.json$/);
  assert.ok(!dom.anchors[0].download.includes('untrusted'));
  assert.equal(dom.events.filter(event => event === 'click').length, 1);
  assert.ok(dom.events.includes('remove'));
  for (const timer of dom.timers) timer.callback();
  assert.equal(dom.events.filter(event => event === 'revoke').length, 1);
  assert.equal(await dom.blobs[0].text(), JSON.stringify(bundle()));
}));

test('account switch during body read discards export before any download', () => withDownloadDom(async dom => {
  const body = deferred();
  const api = await loadExport({ response: () => ({ ok: true, status: 200, headers: new Headers(), arrayBuffer: () => body.promise }) });
  const pending = api.downloadAccountExport();
  const rejected = assert.rejects(pending, api.SessionChangedError);
  await tick(); api.switchAccount();
  body.resolve(new TextEncoder().encode(JSON.stringify(bundle())).buffer);
  await rejected;
  assert.equal(dom.anchors.length, 0);
  assert.equal(dom.blobs.length, 0);
}));

test('abort during body read prevents a stale download', () => withDownloadDom(async dom => {
  const body = deferred(), controller = new AbortController();
  const api = await loadExport({ response: () => ({ ok: true, status: 200, headers: new Headers(), arrayBuffer: () => body.promise }) });
  const pending = api.downloadAccountExport(controller.signal);
  const rejected = assert.rejects(pending, error => error.name === 'AbortError');
  await tick(); controller.abort();
  body.resolve(new TextEncoder().encode(JSON.stringify(bundle())).buffer);
  await rejected;
  assert.equal(dom.anchors.length, 0);
}));

for (const [name, response] of [
  ['network error', () => { throw new TypeError('offline'); }],
  ['server limit', () => Response.json({ detail: 'Export exceeds limits' }, { status: 413 })],
  ['unreadable JSON', () => new Response('{invalid')],
  ['wrong envelope', () => Response.json({ ...bundle(), format: 'unknown' })],
]) {
  test(`${name} does not start a download or replay transport`, () => withDownloadDom(async dom => {
    const api = await loadExport({ response });
    await assert.rejects(api.downloadAccountExport());
    assert.equal(api.calls.length, 1);
    assert.equal(dom.anchors.length, 0);
  }));
}

test('DOM click failure still removes anchor and revokes object URL', () => withDownloadDom(async dom => {
  dom.failClick = true;
  const api = await loadExport();
  await assert.rejects(api.downloadAccountExport());
  assert.ok(dom.events.includes('remove'));
  assert.ok(dom.events.includes('revoke'));
}));

test('non-loopback API is rejected before authenticated transport', async () => {
  const api = await loadExport({ base: 'https://unapproved.example/api/v1' });
  await assert.rejects(api.fetchAccountExport());
  assert.equal(api.calls.length, 0);
});

async function settingsHarness() {
  const slots = [], cleanups = [], calls = [];
  let cursor = 0, mounted = true, staleStateWrites = 0;
  const key = `__settings${serial++}`;
  const pending = deferred();
  const dependencies = {
    useState: initial => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { if (!mounted) staleStateWrites++; slots[index] = value; }]; },
    useRef: initial => { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect: callback => { const index = cursor++; if (!(index in slots)) { slots[index] = true; cleanups.push(callback()); } },
    downloadAccountExport: signal => { calls.push(signal); return pending.promise; },
    useSettings: () => ({ currency: 'EUR', setCurrency: () => {}, preferenceError: '', preferenceLoading: false, refresh: () => {} }),
    CURRENCY_SYMBOLS: { USD: '$', EUR: '€' }, ResourceStatus: () => null,
    __jsx: (type, props, ...children) => typeof type === 'function' ? type(props || {}) : { type, props: props || {}, children: children.flat(Infinity).filter(child => child !== false && child != null) },
  };
  globalThis[key] = dependencies;
  const load = async path => {
    let source = await readFile(new URL(path, import.meta.url), 'utf8');
    const icons = source.match(/import \{([^}]+)\} from ["']lucide-react["'];?/)[1].split(',').map(name => name.trim());
    source = source.replace(/^import .*$/gm, '');
    source = `const {useState,useRef,useEffect,downloadAccountExport,useSettings,CURRENCY_SYMBOLS,ResourceStatus,DangerZone,__jsx}=globalThis.${key};\n${icons.map(name => `const ${name}=${JSON.stringify(name)};`).join('\n')}\n${source}`;
    // DangerZone defines its own name, so remove the unused binding from its wrapper.
    if (path.includes('DangerZone')) source = source.replace('ResourceStatus,DangerZone,__jsx', 'ResourceStatus,__jsx');
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, jsxFactory: '__jsx' } }).outputText;
    return (await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)).default;
  };
  try {
    dependencies.DangerZone = await load('../src/features/settings/DangerZone.tsx');
    const Settings = await load('../src/pages/SettingsPage.tsx');
    const nodes = () => {
      cursor = 0; const result = [];
      function visit(node) { if (node && typeof node === 'object') { result.push(node); node.children?.forEach(visit); } }
      visit(Settings({})); return result;
    };
    const text = node => node.children.map(child => typeof child === 'string' ? child : child && typeof child === 'object' ? text(child) : '').join('');
    const button = label => { const found = nodes().filter(node => node.type === 'button' && text(node).trim() === label); assert.equal(found.length, 1); return found[0]; };
    return { nodes, button, calls, pending, staleWrites: () => staleStateWrites, unmount: () => { mounted = false; cleanups.forEach(cleanup => cleanup?.()); } };
  } finally { delete globalThis[key]; }
}

test('Settings starts one export, exposes success and leaves import/reset disabled', async () => {
  const view = await settingsHarness();
  assert.equal(view.button('Import Backup').props.disabled, true);
  assert.equal(view.button('Reset All Data').props.disabled, true);
  const start = view.button('Export Backup');
  assert.equal(start.props.type, 'button');
  const pending = start.props.onClick();
  assert.equal(view.button('Preparing export…').props.disabled, true);
  assert.equal(view.button('Preparing export…').props['aria-busy'], true);
  await start.props.onClick(); // Even an old handler cannot issue a second request.
  assert.equal(view.calls.length, 1);
  view.pending.resolve(); await pending;
  assert.equal(view.button('Export Backup').props.disabled, false);
  assert.ok(view.nodes().some(node => node.props.role === 'status' && node.children.includes('Download started. Check your browser downloads.')));
  view.unmount();
});

test('Settings failure is visible and does not report successful download', async () => {
  const view = await settingsHarness();
  const pending = view.button('Export Backup').props.onClick();
  view.pending.reject(new Error('Synthetic export unavailable')); await pending;
  assert.ok(view.nodes().some(node => node.props.role === 'alert' && node.children.includes('Synthetic export unavailable')));
  assert.ok(!view.nodes().some(node => node.children.includes('Download started. Check your browser downloads.')));
  assert.equal(view.button('Export Backup').props.disabled, false);
  view.unmount();
});

test('Settings cancel aborts transport and ignores its late success', async () => {
  const view = await settingsHarness();
  const pending = view.button('Export Backup').props.onClick();
  view.button('Cancel export').props.onClick();
  assert.equal(view.calls[0].aborted, true);
  view.pending.resolve(); await pending;
  assert.ok(view.nodes().some(node => node.children.includes('Export canceled.')));
  assert.ok(!view.nodes().some(node => node.children.includes('Download started. Check your browser downloads.')));
  view.unmount();
});

test('Settings unmount aborts request and prevents all late state writes', async () => {
  const view = await settingsHarness();
  const pending = view.button('Export Backup').props.onClick();
  view.unmount();
  assert.equal(view.calls[0].aborted, true);
  view.pending.resolve(); await pending;
  assert.equal(view.staleWrites(), 0);
});

for (const [name, mutate] of [
  ['transaction record limit', value => { value.data.transactions = Array(10001).fill(value.data.transactions[0]); }],
  ['subscription record limit', value => { value.data.subscriptions = Array(1001).fill({}); }],
  ['serialized byte limit', value => { value.data.transactions[0].title = '😀'.repeat(2 * 1024 * 1024); }],
]) {
  test(`client ${name} prevents download without truncation`, () => withDownloadDom(async dom => {
    const value = bundle(); mutate(value);
    const api = await loadExport({ response: () => Response.json(value) });
    await assert.rejects(api.downloadAccountExport());
    assert.equal(dom.anchors.length, 0);
  }));
}

test('account change after URL allocation still prevents click and cleans resources', () => withDownloadDom(async dom => {
  const api = await loadExport();
  const create = URL.createObjectURL;
  URL.createObjectURL = blob => { const url = create(blob); api.switchAccount(); return url; };
  await assert.rejects(api.downloadAccountExport(), api.SessionChangedError);
  assert.ok(!dom.events.includes('click'));
  assert.ok(dom.events.includes('remove') && dom.events.includes('revoke'));
}));

test('already aborted export never reaches authenticated transport', async () => {
  const api = await loadExport(), controller = new AbortController();
  controller.abort();
  await assert.rejects(api.fetchAccountExport(controller.signal), error => error.name === 'AbortError');
  assert.equal(api.calls.length, 0);
});
