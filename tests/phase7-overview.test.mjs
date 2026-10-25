/** Executes real Overview components with controlled hooks/chart ports; no server or financial writes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import postcss from 'postcss';
import { signedUnits } from '../src/utils/money.ts';

let sequence = 0;
async function loader(deps, run) {
  const key = `__overview_${sequence++}`;
  globalThis[key] = deps;
  const load = async (file, names = []) => {
    let source = await readFile(new URL(file, import.meta.url), 'utf8');
    const imports = [...source.matchAll(/import \{([^}]+)\} from ['"](?:lucide-react|recharts)['"];?/g)].flatMap(match => match[1].split(',').map(name => name.trim()));
    source = source.replace(/^import .*$/gm, '');
    source = `const __fragment='fragment'; const {${names.join(',')}}=globalThis.${key};\n${imports.map(name => `const ${name}='${name}';`).join('\n')}\n${source}`;
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, jsxFactory: '__jsx', jsxFragmentFactory: '__fragment' } }).outputText;
    return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  };
  try { return await run(load); } finally { delete globalThis[key]; }
}
const ready = data => ({ data, loading: false, error: '', retry: () => {} });
const dashboard = { income_usd: '10000.00000000', expenses_usd: '6500.00000000', balance_usd: '3500.00000000', transaction_count: 100, expense_by_category: [{ category: 'Food', amount_usd: '2500.00000000' }, { category: 'Housing', amount_usd: '4000.00000000' }] };
const manual = { monthly_income_usd: '5000.00000000', needs_spent_usd: '2600.00000000', wants_spent_usd: '900.00000000', savings_usd: '500.00000000' };
const transactions = Array.from({ length: 8 }, (_, index) => ({ id: `tx-${index}`, title: `Record ${index}`, amount: '99999.00000000', type: 'expense', category: 'Food', date: `2026-10-${25-index}` }));
const payments = Array.from({ length: 3 }, (_, index) => ({ id: `sub-${index}`, service_name: `Service ${index}`, amount_usd: `${index+1}00.00000000`, next_payment_date: index === 0 ? '2026-01-01' : `2026-11-0${index}`, icon: '', status: 'active' }));
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : node?.children?.map(text).join('') || '';
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap(nodes)];

async function overview() {
  const calls = { paths: [], formats: [], periods: [], edit: [], delete: [], addTransaction: 0, addSubscription: 0 };
  const budget = { ...ready({ ...manual }), monthlyIncome: 5000, spentData: { needs: 2600, wants: 900, savings: 500 } };
  const summary = ready({ active_count: 17, paused_count: 2, monthly_cost_usd: '999.00000000' });
  const scheduled = ready({ items: [...payments], total: 17, limit: 3, offset: 0 });
  const props = {
    dashboard: ready({ ...dashboard }), recent: ready({ items: [], total: 100, limit: 10, offset: 0 }), transactions: [...transactions],
    timeRange: 'all', setTimeRange: range => calls.periods.push(range),
    recentFilterType: 'all', setRecentFilterType: () => {}, recentSortBy: 'date-desc', setRecentSortBy: () => {}, canCreate: true,
    onAddTransaction: () => calls.addTransaction++, onAddSubscription: () => calls.addSubscription++,
    onEditTransaction: tx => calls.edit.push(tx), onDeleteTransaction: id => calls.delete.push(id),
  };
  const deps = {
    signedUnits,
    __jsx: (type, props, ...children) => {
      props ||= {}; children = children.flat(Infinity).filter(child => child !== false && child != null);
      return typeof type === 'function' ? type({ ...props, children }) : { type, props, children };
    },
    Link: props => deps.__jsx('a', { ...props, href: props.to }, ...(props.children || [])),
    useSettings: () => ({ formatAmount: value => { calls.formats.push(value); return `fmt:${value}`; } }),
    useBudget: () => budget,
    useResource: path => { calls.paths.push(path); if (path === '/subscriptions/summary') return summary; assert.equal(path, deps.SCHEDULED_SUBSCRIPTIONS_PATH); return scheduled; },
    localDate: () => '2026-10-25', formatCalendarDate: value => `calendar:${value}`,
    ScrollReveal: props => deps.__jsx('reveal', {}, ...props.children),
  };
  return loader(deps, async load => {
    Object.assign(deps, await load('../src/features/dashboard/overviewData.ts', ['signedUnits']));
    deps.ResourceStatus = (await load('../src/components/ResourceStatus.tsx', ['__jsx'])).default;
    deps.SelectControl = (await load('../src/components/SelectControl.tsx', ['__jsx'])).default;
    deps.TransactionFilters = (await load('../src/features/transactions/TransactionFilters.tsx', ['__jsx', 'SelectControl'])).default;
    for (const name of ['SummaryCards', 'CashFlowChart', 'CategoryPieChart']) deps[name] = (await load(`../src/features/dashboard/${name}.tsx`, ['__jsx', 'useSettings'])).default;
    deps.RecentTransactions = (await load('../src/features/dashboard/RecentTransactions.tsx', ['__jsx', 'Link', 'ResourceStatus', 'TransactionFilters', 'useSettings', 'formatCalendarDate'])).default;
    deps.BudgetOverview = (await load('../src/features/dashboard/BudgetOverview.tsx', ['__jsx', 'Link', 'ResourceStatus', 'useSettings', 'budgetRows'])).default;
    deps.SubscriptionOverview = (await load('../src/features/dashboard/SubscriptionOverview.tsx', ['__jsx', 'Link', 'ResourceStatus', 'useSettings', 'localDate', 'formatCalendarDate'])).default;
    deps.SmartInsights = (await load('../src/features/dashboard/SmartInsights.tsx', ['__jsx', 'Link'])).default;
    const Page = (await load('../src/pages/OverviewPage.tsx', ['__jsx', 'ResourceStatus', 'ScrollReveal', 'useBudget', 'useResource', 'useSettings', 'SummaryCards', 'CashFlowChart', 'CategoryPieChart', 'RecentTransactions', 'BudgetOverview', 'SubscriptionOverview', 'SmartInsights', 'overviewInsights', 'PERIOD_LABELS', 'SCHEDULED_SUBSCRIPTIONS_PATH'])).default;
    return { props, budget, summary, scheduled, calls, helpers: deps, render: () => Page(props) };
  });
}

function find(tree, type, predicate = () => true) {
  const found = nodes(tree).filter(node => node.type === type && predicate(node.props, node));
  assert.equal(found.length, 1, `Expected one ${type}`); return found[0];
}

test('Overview renders six ordered sections, summary immediately, five reveals and working navigation links', async () => {
  const ui = await overview(), tree = ui.render();
  assert.deepEqual(nodes(tree).filter(node => node.type === 'h2').map(text), ['Financial summary', 'Cash flow', 'Recent transactions', 'Budget overview', 'Subscriptions', 'Financial insights']);
  assert.notEqual(tree.children[0].type, 'reveal');
  assert.equal(nodes(tree).filter(node => node.type === 'reveal').length, 5);
  for (const href of ['/transactions', '/budget', '/subscriptions']) assert.ok(nodes(tree).some(node => node.type === 'a' && node.props.href === href));
  find(tree, 'button', (_, node) => text(node) === 'Month').props.onClick();
  assert.deepEqual(ui.calls.periods, ['month']);
  assert.doesNotMatch(text(tree), /AI Smart|Great job|🎉/);
});

test('summary, comparison and categories use full canonical aggregates, never paginated transaction amounts', async () => {
  const ui = await overview(), tree = ui.render();
  const summary = find(tree, 'dl');
  assert.ok(text(summary).includes('fmt:3500.00000000'));
  assert.ok(text(summary).includes('fmt:10000.00000000'));
  assert.ok(text(summary).includes('fmt:6500.00000000'));
  const chart = find(tree, 'BarChart');
  assert.deepEqual(chart.props.data, [{ name: 'Income', value: 10000 }, { name: 'Expenses', value: 6500 }]);
  assert.equal(find(tree, 'Bar').props.isAnimationActive, false);
  assert.deepEqual(find(tree, 'Pie').props.data, [{ name: 'Food', value: 2500 }, { name: 'Housing', value: 4000 }]);
  assert.equal(find(tree, 'Pie').props.isAnimationActive, false);
  assert.ok(ui.calls.formats.includes(dashboard.balance_usd));
  assert.ok(nodes(tree).some(node => node.props['aria-describedby'] === 'cash-flow-values'));
  assert.ok(text(find(tree, 'figcaption')).includes('fmt:10000.00000000'));
  ui.props.timeRange = 'month'; ui.props.dashboard.data = { ...dashboard, income_usd: '200.00000000', expenses_usd: '40.00000000', balance_usd: '160.00000000' };
  const changed = ui.render();
  assert.deepEqual(find(changed, 'BarChart').props.data.map(item => item.value), [200, 40]);
  assert.ok(text(changed).includes('Recorded finances · Month'));
});

test('recent preview is capped at five with native edit/delete callbacks and readable dates', async () => {
  const ui = await overview(), tree = ui.render();
  const list = find(tree, 'ul', props => props['aria-label'] === 'Transaction preview');
  assert.equal(list.children.length, 5);
  assert.ok(text(list).includes('Record 4'));
  assert.ok(!text(list).includes('Record 5'));
  assert.ok(text(list).includes('calendar:2026-10-25'));
  assert.ok(nodes(list).filter(node => node.type === 'p' && node.props.className?.includes('text-right')).length === 5);
  find(tree, 'button', props => props['aria-label'] === 'Edit transaction: Record 0').props.onClick();
  find(tree, 'button', props => props['aria-label'] === 'Delete transaction: Record 0').props.onClick();
  assert.equal(ui.calls.edit[0], transactions[0]); assert.deepEqual(ui.calls.delete, ['tx-0']);
  ui.props.canCreate = false;
  assert.equal(find(ui.render(), 'button', props => props['aria-label'] === 'Edit transaction: Record 0').props.disabled, true);
  assert.ok(!nodes(tree).some(node => /overflow-y-auto|h-80|min-h-\[420/.test(node.props.className || '')));
});

test('budget uses manual income/spending, preserves 50/30/20 and describes capped progress truthfully', async () => {
  const ui = await overview(), tree = ui.render();
  const budget = find(tree, 'section', props => props['aria-labelledby'] === 'budget-overview-title');
  assert.ok(text(budget).includes('fmt:5000'));
  assert.ok(text(budget).includes('fmt:2600'));
  assert.ok(text(budget).includes('fmt:2500'));
  const progress = nodes(budget).filter(node => node.type === 'progress');
  assert.equal(progress.length, 3);
  assert.equal(progress[0].props.value, 100);
  assert.equal(progress[0].props['aria-valuetext'], '104.0% of allocation');
  assert.equal(progress[2].props.value, 50);
  assert.ok(text(budget).includes('independent of transactions'));
  const rows = ui.helpers.budgetRows(5000, { needs: 10, wants: 20, savings: 30 });
  assert.deepEqual(rows.map(row => row.limit), [2500, 1500, 1000]);
  assert.equal(ui.helpers.budgetRows(0, { needs: 20, wants: 0, savings: 0 })[0].percent, null);
});

test('subscriptions use authoritative full summary and query active records by stored date', async () => {
  const ui = await overview(), tree = ui.render();
  assert.deepEqual(ui.calls.paths, ['/subscriptions/summary', '/subscriptions?status=active&sort_by=next_payment_date&sort_direction=asc&limit=3&offset=0']);
  const section = find(tree, 'section', props => props['aria-labelledby'] === 'subscription-overview-title');
  assert.ok(text(section).includes('17 active · 2 paused'));
  assert.ok(text(section).includes('fmt:999.00000000'));
  assert.ok(text(section).includes('Scheduled date passed'));
  assert.ok(text(section).includes('Upcoming scheduled date'));
  assert.ok(text(section).includes('do not confirm payments'));
  assert.equal(nodes(section).filter(node => node.type === 'li').length, 3);
});

test('empty accounts show genuine zero totals and first actions, without empty fixed-height charts', async () => {
  const ui = await overview();
  ui.props.dashboard.data = { income_usd: '0.00000000', expenses_usd: '0.00000000', balance_usd: '0.00000000', transaction_count: 0, expense_by_category: [] };
  ui.props.transactions = [];
  ui.budget.data = { monthly_income_usd: '0', needs_spent_usd: '0', wants_spent_usd: '0', savings_usd: '0' };
  ui.budget.monthlyIncome = 0; ui.budget.spentData = { needs: 0, wants: 0, savings: 0 };
  ui.summary.data = { active_count: 0, paused_count: 0, monthly_cost_usd: '0' }; ui.scheduled.data = { items: [], total: 0, limit: 3, offset: 0 };
  const tree = ui.render();
  assert.ok(text(find(tree, 'dl')).includes('fmt:0.00000000'));
  assert.ok(text(tree).includes('No cash flow recorded'));
  assert.ok(text(tree).includes('Set your monthly budget'));
  assert.ok(text(tree).includes('No active subscriptions'));
  assert.ok(!nodes(tree).some(node => node.type === 'BarChart' || node.type === 'Pie'));
  find(tree, 'button', (_, node) => text(node) === 'Add subscription').props.onClick();
  assert.equal(ui.calls.addSubscription, 1);
  nodes(tree).find(node => node.type === 'button' && text(node) === 'Add transaction').props.onClick();
  assert.equal(ui.calls.addTransaction, 1);
});

test('loading/errors never appear as empty or zero finances, even when stale data is supplied', async () => {
  const ui = await overview();
  for (const resource of [ui.props.dashboard, ui.props.recent, ui.budget, ui.summary, ui.scheduled]) { resource.loading = true; }
  let tree = ui.render();
  assert.ok(text(tree).includes('Loading financial data'));
  assert.ok(!text(tree).includes('Record 0'));
  assert.equal(nodes(tree).filter(node => node.type === 'dl').length, 0);
  assert.ok(!text(tree).includes('No active subscriptions'));
  for (const resource of [ui.props.dashboard, ui.props.recent, ui.budget, ui.summary, ui.scheduled]) { resource.loading = false; resource.error = 'Resource unavailable'; }
  tree = ui.render();
  assert.ok(nodes(tree).some(node => node.props.role === 'alert'));
  assert.ok(!text(tree).includes('fmt:'));
  assert.ok(!text(tree).includes('No transactions in this period.'));
});

test('insights classify canonical negative aggregates exactly and never use preview estimates', async () => {
  const ui = await overview();
  const items = ui.helpers.overviewInsights({ dashboard: { ...dashboard, income_usd: '1000000000000000.00000000', expenses_usd: '1000000000000000.00000001', balance_usd: '-0.00000001' }, budget: null, subscriptions: null, period: 'Month', formatAmount: value => String(value) });
  assert.equal(items[0].title, 'Expenses exceed income');
  assert.ok(items[0].message.includes('1000000000000000.00000001'));
  assert.deepEqual(ui.helpers.overviewInsights({ dashboard: null, budget: null, subscriptions: null, period: 'All time', formatAmount: String }), []);
});

async function reveal(options = {}) {
  const events = new Map(), motionEvents = new Map(), observers = [];
  const element = { dataset: {}, getBoundingClientRect: () => ({ top: options.top ?? 900, height: options.height ?? 300 }), addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) };
  const motion = { matches: Boolean(options.reduced), addEventListener: (name, callback) => motionEvents.set(name, callback), removeEventListener: name => motionEvents.delete(name) };
  let effect;
  class Observer {
    constructor(callback, config) { if (options.constructorError) throw new Error('Unsupported'); this.callback = callback; this.config = config; this.disconnects = 0; observers.push(this); }
    observe(node) { assert.equal(node, element); if (options.observeError) throw new Error('Cannot observe'); }
    disconnect() { this.disconnects++; }
  }
  const deps = { window: { innerHeight: 800, IntersectionObserver: options.unavailable ? undefined : Observer, matchMedia: () => motion }, useRef: () => ({ current: element }), useEffect: callback => { effect = callback; }, __jsx: (type, props, ...children) => ({ type, props, children }) };
  return loader(deps, async load => {
    const Component = (await load('../src/components/ScrollReveal.tsx', ['window', 'useRef', 'useEffect', '__jsx'])).default;
    const tree = Component({ children: 'Financial content' });
    const cleanup = effect();
    return { tree, element, events, motion, motionEvents, observers, cleanup: () => cleanup?.() };
  });
}

test('scroll reveal defaults visible and reveals an initially offscreen section once', async () => {
  const ui = await reveal();
  assert.equal(ui.tree.props.className, 'overview-reveal');
  assert.equal(ui.element.dataset.reveal, 'pending');
  assert.equal(ui.observers[0].config.threshold, 0.15);
  ui.observers[0].callback([{ isIntersecting: false, intersectionRatio: 0 }]); assert.equal(ui.element.dataset.reveal, 'pending');
  ui.observers[0].callback([{ isIntersecting: true, intersectionRatio: 0.01, boundingClientRect: { height: 300 } }]); assert.equal(ui.element.dataset.reveal, 'pending');
  ui.observers[0].callback([{ isIntersecting: true, intersectionRatio: 0.149, boundingClientRect: { height: 300 } }]); assert.equal(ui.element.dataset.reveal, 'pending');
  ui.observers[0].callback([{ isIntersecting: true, intersectionRatio: 0.15 }]); assert.equal(ui.element.dataset.reveal, 'shown');
  assert.equal(ui.observers[0].disconnects, 1);
  ui.observers[0].callback([{ isIntersecting: true, intersectionRatio: 0.15 }]); assert.equal(ui.observers[0].disconnects, 1);
  ui.cleanup(); assert.equal(ui.element.dataset.reveal, undefined);
  assert.equal(ui.events.size, 0); assert.equal(ui.motionEvents.size, 0);
});

test('reveal keeps above-fold, reduced-motion and unsupported-observer content visible', async () => {
  for (const options of [{ top: 100 }, { top: 755, height: 300 }, { reduced: true }, { unavailable: true }, { constructorError: true }, { observeError: true }]) {
    const ui = await reveal(options);
    assert.equal(ui.element.dataset.reveal, undefined);
    ui.cleanup();
  }
});

test('a small initial sliver stays pending until the section reaches its threshold', async () => {
  const ui = await reveal({ top: 760, height: 300 });
  assert.equal(ui.element.dataset.reveal, 'pending');
  ui.observers[0].callback([{ isIntersecting: true, intersectionRatio: 0.14, boundingClientRect: { height: 300 } }]);
  assert.equal(ui.element.dataset.reveal, 'pending');
  ui.observers[0].callback([{ isIntersecting: true, intersectionRatio: 0.15 }]);
  assert.equal(ui.element.dataset.reveal, 'shown');
  ui.cleanup();
});

test('a section taller than the viewport can reveal when the 15% threshold is unreachable', async () => {
  const ui = await reveal({ height: 2000 });
  assert.equal(ui.element.dataset.reveal, 'pending');
  ui.observers[0].callback([{ isIntersecting: true, intersectionRatio: 0.1, boundingClientRect: { height: 2000 }, rootBounds: { height: 200 } }]);
  assert.equal(ui.element.dataset.reveal, 'shown');
  assert.equal(ui.observers[0].disconnects, 1);
  ui.cleanup();
});

test('focus, pointer interaction and a reduced-motion change bypass animation immediately', async () => {
  for (const name of ['focusin', 'pointerdown']) {
    const ui = await reveal(); ui.events.get(name)();
    assert.equal(ui.element.dataset.reveal, undefined);
    ui.observers[0].callback([{ isIntersecting: true, intersectionRatio: 0.15 }]); assert.equal(ui.element.dataset.reveal, undefined);
    ui.cleanup();
  }
  const ui = await reveal();
  ui.observers[0].callback([{ isIntersecting: true, intersectionRatio: 0.15 }]);
  ui.events.get('focusin')(); assert.equal(ui.element.dataset.reveal, undefined);
  ui.cleanup();
  const changed = await reveal(); changed.motion.matches = true; changed.motionEvents.get('change')();
  assert.equal(changed.element.dataset.reveal, undefined);
  changed.cleanup();
});

test('queued observer callbacks after teardown cannot hide or animate content', async () => {
  const ui = await reveal(); ui.cleanup(); ui.observers[0].callback([{ isIntersecting: true, intersectionRatio: 0.15 }]);
  assert.equal(ui.element.dataset.reveal, undefined);
});


test('reveal CSS uses only 24px translation and 500ms transitions, with a visible reduced-motion fallback', async () => {
  const css = postcss.parse(await readFile(new URL('../src/index.css', import.meta.url), 'utf8'));
  const rules = [];
  css.walkRules(rule => rules.push(rule));
  const declarations = selector => Object.fromEntries(rules.find(rule => rule.selector === selector).nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  assert.deepEqual(declarations(".overview-reveal[data-reveal='pending']"), { opacity: '0', transform: 'translateY(24px)' });
  assert.equal(declarations(".overview-reveal[data-reveal='shown']").transition, 'opacity 500ms cubic-bezier(0.22, 1, 0.36, 1), transform 500ms cubic-bezier(0.22, 1, 0.36, 1)');
  const reduced = rules.find(rule => rule.selector === '.overview-reveal[data-reveal]');
  assert.equal(reduced.parent.params, '(prefers-reduced-motion: reduce)');
  assert.deepEqual(Object.fromEntries(reduced.nodes.map(node => [node.prop, node.value])), { opacity: '1', transform: 'none', transition: 'none' });
});


test('Overview typography emphasizes its title and balance, keeps labels medium and scopes secondary contrast', async () => {
  const ui = await overview(), tree = ui.render();
  assert.ok(find(tree, 'h1').props.className.includes('font-bold'));
  assert.ok(tree.props.className.includes('overview-workspace'));
  const summary = find(tree, 'dl');
  assert.ok(nodes(summary).filter(node => node.type === 'dt').every(node => node.props.className.includes('font-medium')));
  assert.ok(nodes(summary).some(node => node.type === 'span' && node.props.className?.includes('font-bold')));
  assert.ok(nodes(tree).filter(node => node.type === 'h2' && !node.props.className?.includes('sr-only')).every(node => node.props.className.includes('font-semibold')));
  const css = postcss.parse(await readFile(new URL('../src/index.css', import.meta.url), 'utf8'));
  const rules = [];
  css.walkRules(rule => rules.push(rule));
  const secondary = selector => rules.find(rule => rule.selector === selector).nodes.find(node => node.prop === '--secondary').value;
  assert.equal(secondary(':root'), '82 97 89');
  assert.equal(secondary('.dark'), '183 200 191');
  assert.equal(secondary('.dark .overview-workspace'), '195 210 201');
});
