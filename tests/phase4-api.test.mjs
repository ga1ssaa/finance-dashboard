/** Opt-in actual frontend client -> loopback HTTP -> disposable PostgreSQL flow.
 * Start tests/phase4_server.py first. Never targets the normal development API.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { signedUnits, decimal } from '../src/utils/money.ts';

const enabled = process.env.RUN_PHASE4_E2E === '1';
test('frontend client persists CRUD, singleton preferences and full-set aggregates through HTTP', { skip: !enabled }, async () => {
  const state = JSON.parse(await readFile(new URL('./.phase4-state.local', import.meta.url), 'utf8'));
  assert.match(state.database, /^finance_dashboard_phase4_[a-f0-9]{12}$/);
  assert.match(state.run_nonce, /^[a-f0-9]{64}$/);
  // Prove the live server's actual DB/owner identity before any financial request.
  const identityResponse = await fetch('http://127.0.0.1:18084/__phase4__/identity', { signal: AbortSignal.timeout(10000) });
  assert.equal(identityResponse.status, 200, 'Refusing a server without the disposable test identity');
  assert.deepEqual(await identityResponse.json(), { database: state.database, owner_id: state.owner_id, run_nonce: state.run_nonce });
  const source = (await readFile(new URL('../src/api/client.ts', import.meta.url), 'utf8')).replace('import.meta.env.VITE_API_BASE_URL', '"http://127.0.0.1:18084/api/v1"');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const { request } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  const write = (path, method, value) => request(path, { method, body: JSON.stringify(value) });
  const baseline = await request('/dashboard');
  const firstPage = await request('/transactions?limit=20&offset=0&sort_by=transaction_date&sort_direction=desc');
  assert.ok(firstPage.total >= 125, 'Run the isolated pagination seed first');
  assert.equal(firstPage.items.length, 20);
  const laterPage = await request('/transactions?limit=20&offset=100&sort_by=transaction_date&sort_direction=desc');
  assert.equal(laterPage.items.length, 20);
  assert.equal(new Set([...firstPage.items, ...laterPage.items].map(item => item.id)).size, 40);
  assert.equal(baseline.transaction_count, firstPage.total);

  const title = `HTTP QA ${Date.now()}`;
  const created = await write('/transactions', 'POST', { title, amount_usd: '999999999999.99999999', type: 'income', category: 'HTTP QA', transaction_date: '2026-10-24' });
  assert.equal(created.amount_usd, '999999999999.99999999');
  assert.match(created.id, /^[a-f0-9-]{36}$/);
  const changed = await write(`/transactions/${created.id}`, 'PATCH', { title: title + ' edited' });
  assert.equal(changed.amount_usd, created.amount_usd);
  // Fresh reads represent a reload/new consumer, rather than local optimistic state.
  assert.equal((await request(`/transactions/${created.id}`)).title, title + ' edited');
  const filtered = await request('/transactions?' + new URLSearchParams({ q: title, category: 'HTTP QA', type: 'income', limit: '20', offset: '0', sort_by: 'amount_usd', sort_direction: 'asc' }));
  assert.equal(filtered.total, 1);
  const aggregate = await request('/dashboard');
  assert.equal(aggregate.transaction_count, baseline.transaction_count + 1);
  assert.equal(aggregate.income_usd, decimal(signedUnits(baseline.income_usd) + signedUnits(created.amount_usd)));
  await assert.rejects(write(`/transactions/${created.id}`, 'PATCH', { amount_usd: '0.000000001' }), /8 fractional/);
  assert.equal((await request(`/transactions/${created.id}`)).amount_usd, created.amount_usd);
  assert.equal(await request(`/transactions/${created.id}`, { method: 'DELETE' }), undefined);
  await assert.rejects(request(`/transactions/${created.id}`), /not found/i);

  const summaryBefore = await request('/subscriptions/summary');
  const subscription = await write('/subscriptions', 'POST', { service_name: title, amount_usd: '0.00000001', next_payment_date: '2026-11-01', status: 'active' });
  assert.equal((await request('/subscriptions/summary')).monthly_cost_usd, decimal(signedUnits(summaryBefore.monthly_cost_usd) + 1n));
  await write(`/subscriptions/${subscription.id}`, 'PATCH', { status: 'paused' });
  assert.equal((await request(`/subscriptions/${subscription.id}`)).status, 'paused');
  assert.equal((await request('/subscriptions/summary')).monthly_cost_usd, summaryBefore.monthly_cost_usd);
  await request(`/subscriptions/${subscription.id}`, { method: 'DELETE' });

  const budgetBefore = await request('/budget');
  await write('/budget', 'PATCH', { monthly_income_usd: '123.12345678', needs_spent_usd: '1', wants_spent_usd: '2', savings_usd: '3' });
  const budget = await request('/budget');
  assert.equal(budget.monthly_income_usd, '123.12345678');
  assert.equal(budget.savings_usd, '3.00000000');
  const preferenceBefore = await request('/preferences');
  await write('/preferences', 'PATCH', { display_currency: 'EUR' });
  assert.equal((await request('/preferences')).display_currency, 'EUR');
  const fields = ['monthly_income_usd', 'needs_spent_usd', 'wants_spent_usd', 'savings_usd'];
  await write('/budget', 'PATCH', Object.fromEntries(fields.map(field => [field, budgetBefore[field]])));
  await write('/preferences', 'PATCH', { display_currency: preferenceBefore.display_currency });
  assert.deepEqual(await request('/dashboard'), baseline);
});
