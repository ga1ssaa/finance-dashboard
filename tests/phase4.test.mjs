import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { units, signedUnits, decimal, normalizeMoneyInput, toUSD, fromUSD } from '../src/utils/money.ts';

async function moduleFrom(path, replace = value => value) {
  const source = replace(await readFile(new URL(path, import.meta.url), 'utf8'));
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}
// Isolate transport contracts from authentication; actual auth behavior is tested separately.
const client = await moduleFrom('../src/api/client.ts', source => source
  .replace(/^import .*from '.\/authSession';$/m, 'const authenticatedFetch=(...args)=>fetch(...args); const configureAuthApi=()=>{}; const getSessionEpoch=()=>0; class SessionChangedError extends Error {} class SessionExpiredError extends Error {}')
  .replace('import.meta.env.VITE_API_BASE_URL', '"http://127.0.0.1:18084/api/v1"'));

test('money preserves canonical precision and aggregate range', () => {
  assert.equal(decimal(units('999999999999.99999999')), '999999999999.99999999');
  assert.equal(decimal(units('0.00000001')), '0.00000001');
  assert.equal(decimal(signedUnits('-1999999999999.99999999')), '-1999999999999.99999999');
  assert.equal(normalizeMoneyInput('001.2'), '1.20000000');
  assert.throws(() => normalizeMoneyInput('0', true));
  for (const value of [1, '1e2', 'NaN', 'Infinity', '-1', '1.000000001', '1000000000000', '1.', '.1', '']) assert.throws(() => units(value));
});

test('currency edit conversion is exact and rejects precision loss', () => {
  assert.equal(toUSD('475', '475'), '1.00000000');
  assert.equal(toUSD('0.92', '0.92'), '1.00000000');
  assert.equal(fromUSD('0.00000001', '0.92'), '0.0000000092');
  assert.equal(fromUSD('999999999999.99999999', '475'), '474999999999999.99999525');
  for (const [value, rate] of [['1', '475'], ['1', '0'], ['1', '-1'], ['1', '1e2'], ['999999999999', '0.00000001']]) assert.throws(() => toUSD(value, rate));
});

test('recent transaction filters and sorting are sent before the server page limit', async () => {
  const { recentQuery } = await moduleFrom('../src/hooks/useTransactions.ts', source => source.replace(/^import .*$/gm, ''));
  const filtered = new URLSearchParams(recentQuery('all', 'income', 'amount-desc'));
  assert.equal(filtered.get('type'), 'income');
  assert.equal(filtered.get('sort_by'), 'amount_usd');
  assert.equal(filtered.get('sort_direction'), 'desc');
  assert.equal(filtered.get('limit'), '10');
  const dated = new URLSearchParams(recentQuery('today', 'all', 'date-asc'));
  assert.equal(dated.has('type'), false);
  assert.equal(dated.get('sort_by'), 'transaction_date');
  assert.equal(dated.get('sort_direction'), 'asc');
  assert.match(dated.get('date_from'), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(dated.get('date_from'), dated.get('date_to'));
});

test('HTTP client preserves JSON monetary strings, headers and DELETE204', async () => {
  const saved = globalThis.fetch;
  try {
    let seen;
    globalThis.fetch = async (url, options) => { seen = { url, options }; return Response.json({ amount_usd: '999999999999.99999999' }); };
    const body = JSON.stringify({ amount_usd: '999999999999.99999999' });
    assert.equal((await client.request('/transactions', { method: 'POST', body })).amount_usd, '999999999999.99999999');
    assert.equal(seen.url, 'http://127.0.0.1:18084/api/v1/transactions');
    assert.equal(seen.options.body, body);
    assert.equal(seen.options.headers['Content-Type'], 'application/json');
    globalThis.fetch = async () => new Response(null, { status: 204 });
    assert.equal(await client.request('/transactions/id', { method: 'DELETE' }), undefined);
  } finally { globalThis.fetch = saved; }
});

test('HTTP client exposes validation errors and distinguishes uncertain writes', async () => {
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ detail: [{ msg: 'Amount invalid' }, { msg: 'Date invalid' }] }, { status: 422 });
    await assert.rejects(client.request('/transactions', { method: 'POST' }), /Amount invalid; Date invalid/);
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    await assert.rejects(client.request('/transactions'), /Cannot reach/);
    await assert.rejects(client.request('/transactions', { method: 'POST' }), client.UnknownWriteOutcomeError);
    globalThis.fetch = async () => new Response('invalid JSON', { status: 201 });
    await assert.rejects(client.request('/transactions', { method: 'POST' }), client.UnknownWriteOutcomeError);
    globalThis.fetch = async () => { throw new DOMException('aborted', 'AbortError'); };
    await assert.rejects(client.request('/transactions'), error => error.name === 'AbortError');
  } finally { globalThis.fetch = saved; }
});

test('resource hook ignores old responses, clears stale data and retries after errors', async () => {
  let state, effect, previousDeps, cleanup, revision = 0;
  const requests = [];
  globalThis.__phase4Hooks = {
    useState: initial => { if (state === undefined) state = initial; return [state, value => { state = value; }]; },
    useEffect: (callback, dependencies) => { if (!previousDeps || dependencies.some((value, index) => value !== previousDeps[index])) { effect = callback; previousDeps = dependencies; } },
    useFinance: () => ({ revision, refresh: () => { revision += 1; } }),
    request: (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject })),
  };
  const hook = await moduleFrom('../src/hooks/useResource.ts', source => source
    .replace(/import \{ useEffect, useState \} from 'react';/, 'const {useEffect,useState} = globalThis.__phase4Hooks;')
    .replace(/import \{ request \} from '..\/api\/client';/, 'const {request} = globalThis.__phase4Hooks;')
    .replace(/import \{ useFinance \} from '..\/state\/financeStore';/, 'const {useFinance} = globalThis.__phase4Hooks;'));
  function render(path) {
    effect = null;
    const result = hook.useResource(path);
    if (effect) { cleanup?.(); cleanup = effect(); }
    return result;
  }
  const settle = () => new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(render('/transactions?q=old').loading, true);
    assert.equal(render('/transactions?q=new').data, null);
    assert.equal(requests[0].options.signal.aborted, true);
    requests[1].resolve({ items: ['new'] }); await settle();
    requests[0].resolve({ items: ['old'] }); await settle();
    assert.deepEqual(render('/transactions?q=new').data, { items: ['new'] });
    render('/transactions?q=new').retry();
    assert.equal(render('/transactions?q=new').data, null);
    requests[2].reject(new Error('Unavailable')); await settle();
    assert.equal(render('/transactions?q=new').error, 'Unavailable');
    render('/transactions?q=new').retry();
    assert.equal(render('/transactions?q=new').error, '');
    requests[3].resolve({ items: ['recovered'] }); await settle();
    assert.deepEqual(render('/transactions?q=new').data, { items: ['recovered'] });
  } finally { cleanup?.(); delete globalThis.__phase4Hooks; }
});

test('calendar dates preserve local day across UTC boundaries', async () => {
  const { localDate, formatCalendarDate } = await import('../src/utils/dates.ts');
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Almaty';
    assert.equal(localDate(new Date('2026-10-23T20:30:00Z')), '2026-10-24');
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(localDate(new Date('2026-10-24T01:30:00Z')), '2026-10-23');
    assert.equal(formatCalendarDate('2026-10-24'), new Date(2026, 9, 24).toLocaleDateString());
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('shared preferences ignore stale GETs, serialize saves and retain currency on failure', async () => {
  const slots = [], pendingEffects = [], reads = [], requests = [];
  let cursor = 0;
  const savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => { reads.push(key); return key === 'finance_app_rates_updated_at' ? String(Date.now()) : null; },
    setItem: () => { throw new Error('No financial localStorage writes expected'); },
  } });
  globalThis.__phase4Provider = {
    useState: initial => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef: initial => { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback: callback => { cursor++; return callback; },
    useEffect: (callback, dependencies) => {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, key) => value !== slots[index].deps[key])) {
        const previous = slots[index];
        slots[index] = { deps: dependencies };
        pendingEffects.push(() => { previous?.cleanup?.(); slots[index].cleanup = callback(); });
      }
    },
    request: (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject })),
  };
  const source = (await readFile(new URL('../src/state/FinanceProvider.tsx', import.meta.url), 'utf8'))
    .replace(/import \{ useCallback, useEffect, useRef, useState, useSyncExternalStore \} from 'react';/, 'const {useCallback,useEffect,useRef,useState,request}=globalThis.__phase4Provider; const __createElement=(_tag,props)=>props.value;')
    .replace(/import \{ request \} from '..\/api\/client';/, '')
    .replace(/import \{ FinanceContext \} from '.\/financeStore';/, 'const FinanceContext={Provider:null};')
    .replace(/^import .*from '.\/(?:authStore)';$/gm, '')
    .replace(/^import .*from '..\/(?:api\/dataOperations|components\/DataConfirmationDialog)';$/gm, '');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, jsxFactory: '__createElement' } }).outputText;
  const { FinanceDataProvider: FinanceProvider } = await import(`data:text/javascript;base64,${Buffer.from(output + '\nexport { FinanceDataProvider };').toString('base64')}`);
  function render() { cursor = 0; const value = FinanceProvider({ children: null }); while (pendingEffects.length) pendingEffects.shift()(); return value; }
  const settle = () => new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(render().preferenceLoading, true);
    requests[0].resolve({ display_currency: 'EUR' }); await settle();
    assert.equal(render().currency, 'EUR');
    render().refresh(); render(); // A background preferences GET is now in flight.
    const saving = render().setCurrency('KZT');
    assert.equal(render().preferenceLoading, true);
    await render().setCurrency('RUB');
    assert.equal(requests.length, 3, 'Concurrent save must not issue a second PATCH');
    requests[2].resolve({ display_currency: 'KZT' }); await saving;
    requests[1].resolve({ display_currency: 'USD' }); await settle();
    assert.equal(render().currency, 'KZT', 'Stale GET must not overwrite saved currency');
    const failure = render().setCurrency('EUR');
    requests[3].reject(new Error('Save failed')); await failure;
    assert.equal(render().currency, 'KZT');
    assert.equal(render().preferenceError, 'Save failed');
    assert.equal(render().preferenceLoading, false);
    assert.ok(reads.every(key => ['finance_app_exchange_rates', 'finance_app_rates_updated_at'].includes(key)));
  } finally {
    for (const slot of slots) slot?.cleanup?.();
    delete globalThis.__phase4Provider;
    if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage); else delete globalThis.localStorage;
  }
});
