import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as money from '../src/utils/money.ts';
import * as quotes from '../src/utils/exchangeRates.ts';

// Synthetic quotes and records only. The real transport hooks write to an in-memory spy.
const rates = { USD: '1', EUR: '0.92', KZT: '475', RUB: '88' };
const symbols = { USD: '$', EUR: '€', KZT: '₸', RUB: '₽' };
const examples = { USD: ['1000', '1000.00000000'], EUR: ['1000', '1086.95652174'], KZT: ['50000', '105.26315789'], RUB: ['10000', '113.63636364'] };
const keys = ['monthly_income_usd', 'needs_spent_usd', 'wants_spent_usd', 'savings_usd'];
const labels = ['Monthly Income', 'Needs spent', 'Wants spent', 'Savings'];
const emptyBudget = Object.fromEntries(keys.map(key => [key, '0.00000000']));
const storedBudget = Object.fromEntries(keys.map((key, i) => [key, ['999999999999.99999999', '0.00000001', '123.45678901', '0.00000000'][i]]));
const subscription = { id: 'synthetic', serviceName: 'Original', amount: '0.00000001', nextPaymentDate: '2026-10-26', status: 'active', icon: 'Other' };
let sequence = 0;
async function load(path, deps) {
  const key = `__budgetSubscription${sequence++}`;
  globalThis[key] = deps;
  try {
    const source = (await readFile(new URL(`../${path}`, import.meta.url), 'utf8')).replace(/^import .*$/gm, '');
    const code = ts.transpileModule(`const {${Object.keys(deps).join(',')}}=globalThis.${key};\n${source}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, jsxFactory: '__jsx' } }).outputText;
    return await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  } finally { delete globalThis[key]; }
}
function hooks() {
  const slots = []; let cursor = 0;
  return {
    reset: () => { cursor = 0; }, useId: () => 'money-test',
    useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef: initial => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
  };
}
const jsx = (type, props, ...children) => {
  children = children.flat(Infinity).filter(child => child != null && child !== false);
  return typeof type === 'function' ? type({ ...props, children }) : { type, props: props || {}, children };
};
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap(nodes)];
const text = node => typeof node === 'string' ? node : node?.children?.map(text).join('') || '';
async function form(kind, currency, original = null, overrides = {}) {
  const settings = { currency, rates: { ...rates }, ratesUpdatedAt: Date.now(), refresh: () => {}, ...overrides };
  const posts = [], closes = [], focused = [], transport = hooks(); let api;
  const deps = { ...transport, useFinance: () => ({ refresh() {} }), useResource: () => ({ data: original || emptyBudget }), request: async (path, options) => { posts.push({ path, method: options.method, body: JSON.parse(options.body) }); } };
  const apiModule = await load(kind === 'budget' ? 'src/hooks/useBudget.ts' : 'src/hooks/useSubscriptions.ts', deps);
  const renderApi = () => { transport.reset(); api = kind === 'budget' ? apiModule.useBudget() : apiModule.default(); };
  renderApi();
  if (kind === 'subscription') { api.setEditingSubscription(original); renderApi(); }
  const state = hooks();
  const { useMoneyDraft } = await load('src/hooks/useMoneyDraft.ts', { ...state, ...money, ...quotes });
  const AmountInput = (await load('src/components/AmountInput.tsx', { __jsx: jsx })).default;
  const Modal = (await load(`src/components/modals/${kind === 'budget' ? 'Budget' : 'Subscription'}Modal.tsx`, { ...state, __jsx: jsx, X: 'svg', AmountInput, SelectControl: 'select', useMoneyDraft, useSettings: () => settings, CURRENCY_SYMBOLS: symbols, localDate: () => '2026-10-27', UnknownWriteOutcomeError: class extends Error {} })).default;
  const render = () => {
    state.reset();
    const tree = Modal({ isOpen: true, currentBudget: original || emptyBudget, initialData: original, onClose: () => closes.push(true), onSubmit: value => kind === 'budget' ? api.saveBudget(value) : original ? api.handleUpdateSubscription(original.id, value) : api.handleAddSubscription(value) });
    for (const field of nodes(tree).filter(n => n.type === 'input' && n.props.ref)) {
      const element = { focus: () => focused.push(field.props['aria-label']) };
      if (typeof field.props.ref === 'function') field.props.ref(element); else field.props.ref.current = element;
    }
    return tree;
  };
  const find = (type, predicate = () => true) => { const found = nodes(render()).filter(n => n.type === type && predicate(n.props)); assert.equal(found.length, 1); return found[0]; };
  const input = name => find(name === 'status' ? 'select' : 'input', props => kind === 'budget' ? props['aria-label'] === labels[keys.indexOf(name)] : props.id?.endsWith(`-${name}`));
  return { settings, posts, closes, focused, render, input, change: (name, value) => input(name).props.onChange({ target: { value } }), submit: () => find('form').props.onSubmit({ preventDefault() {} }), error: () => nodes(render()).filter(n => n.props.role === 'alert').map(text).join(' ') };
}

for (const [currency, [local, expected]] of Object.entries(examples)) {
  test(`${currency} budget creation sends exact canonical values for all four independent fields`, async () => {
    const ui = await form('budget', currency);
    for (const key of keys) ui.change(key, local);
    await ui.submit();
    assert.deepEqual(ui.posts, [{ path: '/budget', method: 'PATCH', body: Object.fromEntries(keys.map(key => [key, expected])) }]);
    assert.equal(ui.closes.length, 1);
  });
  for (const key of keys) {
    test(`${currency} budget ${key} update preserves every other original independently`, async () => {
      const original = { ...storedBudget }, ui = await form('budget', currency, original);
      ui.change(key, local); await ui.submit();
      assert.deepEqual(ui.posts, [{ path: '/budget', method: 'PATCH', body: { [key]: expected } }]);
      assert.deepEqual(original, storedBudget);
    });
  }
  for (const editing of [false, true]) {
    test(`${currency} subscription ${editing ? 'update' : 'creation'} sends the exact canonical payload`, async () => {
      const ui = await form('subscription', currency, editing ? subscription : null);
      ui.change('service', 'Synthetic'); ui.change('amount', local); await ui.submit();
      assert.deepEqual(ui.posts, [{ path: `/subscriptions${editing ? '/synthetic' : ''}`, method: editing ? 'PATCH' : 'POST', body: { service_name: 'Synthetic', amount_usd: expected, next_payment_date: editing ? subscription.nextPaymentDate : '2026-10-27', status: 'active' } }]);
    });
  }
  for (const [field, value, apiKey] of [['service', 'Changed', 'service_name'], ['status', 'paused', 'status'], ['date', '2026-11-01', 'next_payment_date']]) {
    test(`${currency} subscription ${field}-only edit omits amount_usd including long prefills`, async () => {
      const original = { ...subscription, amount: '999999999999.99999999' };
      const ui = await form('subscription', currency, original);
      ui.change(field, value); await ui.submit();
      assert.equal(ui.posts.length, 1); assert.equal('amount_usd' in ui.posts[0].body, false);
      assert.equal(ui.posts[0].body[apiKey], value); assert.equal(original.amount, '999999999999.99999999');
    });
  }
  test(`${currency} touch/revert and equivalent formatting do not reconvert or accumulate drift`, async () => {
    for (let repeat = 0; repeat < 3; repeat++) {
      const budget = await form('budget', currency, storedBudget);
      for (const key of keys) { const initial = budget.input(key).props.value; budget.change(key, '15'); budget.change(key, `00${initial}${initial.includes('.') ? '0' : '.00'}`); }
      await budget.submit(); assert.equal(budget.posts.length, 0);
      const sub = await form('subscription', currency, subscription), initial = sub.input('amount').props.value;
      sub.change('amount', '15'); sub.change('amount', `00${initial}${initial.includes('.') ? '0' : '.00'}`);
      sub.change('service', `Renamed ${repeat}`); await sub.submit(); assert.equal('amount_usd' in sub.posts[0].body, false);
    }
  });
}

for (const kind of ['budget', 'subscription']) {
  const amountKey = kind === 'budget' ? keys[0] : 'amount';
  const prepare = async (currency, overrides = {}, original = null) => {
    const ui = await form(kind, currency, original, overrides);
    if (kind === 'subscription') ui.change('service', 'Synthetic');
    return ui;
  };
  const savedAmount = ui => ui.posts[0].body[kind === 'budget' ? keys[0] : 'amount_usd'];
  test(`${kind} uses half-even once for ties and repeating decimals without cent rounding`, async () => {
    for (const [amount, expected] of [['0.00000003', '0.00000002'], ['0.00000005', '0.00000002'], ['0.000000030000000001', '0.00000002'], ['0.000000029999999999', '0.00000001'], ['1', '0.50000000']]) {
      const ui = await prepare('EUR', { rates: { EUR: '2' } }); ui.change(amountKey, amount); await ui.submit(); assert.equal(savedAmount(ui), expected);
    }
    const repeating = await prepare('EUR', { rates: { EUR: '3' } }); repeating.change(amountKey, '1'); await repeating.submit(); assert.equal(savedAmount(repeating), '0.33333333');
  });
  test(`${kind} rejects invalid/negative/overflow/rounded-zero amounts and focuses the invalid control`, async () => {
    for (const [currency, amount] of [['USD', '-1'], ['USD', '-0'], ['USD', 'no'], ['USD', '1e2'], ['USD', '1,000'], ['USD', '1.000000001'], ['USD', '1000000000000'], ['EUR', '920000000000'], ['KZT', '0.00000001'], ['EUR', '0.00000001']]) {
      const overrides = amount === '0.00000001' && currency === 'EUR' ? { rates: { EUR: '2' } } : {};
      const ui = await prepare(currency, overrides); ui.change(amountKey, amount); await ui.submit();
      assert.equal(ui.posts.length, 0, `${currency} ${amount}`); assert.ok(ui.error()); assert.equal(ui.input(amountKey).props['aria-invalid'], true); assert.equal(ui.focused.length, 1); assert.equal(ui.closes.length, 0);
    }
  });
  test(`${kind} retains allowed zero semantics and exact NUMERIC(20,8) endpoints`, async () => {
    // These APIs allow zero; transactions still require a positive amount.
    const zero = await prepare('EUR');
    if (kind === 'budget') zero.change(amountKey, '1');
    zero.change(amountKey, '0'); await zero.submit();
    if (kind === 'budget') assert.equal(zero.posts.length, 0); else assert.equal(savedAmount(zero), '0.00000000');
    const clear = await prepare('EUR', {}, kind === 'budget' ? storedBudget : subscription); clear.change(amountKey, '0'); await clear.submit(); assert.equal(savedAmount(clear), '0.00000000');
    for (const [currency, amount] of [['USD', '999999999999.99999999'], ['KZT', '474999999999999.99999525']]) {
      const ui = await prepare(currency); ui.change(amountKey, amount); await ui.submit(); assert.equal(savedAmount(ui), '999999999999.99999999');
    }
    const excess = await prepare('KZT'); excess.change(amountKey, '474999999999999.999995251'); await excess.submit(); assert.equal(excess.posts.length, 0); assert.match(excess.error(), /database limit/);
  });
  test(`${kind} missing/invalid/stale/future rates fail closed without a render crash`, async () => {
    for (const overrides of [ { rates: {} }, ...['0', '-1', 'NaN', '1e2', null].map(EUR => ({ rates: { EUR } })), { ratesUpdatedAt: null }, { ratesUpdatedAt: Date.now() - quotes.RATE_MAX_AGE_MS - 10000 }, { ratesUpdatedAt: Date.now() + 60000 } ]) {
      const ui = await prepare('EUR', overrides); ui.change(amountKey, '1000'); await ui.submit(); assert.equal(ui.posts.length, 0); assert.match(ui.error(), /rate/i);
      const edit = await prepare('EUR', overrides, kind === 'budget' ? storedBudget : subscription);
      if (kind === 'subscription') edit.change('status', 'paused');
      await edit.submit(); assert.equal(edit.error(), '');
      if (kind === 'budget') assert.equal(edit.posts.length, 0); else assert.equal('amount_usd' in edit.posts[0].body, false);
      edit.change(amountKey, '10'); await edit.submit(); assert.match(edit.error(), /rate/i);
    }
    const usd = await prepare('USD', { rates: {}, ratesUpdatedAt: null }); usd.change(amountKey, '1000'); await usd.submit(); assert.equal(savedAmount(usd), '1000.00000000');
  });
  test(`${kind} freezes the quote, publication time, currency and original amounts while open`, async () => {
    const ui = await prepare('EUR'); ui.change(amountKey, '1000');
    ui.settings.currency = 'KZT'; ui.settings.rates.EUR = '2'; ui.settings.ratesUpdatedAt = null;
    await ui.submit(); assert.equal(savedAmount(ui), '1086.95652174');
    const expired = await prepare('EUR', { ratesUpdatedAt: Date.now() - quotes.RATE_MAX_AGE_MS + 10000 }); expired.change(amountKey, '1000');
    const now = Date.now; try { Date.now = () => now() + 20000; await expired.submit(); } finally { Date.now = now; }
    assert.equal(expired.posts.length, 0); assert.match(expired.error(), /stale/);
    const original = kind === 'budget' ? { ...storedBudget } : { ...subscription };
    const preserved = await prepare('EUR', {}, original); preserved.render();
    if (kind === 'budget') original.monthly_income_usd = '3'; else original.amount = '3';
    await preserved.submit();
    if (kind === 'budget') assert.equal(preserved.posts.length, 0); else assert.equal(preserved.posts[0].body.amount_usd, subscription.amount);
  });
}

test('both modals reuse centered AmountInput for all symbols and preserve keyboard/label/error attributes', async () => {
  for (const currency of Object.keys(rates)) {
    for (const kind of ['budget', 'subscription']) {
      const ui = await form(kind, currency), tree = ui.render();
      const controls = nodes(tree).filter(node => node.props.className === 'ui-amount-input');
      assert.equal(controls.length, kind === 'budget' ? 4 : 1);
      for (const control of controls) {
        assert.equal(text(control.children[0]), symbols[currency]); assert.equal(control.children[0].props['aria-hidden'], 'true');
        const input = nodes(control).find(node => node.type === 'input');
        assert.equal(input.props.type, 'text'); assert.equal(input.props.inputMode, 'decimal'); assert.ok(input.props['aria-label']); assert.equal(input.props.tabIndex, undefined); assert.equal(input.props.required, true); assert.equal(input.props['aria-invalid'], false);
        assert.ok(nodes(tree).some(node => node.type === 'label' && node.props.htmlFor === input.props.id));
      }
      assert.ok(nodes(tree).some(node => node.props.className?.includes('max-w-md')));
    }
  }
});

test('a later invalid budget field prevents the entire PATCH without losing valid draft fields', async () => {
  const ui = await form('budget', 'EUR', storedBudget);
  ui.change('monthly_income_usd', '1000'); ui.change('savings_usd', '-1'); await ui.submit();
  assert.equal(ui.posts.length, 0); assert.equal(ui.closes.length, 0);
  assert.equal(ui.input('monthly_income_usd').props.value, '1000'); assert.equal(ui.input('savings_usd').props['aria-invalid'], true);
  ui.change('savings_usd', '0'); await ui.submit();
  assert.deepEqual(ui.posts[0].body, { monthly_income_usd: '1086.95652174' });
});
