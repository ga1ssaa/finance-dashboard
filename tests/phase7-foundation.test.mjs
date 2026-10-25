/** Exercises shell event wiring with controlled DOM ports; native dialog focus trapping needs browser QA. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

let sequence = 0;
async function shell(pathname = '/', initialDark = false) {
  const key = `__shell_${sequence++}`;
  const slots = [], effects = [], listeners = new Set();
  let cursor = 0, tree, focused = false, open = false, dark = initialDark, toggles = 0;
  const document = { body: { style: { overflow: 'auto' } }, activeElement: null };
  const media = {
    matches: false,
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
  };
  const elements = new Map();
  const hooks = {
    document,
    window: { matchMedia: () => media },
    useState: initial => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef: initial => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect: (callback, dependencies) => {
      const i = cursor++;
      const previous = effects[i];
      if (!previous || dependencies.some((value, index) => value !== previous.dependencies[index])) {
        previous?.cleanup?.();
        effects[i] = { callback, dependencies, pending: true };
      }
    },
    useLocation: () => ({ pathname }),
    UserMenu: () => hooks.__jsx('profile-menu', {}),
    NavLink: props => hooks.__jsx('a', { ...props, href: props.to, 'aria-current': props.to === pathname ? 'page' : undefined }, ...props.children),
    __jsx: (type, props, ...children) => {
      props ||= {};
      children = children.flat(Infinity).filter(child => child !== false && child != null);
      if (typeof type === 'function') return type({ ...props, children });
      if (props.ref) {
        const id = type === 'dialog' ? 'drawer' : 'menu';
        if (!elements.has(id)) elements.set(id, id === 'drawer' ? {
          showModal: () => { open = true; },
          close: () => { if (open) { open = false; find('dialog').props.onClose(); } },
        } : { focus: () => { focused = true; } });
        props.ref.current = elements.get(id);
      }
      return { type, props, children };
    },
  };
  function nodes(node = tree) {
    if (!node || typeof node !== 'object') return [];
    return [node, ...node.children.flatMap(child => nodes(child))];
  }
  function find(type, predicate = () => true) {
    const found = nodes().filter(node => node.type === type && predicate(node.props));
    assert.equal(found.length, 1);
    return found[0];
  }
  globalThis[key] = hooks;
  let Page;
  try {
    const load = async (file, names) => {
      let source = await readFile(new URL(file, import.meta.url), 'utf8');
      const iconImport = source.match(/import \{([^}]+)\} from 'lucide-react';/);
      const icons = iconImport ? iconImport[1].split(',').map(icon => icon.trim()) : [];
      source = source.replace(/^import .*$/gm, '');
      source = `const {${names.join(',')}}=globalThis.${key};\n${icons.map(icon => `const ${icon}='${icon}';`).join('\n')}\n${source}`;
      const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, jsxFactory: '__jsx' } }).outputText;
      return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    };
    hooks.navigationItems = (await load('../src/components/navigation.ts', ['__jsx'])).navigationItems;
    hooks.AveroMark = (await load('../src/components/AveroMark.tsx', ['__jsx'])).default;
    hooks.AveroBrand = (await load('../src/components/AveroBrand.tsx', ['__jsx','AveroMark'])).default;
    hooks.Topbar = (await load('../src/components/Topbar.tsx', ['__jsx','NavLink','UserMenu','AveroBrand','navigationItems'])).default;
    Page = (await load('../src/components/DashboardLayout.tsx', ['useState','useRef','useEffect','NavLink','AveroMark','Topbar','navigationItems','__jsx','window','document'])).default;
  } finally { delete globalThis[key]; }
  function render() {
    cursor = 0;
    tree = Page({ children: 'Financial content', isDarkMode: dark, toggleTheme: () => { dark = !dark; toggles++; } });
    for (const effect of effects.filter(Boolean)) {
      if (effect.pending) { effect.pending = false; effect.cleanup = effect.callback(); }
    }
  }
  render();
  return {
    find, nodes, render, document, media, listeners,
    toggles: () => toggles,
    navigate: path => { pathname = path; render(); },
    button: label => find('button', props => props['aria-label'] === label),
    isOpen: () => open,
    focusRestored: () => focused,
    unmount: () => effects.forEach(effect => effect.cleanup?.()),
    resizeToDesktop: () => { media.matches = true; listeners.forEach(listener => listener()); render(); },
    // Browsers dispatch close after Escape's native cancel action; this tests our close-event handler.
    nativeClose: () => { elements.get('drawer').close(); render(); },
  };
}

test('shell preserves five routes, names the native drawer and links its accessible trigger', async () => {
  const ui = await shell('/budget');
  const drawer = ui.find('dialog');
  const menu = ui.button('Open navigation');
  assert.equal(drawer.props['aria-label'], 'Main navigation drawer');
  assert.equal(drawer.props.open, undefined, 'Closed dialog must stay out of the tab order');
  assert.equal(menu.props['aria-expanded'], false);
  assert.equal(menu.props['aria-controls'], drawer.props.id);
  assert.equal(menu.props['aria-haspopup'], 'dialog');
  const sidebar = ui.find('aside');
  const links = ui.nodes(sidebar).filter(node => node.type === 'a' && node.props.className.includes('ui-sidebar-link'));
  assert.equal(ui.nodes(sidebar).filter(node => node.type === 'a').length, 5, 'Sidebar must start with navigation, without another brand link');
  assert.equal(links[0].props['aria-label'], 'Overview');
  assert.deepEqual(links.map(link => link.props.href), ['/', '/transactions', '/budget', '/subscriptions', '/settings']);
  assert.equal(links.find(link => link.props.href === '/budget').props['aria-current'], 'page');
  assert.ok(ui.nodes(ui.find('header')).some(node => node.children.includes('Budget and Goals')));
  ui.unmount();
});

test('opening invokes showModal; closing restores trigger focus, expanded state and body scrolling', async () => {
  const ui = await shell();
  ui.button('Open navigation').props.onClick();
  ui.render();
  assert.equal(ui.isOpen(), true);
  assert.equal(ui.button('Open navigation').props['aria-expanded'], true);
  assert.equal(ui.document.body.style.overflow, 'hidden');
  ui.button('Close navigation').props.onClick();
  ui.render();
  assert.equal(ui.isOpen(), false);
  assert.equal(ui.focusRestored(), true);
  assert.equal(ui.button('Open navigation').props['aria-expanded'], false);
  assert.equal(ui.document.body.style.overflow, 'auto');
  ui.unmount();
});

test('native close event also restores focus and state without intercepting Escape', async () => {
  const ui = await shell();
  ui.button('Open navigation').props.onClick();
  ui.render();
  assert.equal(ui.find('dialog').props.onCancel, undefined, 'Allow native Escape cancellation');
  ui.nativeClose();
  assert.equal(ui.focusRestored(), true);
  assert.equal(ui.button('Open navigation').props['aria-expanded'], false);
  assert.equal(ui.document.body.style.overflow, 'auto');
  ui.unmount();
});

test('drawer route selection closes navigation and desktop resizing releases the modal', async () => {
  const ui = await shell();
  ui.button('Open navigation').props.onClick();
  ui.render();
  const link = ui.nodes(ui.find('dialog')).find(node => node.type === 'a' && node.props.href === '/transactions');
  link.props.onClick();
  ui.render();
  assert.equal(ui.isOpen(), false);
  ui.button('Open navigation').props.onClick();
  ui.render();
  ui.resizeToDesktop();
  assert.equal(ui.isOpen(), false);
  assert.equal(ui.document.body.style.overflow, 'auto');
  ui.unmount();
  assert.equal(ui.listeners.size, 0);
});

test('unmounting an open drawer restores existing body overflow and removes viewport listener', async () => {
  const ui = await shell();
  ui.button('Open navigation').props.onClick();
  ui.render();
  ui.unmount();
  assert.equal(ui.document.body.style.overflow, 'auto');
  assert.equal(ui.listeners.size, 0);
});

test('backdrop click dismisses the drawer while clicks within its bounds keep it open', async () => {
  const ui = await shell();
  ui.button('Open navigation').props.onClick();
  ui.render();
  const target = { getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 800 }) };
  const click = ui.find('dialog').props.onClick;
  click({ target, currentTarget: target, clientX: 100, clientY: 400 });
  assert.equal(ui.isOpen(), true);
  click({ target: {}, currentTarget: target, clientX: 400, clientY: 400 });
  assert.equal(ui.isOpen(), true);
  click({ target, currentTarget: target, clientX: 400, clientY: 400 });
  ui.render();
  assert.equal(ui.isOpen(), false);
  assert.equal(ui.focusRestored(), true);
  ui.unmount();
});

test('every route has one shared theme toggle immediately before Settings and the profile menu in both modes', async () => {
  for (const path of ['/', '/transactions', '/budget', '/subscriptions', '/settings']) {
    for (const dark of [false, true]) {
      const ui = await shell(path, dark);
      const toggle = ui.button(dark ? 'Switch to light theme' : 'Switch to dark theme');
      assert.equal(toggle.props['aria-pressed'], dark);
      assert.ok(toggle.props.className.includes('ui-theme-toggle'));
      assert.equal(toggle.children[0].type, dark ? 'Sun' : 'Moon');
      assert.equal(toggle.children[0].props.size, 20);
      const header = ui.find('header');
      const controls = header.children.find(node => node.children?.some(child => child.children?.includes(toggle)));
      assert.deepEqual(controls.children.map(node => node.type), ['span', 'a', 'profile-menu']);
      assert.equal(controls.children[0].children[0], toggle);
      assert.equal(controls.children[1].props.href, '/settings');
      assert.equal(controls.children[1].props['aria-label'], 'Settings');
      assert.equal(ui.nodes().filter(node => node.type === 'button' && node.props.className?.includes('ui-theme-toggle')).length, 1);
      ui.unmount();
    }
  }
});

test('theme selection survives navigation without introducing a shell-owned theme state', async () => {
  const ui = await shell();
  ui.button('Switch to dark theme').props.onClick(); ui.render();
  for (const path of ['/transactions', '/budget', '/subscriptions', '/settings', '/']) {
    ui.navigate(path);
    assert.equal(ui.button('Switch to light theme').props['aria-pressed'], true);
  }
  assert.equal(ui.toggles(), 1);
  ui.navigate('/settings');
  ui.button('Switch to light theme').props.onClick(); ui.render();
  assert.equal(ui.button('Switch to dark theme').props['aria-pressed'], false);
  assert.equal(ui.toggles(), 2);
  ui.unmount();
});

test('Topbar, icon rail and drawer share route definitions; icon links are named and tooltips dismiss on Escape', async () => {
  const ui = await shell('/subscriptions');
  const sidebar = ui.find('nav', props => props['aria-label'] === 'Sidebar navigation');
  const rail = ui.nodes(sidebar).filter(node => node.type === 'a');
  const top = ui.find('nav', props => props['aria-label'] === 'Topbar navigation');
  const topLinks = ui.nodes(top).filter(node => node.type === 'a');
  assert.deepEqual(topLinks.map(node => node.props.href), rail.filter(node => node.props.href !== '/settings').map(node => node.props.href));
  for (const link of rail) {
    assert.ok(link.props['aria-label']);
    assert.equal(link.children[0].props.size, 20);
    assert.equal(link.children[1].props.role, 'tooltip');
    assert.ok(link.children[1].props.className.includes('group-focus-visible:visible'));
    link.props.onKeyDown({ key: 'Escape' }); ui.render();
    const current = ui.nodes(ui.find('nav', props => props['aria-label'] === 'Sidebar navigation')).find(node => node.props.href === link.props.href);
    assert.equal(current.children[1].props.hidden, true);
    current.props.onFocus(); ui.render();
    const focused = ui.nodes(ui.find('nav', props => props['aria-label'] === 'Sidebar navigation')).find(node => node.props.href === link.props.href);
    assert.equal(focused.children[1].props.hidden, false);
  }
  ui.button('Open navigation').props.onClick(); ui.render();
  const mobile = ui.nodes(ui.find('nav', props => props['aria-label'] === 'Mobile navigation')).filter(node => node.type === 'a');
  assert.deepEqual(mobile.map(node => node.props.href), rail.map(node => node.props.href));
  ui.unmount();
});

test('responsive shell separates desktop text navigation, tablet rail and mobile drawer', async () => {
  const ui = await shell();
  assert.ok(ui.find('header').props.className.includes('h-[72px]'));
  assert.ok(ui.find('aside').props.className.includes('w-[72px]'));
  assert.ok(ui.find('aside').props.className.includes('md:flex'));
  assert.ok(ui.find('nav', props => props['aria-label'] === 'Topbar navigation').props.className.includes('lg:flex'));
  assert.ok(ui.button('Open navigation').props.className.includes('md:hidden'));
  assert.ok(ui.find('dialog').props.className.includes('md:hidden'));
  assert.ok(ui.find('main').props.className.includes('py-6'));
  assert.ok(ui.nodes(ui.find('header')).some(node => node.children.includes('VERO')));
  ui.unmount();
});

test('theme hook restores and persists the existing preference; pages contain no duplicate controls', async () => {
  const values = new Map([['finance_app_theme', 'dark']]), classes = new Set();
  let state, effect, previous, reads = 0;
  const key = `__theme_${sequence++}`;
  globalThis[key] = {
    localStorage: { getItem: key => { reads++; return values.get(key); }, setItem: (key, value) => values.set(key, value) },
    document: { documentElement: { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } } },
    useState: initial => { if (state === undefined) state = initial(); return [state, value => { state = typeof value === 'function' ? value(state) : value; }]; },
    useEffect: (callback, deps) => { if (!previous || deps.some((value,index) => value !== previous[index])) { previous = deps; effect = callback; } },
  };
  try {
    let source = await readFile(new URL('../src/hooks/useTheme.ts', import.meta.url), 'utf8');
    source = `const {useState,useEffect,localStorage,document}=globalThis.${key};\n` + source.replace(/^import .*$/gm, '');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const { default: useTheme } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    const render = () => { effect = null; const result = useTheme(); effect?.(); return result; };
    let theme = render();
    assert.equal(theme.isDarkMode, true); assert.equal(classes.has('dark'), true);
    theme.toggleTheme(); theme = render();
    assert.equal(theme.isDarkMode, false); assert.equal(classes.has('dark'), false);
    assert.equal(values.get('finance_app_theme'), 'light');
    render(); assert.equal(reads, 1);
    state = undefined; previous = undefined;
    theme = render(); assert.equal(theme.isDarkMode, false);
    theme.toggleTheme(); render(); assert.equal(values.get('finance_app_theme'), 'dark');
  } finally { delete globalThis[key]; }
  for (const page of ['TransactionsPage', 'BudgetGoalsPage', 'SubscriptionsPage', 'SettingsPage']) {
    const source = await readFile(new URL(`../src/pages/${page}.tsx`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /toggleTheme|isDarkMode|useTheme/);
    assert.ok(source.includes('ui-page-header'));
  }
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.equal(app.match(/useTheme\(\)/g)?.length, 1);
  assert.equal(app.match(/toggleTheme=\{/g)?.length, 1);
});


test('mobile drawer wraps Tab and Shift+Tab at its focus boundaries', async () => {
  const ui = await shell();
  const first = { focus: () => { ui.document.activeElement = first; } };
  const last = { focus: () => { ui.document.activeElement = last; } };
  const target = { querySelectorAll: () => [first, last] };
  for (const [shiftKey, from, expected] of [[true, first, last], [false, last, first]]) {
    ui.document.activeElement = from;
    let prevented = false;
    ui.find('dialog').props.onKeyDown({ key: 'Tab', shiftKey, currentTarget: target, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(ui.document.activeElement, expected);
  }
  ui.unmount();
});


test('Topbar composes the preserved A mark with VERO and keeps the full accessible product name', async () => {
  const ui = await shell();
  const brand = ui.nodes(ui.find('header')).find(node => node.type === 'a' && node.props['aria-label'] === 'AVERO overview');
  assert.ok(brand);
  const composition = brand.children[0];
  assert.equal(composition.props['aria-label'], 'AVERO');
  assert.equal(composition.children[0].type, 'svg');
  assert.equal(composition.children[0].props.className, 'ui-brand-mark');
  assert.equal(composition.children[1].children[0], 'VERO');
  assert.equal(composition.children[1].props['aria-hidden'], 'true');
  ui.unmount();
});

test('blocked theme storage is nonfatal on authentication pages and still permits in-memory theme changes', async () => {
  const key='__blockedThemeStorage';let state,previous,effect;const classes=new Set();
  globalThis[key]={
    localStorage:{getItem(){throw new Error('Storage blocked');},setItem(){throw new Error('Storage blocked');}},
    document:{documentElement:{classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)}}},
    useState:initial=>{if(state===undefined)state=initial();return[state,next=>{state=typeof next==='function'?next(state):next;}];},
    useEffect:(callback,deps)=>{if(!previous||deps.some((value,index)=>value!==previous[index])){effect=callback;previous=deps;}},
  };
  try{
    const source=(await readFile(new URL('../src/hooks/useTheme.ts',import.meta.url),'utf8')).replace(/^import .*$/gm,'');
    const code=ts.transpileModule(`const {useState,useEffect,localStorage,document}=globalThis.${key};\n${source}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
    const {default:useTheme}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    const render=()=>{effect=null;const result=useTheme();effect?.();return result;};
    let theme=render();assert.equal(theme.isDarkMode,false);assert.equal(classes.has('dark'),false);
    theme.toggleTheme();theme=render();assert.equal(theme.isDarkMode,true);assert.equal(classes.has('dark'),true);
    theme.toggleTheme();theme=render();assert.equal(theme.isDarkMode,false);assert.equal(classes.has('dark'),false);
  }finally{delete globalThis[key];}
});
