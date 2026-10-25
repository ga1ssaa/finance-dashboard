import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import config from '../tailwind.config.js';

async function component(file, icons = []) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source = `const __jsx=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(child=>child!=null&&child!==false)});\n${icons.map(icon => `const ${icon}='${icon}';`).join('\n')}\n${source}`;
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, jsxFactory: '__jsx' } }).outputText;
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
}

test('shared select preserves native attributes, option values, refs and event callbacks', async () => {
  const Select = await component('../src/components/SelectControl.tsx', ['ChevronDown']);
  let selected, key;
  const onChange = event => { selected = event.target.value; };
  const onKeyDown = event => { key = event.key; };
  const ref = { current: null }, children = [{ type: 'option', props: { value: 'expense' } }, { type: 'option', props: { value: 'income' } }];
  const tree = Select({ children, value: 'expense', onChange, onKeyDown, ref, name: 'type', id: 'transaction-type', required: true, disabled: true, 'aria-label': 'Transaction type', className: 'w-full', containerClassName: 'w-full' });
  const select = tree.children[0], arrow = tree.children[1];
  assert.equal(select.type, 'select');
  assert.equal(select.props.value, 'expense');
  assert.equal(select.props.disabled, true);
  assert.equal(select.props.required, true);
  assert.equal(select.props.name, 'type');
  assert.equal(select.props.id, 'transaction-type');
  assert.equal(select.props['aria-label'], 'Transaction type');
  assert.equal(select.props.ref, ref);
  assert.equal(select.props.onChange, onChange);
  assert.deepEqual(select.children, children);
  select.props.onChange({ target: { value: 'income' } }); assert.equal(selected, 'income');
  select.props.onKeyDown({ key: 'ArrowDown' }); assert.equal(key, 'ArrowDown');
  assert.equal(arrow.props.size, 16);
  assert.equal(arrow.props['aria-hidden'], 'true');
  assert.equal(arrow.props.focusable, 'false');
});

test('every existing dropdown uses the shared native select without changing option values', async () => {
  const expected = {
    'src/components/modals/TransactionModal.tsx': ['expense', 'income'],
    'src/components/modals/SubscriptionModal.tsx': ['active', 'paused'],
    'src/features/transactions/TransactionFilters.tsx': ['all', 'income', 'expense', 'date-desc', 'date-asc', 'amount-desc', 'amount-asc'],
    'src/pages/SubscriptionsPage.tsx': ['all', 'active', 'paused', 'next_payment_date:asc', 'next_payment_date:desc', 'amount_usd:asc', 'amount_usd:desc', 'service_name:asc'],
  };
  for (const [file, values] of Object.entries(expected)) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /<select\b/);
    assert.ok(source.includes('<SelectControl'));
    assert.deepEqual([...source.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]), values);
  }
  const settings = await readFile(new URL('../src/pages/SettingsPage.tsx', import.meta.url), 'utf8');
  assert.ok(settings.includes('<SelectControl'));
  assert.doesNotMatch(settings, /ChevronDown|<select\b/);
  assert.match(settings, /onChange=\{\(e\) => setCurrency\(e.target.value as Currency\)\}/);
});

test('angular logo is scalable and named when standalone, decorative beside the wordmark', async () => {
  const Logo = await component('../src/components/AveroMark.tsx');
  const logo = Logo({});
  assert.equal(logo.props.viewBox, '0 0 32 32');
  assert.equal(logo.props.role, 'img');
  assert.equal(logo.props['aria-label'], 'AVERO');
  assert.equal(logo.children.length, 3);
  for (const facet of logo.children) assert.equal(facet.props.fill, 'currentColor');
  const decorative = Logo({ decorative: true });
  assert.equal(decorative.props['aria-hidden'], true);
  assert.equal(decorative.props.role, undefined);
  const favicon = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');
  for (const facet of logo.children) assert.ok(favicon.includes(facet.props.d));
});

test('compiled shared arrows have reserved text space and active Topbar tabs have no filled background', async () => {
  const source = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
  const { root } = await postcss([tailwind(config)]).process(source, { from: undefined });
  const declarations = selector => {
    const result = {};
    root.walkRules(rule => { if (rule.selector === selector) rule.nodes.forEach(node => { if (node.type === 'decl') result[node.prop] = node.value; }); });
    return result;
  };
  const select = declarations('select.ui-select'), arrow = declarations('.ui-select-arrow');
  assert.equal(select['padding-right'], '44px');
  assert.equal(arrow.right, '16px');
  assert.equal(arrow.width, '16px');
  assert.equal(arrow.height, '16px');
  assert.equal(arrow['flex-shrink'], '0');
  assert.equal(arrow['pointer-events'], 'none');
  assert.equal(arrow.top, '50%');
  assert.equal(arrow.transform, 'translateY(-50%)');
  assert.equal(44 - 16 - 16, 12, 'Text is separated from the arrow by 12px');
  const active = declarations(".ui-topbar-link[aria-current='page']");
  assert.equal(active['background-color'], undefined);
  assert.equal(active['border-bottom-color'], 'rgb(var(--accent))');
  assert.equal(declarations('.ui-topbar-link')['font-weight'], '500');
});
