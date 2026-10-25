import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import config from '../tailwind.config.js';

let sequence = 0;
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap(nodes)];
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : node?.children?.map(text).join('') || '';
async function component(file, deps = {}) {
  const key = `__polish${sequence++}`;
  const ports = { __jsx: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(child => child != null && child !== false) }), ...deps };
  globalThis[key] = ports;
  try {
    let source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const icons = [...source.matchAll(/import \{([^}]+)\} from ['"]lucide-react['"]/g)].flatMap(match => match[1].split(',').map(name => name.trim()));
    source = source.replace(/^import .*$/gm, '');
    source = `const {${Object.keys(ports).join(',')}}=globalThis.${key};\n${icons.map(name => `const ${name}='${name}';`).join('\n')}\n${source}`;
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, jsxFactory: '__jsx' } }).outputText;
    return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
  } finally { delete globalThis[key]; }
}

test('one brand supplies the complete accessible name and preserves the geometric mark in all brand placements', async () => {
  const Brand = await component('src/components/AveroBrand.tsx', { AveroMark: 'mark' });
  for (const inverse of [false, true]) {
    const tree = Brand({ inverse });
    assert.equal(tree.props.role, 'img');
    assert.equal(tree.props['aria-label'], 'AVERO');
    assert.equal(tree.children[0].props.decorative, true);
    assert.equal(text(tree), 'VERO');
    assert.equal(tree.children[1].props['aria-hidden'], 'true');
    assert.equal(tree.props.className.includes('ui-brand-inverse'), inverse);
  }
  for (const path of ['src/components/Topbar.tsx', 'src/pages/AuthPage.tsx']) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.ok(source.includes('<AveroBrand'));
    assert.doesNotMatch(source, /<AveroMark|>VERO</);
  }
});

test('select leading icons remain decorative and do not create a second native control', async () => {
  const Select = await component('src/components/SelectControl.tsx');
  let changed;
  const tree = Select({ leadingIcon: 'filter-icon', value: 'income', onChange: e => { changed = e.target.value; }, children: 'Options' });
  assert.equal(nodes(tree).filter(node => node.type === 'select').length, 1);
  const select = tree.children[0];
  assert.ok(select.props.className.includes('ui-select-with-icon'));
  assert.equal('leadingIcon' in select.props, false);
  select.props.onChange({ target: { value: 'expense' } });
  assert.equal(changed, 'expense');
  assert.equal(tree.children[2].props['aria-hidden'], 'true');
});

test('transaction row keeps the original amount and edit/delete callbacks with always accessible actions', async () => {
  const formats = [], calls = [];
  const Row = await component('src/features/transactions/TransactionItem.tsx', { useSettings: () => ({ formatAmount: value => { formats.push(value); return value; } }), formatCalendarDate: value => value });
  const transaction = { id: 'tx-1', title: 'Long transaction title', amount: '999999999999.99999999', category: 'Housing', date: '2026-10-25', type: 'expense' };
  const tree = Row({ transaction, onEdit: value => calls.push(value), onDelete: value => calls.push(value) });
  assert.deepEqual(formats, [transaction.amount]);
  const actions = nodes(tree).filter(node => node.type === 'button');
  assert.equal(actions.length, 2);
  assert.ok(actions.every(node => node.props['aria-label'].includes(transaction.title)));
  assert.ok(actions.every(node => !node.props.className.includes('opacity-0')));
  actions.forEach(node => node.props.onClick());
  assert.deepEqual(calls, [transaction, transaction.id]);
  assert.ok(nodes(tree).some(node => node.type === 'time' && node.props.dateTime === transaction.date));
});

test('subscription rows retain paused/active states, canonical summary and existing actions without nested scroll', async () => {
  const calls = [];
  const List = await component('src/features/subscriptions/ActiveSubscriptions.tsx', { useSettings: () => ({ formatAmount: value => `fmt:${value}` }), formatCalendarDate: value => value });
  const subscriptions = ['active','paused'].map((status, index) => ({ id: `s${index}`, serviceName: `Service ${index}`, amount: '2.00000001', nextPaymentDate: '2026-11-01', status }));
  const props = { subscriptions, summary: { monthly_cost_usd: '999.00000001', active_count: 17, paused_count: 4 }, onEdit: value => calls.push(value), onDelete: value => calls.push(value), onAdd: () => calls.push('add') };
  const tree = List(props);
  assert.ok(text(tree).includes('fmt:999.00000001'));
  assert.ok(text(tree).includes('17 active · 4 paused'));
  assert.ok(text(tree).includes('paused'));
  assert.ok(!nodes(tree).some(node => /overflow-y/.test(node.props.className || '')));
  nodes(tree).find(node => node.props['aria-label'] === 'Edit subscription: Service 1').props.onClick();
  nodes(tree).find(node => node.props['aria-label'] === 'Delete subscription: Service 0').props.onClick();
  assert.deepEqual(calls, [subscriptions[1], 's0']);
  const empty = List({ ...props, subscriptions: [], summary: null });
  assert.ok(!text(empty).includes('/ month'));
  assert.ok(text(empty).includes('No subscriptions match this view'));
  nodes(empty).find(node => node.type === 'button').props.onClick();
  assert.equal(calls.at(-1), 'add');
});

test('compiled geometry gives brand proportions, single select surface and matching desktop transaction tracks', async () => {
  const source = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
  const { root } = await postcss([tailwind(config)]).process(source, { from: undefined });
  const declarations = selector => {
    const result = {};
    root.walkRules(rule => { if (rule.selector === selector) rule.nodes.forEach(node => { if (node.type === 'decl') result[node.prop] = node.value; }); });
    return result;
  };
  assert.equal(declarations('.ui-brand').gap, '10px');
  assert.equal(declarations('.ui-brand-mark').width, '34px');
  assert.equal(declarations('.ui-brand-wordmark')['font-size'], '25px');
  assert.equal(declarations('.ui-brand-wordmark')['font-weight'], '700');
  const select = declarations('select.ui-select');
  assert.equal(select.height, '44px');
  assert.equal(select['border-width'], '1px');
  assert.equal(select['border-radius'], 'var(--radius-control)');
  assert.equal(select['font-weight'], '500');
  const wrap = declarations('.ui-select-wrap');
  assert.equal(wrap['background-color'], undefined);
  assert.equal(wrap['border-width'], undefined);
  assert.equal(declarations('.ui-transaction-row, .ui-transaction-columns')['grid-template-columns'], 'minmax(0,1.5fr) minmax(0,1fr) 100px minmax(100px,0.8fr) 88px');
});
