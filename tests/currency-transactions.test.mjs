import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import config from '../tailwind.config.js';
import * as money from '../src/utils/money.ts';
import * as quotes from '../src/utils/exchangeRates.ts';

const rates = { USD: '1', EUR: '0.92', KZT: '475', RUB: '88' }; // Synthetic test quotes, never production fallbacks.
const examples = { USD: ['1000', '1000.00000000'], EUR: ['1000', '1086.95652174'], KZT: ['50000', '105.26315789'], RUB: ['10000', '113.63636364'] };
let sequence = 0;
async function load(path, deps, suffix = '') {
  const key = `__currency${sequence++}`;
  globalThis[key] = deps;
  try {
    const source = (await readFile(new URL(`../${path}`, import.meta.url), 'utf8')).replace(/^import .*$/gm, '');
    const code = ts.transpileModule(`const {${Object.keys(deps).join(',')}}=globalThis.${key};\n${source}\n${suffix}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, jsxFactory: '__jsx' } }).outputText;
    return await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  } finally { delete globalThis[key]; }
}
function hooks() {
  const slots = [], effects = [];
  let cursor = 0;
  return {
    reset: () => { cursor = 0; }, effects,
    useId: () => 'transaction-test',
    useState: initial => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef: initial => { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect: effect => { effects.push(effect); },
  };
}
const jsx = (type, props, ...children) => {
  children = children.flat(Infinity).filter(child => child != null && child !== false);
  return typeof type === 'function' ? type({ ...props, children }) : { type, props: props || {}, children };
};
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap(nodes)];
const text = node => typeof node === 'string' ? node : node?.children?.map(text).join('') || '';
async function form(currency, initialData = null, overrides = {}) {
  const settings = { currency, rates: { ...rates }, ratesUpdatedAt: Date.now(), refresh: () => {}, ...overrides };
  const posts = [], closes = [];
  const transport = hooks(); let api;
  const apiModule = await load('src/hooks/useTransactions.ts', { ...transport, useFinance: () => ({ refresh: () => {} }), useResource: () => ({ data: null }), request: async (path, options) => { posts.push({ path, method: options.method, body: JSON.parse(options.body) }); } });
  const renderApi = () => { transport.reset(); api = apiModule.default(); };
  renderApi(); api.setEditingTransaction(initialData); renderApi();
  const state = hooks();
  const AmountInput = (await load('src/components/AmountInput.tsx', { __jsx: jsx })).default;
  const Modal = (await load('src/components/modals/TransactionModal.tsx', { ...state, __jsx: jsx, X: 'svg', SelectControl: 'select', AmountInput, UnknownWriteOutcomeError: class extends Error {}, ...money, ...quotes, localDate: () => '2026-10-26', useSettings: () => settings, CURRENCY_SYMBOLS: { USD: '$', EUR: '€', KZT: '₸', RUB: '₽' } })).default;
  const render = () => { state.reset(); return Modal({ isOpen: true, initialData, onClose: () => closes.push(true), onSubmit: value => initialData ? api.handleUpdateTransaction(value) : api.handleAddTransaction(value) }); };
  const find = (type, predicate = () => true) => { const result = nodes(render()).filter(n => n.type === type && predicate(n.props)); assert.equal(result.length, 1); return result[0]; };
  const input = name => find('input', p => name === 'amount' ? p.className?.includes('ui-amount-field') : p.id?.endsWith(`-${name}`) || name === 'date' && p.type === 'date');
  return { settings, posts, closes, render, find, input, change: (name, value) => input(name).props.onChange({ target: { value } }), setType: value => find('select', p => p['aria-label'] === 'Transaction type').props.onChange({ target: { value } }), submit: () => find('form').props.onSubmit({ preventDefault() {} }), error: () => nodes(render()).filter(n => n.props.role === 'alert').map(text).join(' ') };
}

for (const [currency, [local, expected]] of Object.entries(examples)) {
  test(`${currency} conversion uses exact decimal arithmetic and explicit 8-place rounding`, () => {
    assert.equal(money.toUSD(local, rates[currency], 'half-even'), expected);
  });
  for (const type of ['income', 'expense']) {
    test(`create ${type} in ${currency} sends the exact canonical USD POST`, async () => {
      const ui = await form(currency);
      ui.change('title', `Test ${type}`); ui.change('category', 'Synthetic'); ui.change('amount', local); ui.setType(type);
      await ui.submit();
      assert.equal(ui.posts.length, 1); assert.equal(ui.posts[0].method, 'POST');
      assert.equal(ui.posts[0].path, '/transactions');
      assert.deepEqual(ui.posts[0].body, { title: `Test ${type}`, type, category: 'Synthetic', transaction_date: '2026-10-26', amount_usd: expected });
      assert.equal(ui.closes.length, 1);
    });
  }
  test(`editing ${currency} amount sends one rounded USD PATCH`, async () => {
    const initial = { id: 'original', title: 'Original', category: 'Food', date: '2026-10-25', type: 'expense', amount: '1.23456789' };
    const ui = await form(currency, initial);
    ui.change('amount', local); await ui.submit();
    assert.equal(ui.posts[0].method, 'PATCH'); assert.equal(ui.posts[0].path, '/transactions/original');
    assert.equal(ui.posts[0].body.amount_usd, expected);
  });
  for (const field of ['title','category','date']) {
    test(`${currency} ${field}-only edit preserves original USD and omits amount_usd`, async () => {
      const initial = { id: 'original', title: 'Original', category: 'Food', date: '2026-10-25', type: 'expense', amount: '999999999999.99999999' };
      const ui = await form(currency, initial);
      ui.change(field, field === 'date' ? '2026-10-26' : 'Changed'); await ui.submit();
      assert.equal(ui.posts.length, 1); assert.equal('amount_usd' in ui.posts[0].body, false);
    });
  }
}

test('nearest/ties-to-even covers exact ties, both rounding directions and values beyond binary precision', () => {
  for (const [input, expected] of [['0.00000001','0.00000000'],['0.00000003','0.00000002'],['0.00000005','0.00000002'],['0.000000029999999999','0.00000001'],['0.000000030000000001','0.00000002']]) assert.equal(money.toUSD(input,'2','half-even'),expected);
  assert.equal(money.toUSD('474999999999999.99999525','475','half-even'),'999999999999.99999999');
  assert.equal(money.toUSD('0','0.92','half-even'),'0.00000000');
  assert.throws(() => money.toUSD('1','475'), /8 USD decimal/); // Unrelated strict callers retain their policy.
  for (const input of ['-1','-0','NaN','Infinity','1e3','1,000','','.1','1.',' 1 ','1000000000000']) assert.throws(() => money.toUSD(input,'1','half-even'));
  assert.throws(() => money.toUSD('999999999999.999999991','1','half-even'),/database limit/);
  for (const rate of [undefined,null,'','0','-1','NaN','Infinity','1e2',{},'0.0000000000000000001']) assert.throws(() => money.validateExchangeRate(rate));
});

test('touch/revert and equivalent formatting avoid reconversion, including exact long prefills', async () => {
  const initial = { id: 'tiny', title: 'Tiny', category: 'Food', date: '2026-10-25', type: 'income', amount: '0.00000001' };
  const ui = await form('EUR', initial);
  assert.equal(ui.input('amount').props.value, '0.0000000092');
  ui.change('amount','50'); ui.change('amount','000.000000009200');
  await ui.submit(); assert.equal('amount_usd' in ui.posts[0].body,false);
  for (let index=0;index<10;index++) { const repeat = await form('EUR', initial); repeat.change('title',`Name ${index}`); await repeat.submit(); assert.equal('amount_usd' in repeat.posts[0].body,false); }
});

test('quote and currency freeze at open; stale-at-submit blocks amount changes but never non-amount preservation', async () => {
  const ui = await form('EUR');
  ui.change('title','Frozen'); ui.change('category','Food'); ui.change('amount','1000');
  ui.settings.currency='KZT'; ui.settings.rates.EUR='2'; await ui.submit();
  assert.equal(ui.posts[0].body.amount_usd,'1086.95652174');
  const past = Date.now()-quotes.RATE_MAX_AGE_MS-1;
  const stale = await form('EUR', null, { ratesUpdatedAt: past }); stale.change('title','Stale'); stale.change('category','Food'); stale.change('amount','1000'); await stale.submit();
  assert.equal(stale.posts.length,0); assert.match(stale.error(),/stale/);
  const initial = {id:'1',title:'Original',category:'Food',date:'2026-10-25',type:'expense',amount:'123.45678901'};
  const edit = await form('EUR', initial, {ratesUpdatedAt:past}); edit.change('title','Still exact'); await edit.submit(); assert.equal('amount_usd' in edit.posts[0].body,false);
  const expiring = await form('EUR',null,{ratesUpdatedAt:Date.now()-quotes.RATE_MAX_AGE_MS+10000});
  expiring.change('title','Expired while open');expiring.change('category','Food');expiring.change('amount','1000');
  const originalNow=Date.now;try{Date.now=()=>originalNow()+20000;await expiring.submit();}finally{Date.now=originalNow;}
  assert.equal(expiring.posts.length,0);assert.match(expiring.error(),/stale/);
});

test('missing/invalid rates do not crash editing and cannot authorize an amount write', async () => {
  for (const invalid of [undefined,'0','-1','NaN']) {
    const ui=await form('EUR',null,{rates:{USD:'1',EUR:invalid}});ui.change('title','Blocked');ui.change('category','Food');ui.change('amount','1000');await ui.submit();assert.equal(ui.posts.length,0);assert.match(ui.error(),/rate/i);
    const initial={id:'1',title:'Original',category:'Food',date:'2026-10-25',type:'expense',amount:'123.45678901'};
    const edit=await form('EUR',initial,{rates:{USD:'1',EUR:invalid}});assert.equal(edit.input('amount').props.value,initial.amount);assert.match(text(edit.render()),/shown in USD/);edit.change('title','Preserved');await edit.submit();assert.equal('amount_usd' in edit.posts[0].body,false);
  }
  assert.equal(quotes.freshRate('USD',{},null),'1');
});

test('transaction validation rejects zero, negative, malformed, rounded-zero and out-of-range input without a request', async () => {
  for (const [currency,amount] of [['USD','0'],['USD','-1'],['USD','abc'],['USD','1.000000001'],['USD','1000000000000'],['KZT','0.00000001'],['EUR','-100'],['RUB','1e4']]) {
    const ui=await form(currency);ui.change('title','Invalid');ui.change('category','Food');ui.change('amount',amount);await ui.submit();assert.equal(ui.posts.length,0,`${currency} ${amount}`);assert.ok(ui.error());assert.equal(ui.input('amount').props['aria-invalid'],true);assert.equal(ui.closes.length,0);
  }
});

test('rate parsing preserves literal precision, validates provenance and refuses bad/stale caches', () => {
  const now=Date.now(),published=Math.floor(now/1000)*1000;
  const response=`{"result":"success","base_code":"USD","time_last_update_unix":${published/1000},"rates":{"USD":1,"EUR":0.123456789012345678,"KZT":475,"RUB":88}}`;
  const snapshot=quotes.parseRateResponse(response,now);
  assert.equal(snapshot.rates.EUR,'0.123456789012345678');
  assert.deepEqual(quotes.readRateCache({getItem:()=>JSON.stringify(snapshot)},now),snapshot);
  for (const cache of [rates,{...snapshot,publishedAt:now-quotes.RATE_MAX_AGE_MS-1},{...snapshot,publishedAt:now+1},{...snapshot,rates:{...rates,EUR:'0'}},{...snapshot,fetchedAt:now+1}]) assert.equal(quotes.readRateCache({getItem:()=>JSON.stringify(cache)},now),null);
  assert.equal(quotes.readRateCache({getItem:()=>{throw new Error('Blocked storage');}},now),null);
  for (const change of [s=>s.replace('"USD":1','"USD":2'),s=>s.replace('"base_code":"USD"','"base_code":"EUR"'),s=>s.replace(String(published/1000),String((published-quotes.RATE_MAX_AGE_MS-1000)/1000)),s=>s.replace('0.123456789012345678','null'),s=>s.replace('0.123456789012345678','1e-2')]) assert.throws(()=>quotes.parseRateResponse(change(response),now));
});

test('exact display formatting never rounds canonical storage or large aggregate integers through Number', () => {
  assert.equal(money.displayFromUSD('999999999999.99999999','475'),'474999999999999.99999525');
  assert.equal(money.formatDisplayDecimal(money.displayFromUSD('1000000000000000.00000001','0.92'),2).replace(/\s/g,''),'920000000000000,00');
  assert.equal(money.formatDisplayDecimal('-1.235',2),'-1,24');
  assert.equal(money.formatDisplayDecimal('0.005',2),'0,01');
});

test('amount control is labeled, ref/keyboard-transparent and compiles to one centered 44px surface in both themes', async () => {
  const Input=(await load('src/components/AmountInput.tsx',{__jsx:jsx})).default;
  let pressed;const ref={current:null};const tree=Input({currency:'KZT',symbol:'₸',id:'amount',value:'50000',ref,onKeyDown:e=>{pressed=e.key;}});
  const field=nodes(tree).find(n=>n.type==='input');assert.equal(field.props['aria-label'],'Amount (KZT)');assert.equal(field.props.ref,ref);field.props.onKeyDown({key:'Tab'});assert.equal(pressed,'Tab');assert.equal(tree.children[0].props['aria-hidden'],'true');
  const css=await readFile(new URL('../src/index.css',import.meta.url),'utf8');const {root}=await postcss([tailwind(config)]).process(css,{from:undefined});
  const rule=selector=>{const values={};root.walkRules(r=>{if(r.selector===selector)r.nodes.forEach(d=>{if(d.type==='decl')values[d.prop]=d.value;});});return values;};
  let mobileSymbolFont;root.walkRules(r=>{if(r.selector==='.ui-amount-input'&&r.parent.params==='(max-width: 767px)')mobileSymbolFont=r.nodes.find(d=>d.prop==='font-size')?.value;});assert.equal(mobileSymbolFont,'16px');
  const control=rule('.ui-amount-input');assert.equal(control.display,'flex');assert.equal(control['align-items'],'center');assert.equal(control.height,'44px');assert.equal(control.gap,'8px');assert.equal(control['border-radius'],'var(--radius-control)');assert.equal(rule('.ui-amount-symbol')['line-height'],'20px');assert.equal(rule('.ui-amount-input input.ui-amount-field').padding,'0');assert.equal(rule('.dark .ui-amount-input input.ui-amount-field').background,'transparent');
});

test('legacy chart presentation accepts small numeric exponents without floating-point currency arithmetic', () => {
  assert.equal(money.displayFromUSD(0.00000001,'0.92'),'0.0000000092');
  assert.equal(money.formatDisplayDecimal(money.displayFromUSD(0.00000001,'1'),2),'0,00');
  assert.equal(money.formatDisplayDecimal(money.displayFromUSD(0.1+0.2,'0.892628'),2),'0,27');
});

async function provider(cache, fetchRate, storageFailure = false) {
  const slots=[], pending=[], fetches=[], writes=[];let cursor=0;
  const storage={getItem:()=>cache ? JSON.stringify(cache) : null,setItem:(key,value)=>{writes.push({key,value});if(storageFailure)throw new Error('Quota exceeded');}};
  const deps={...quotes,localStorage:storage,FinanceContext:{Provider:'provider'},__jsx:jsx,
    useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
    useRef:initial=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useCallback:callback=>{cursor++;return callback;},
    useEffect:(callback,dependencies)=>{const i=cursor++;if(!slots[i]||dependencies.some((v,k)=>v!==slots[i].dependencies[k])){const old=slots[i];slots[i]={dependencies};pending.push(()=>{old?.cleanup?.();slots[i].cleanup=callback();});}},
    request:async(path,options)=>options?.method==='PATCH'?JSON.parse(options.body):{display_currency:'USD'},
    fetch:async(url,options)=>{fetches.push({url,options});return fetchRate();},
  };
  const {FinanceDataProvider}=await load('src/state/FinanceProvider.tsx',deps,'export { FinanceDataProvider };');
  const render=()=>{cursor=0;const tree=FinanceDataProvider({children:'Content'});while(pending.length)pending.shift()();return tree.props.value;};
  const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));return render();};
  const dispose=()=>slots.forEach(slot=>slot?.cleanup?.());
  return {render,settle,dispose,fetches,writes};
}
const rateResponse=()=>new Response(JSON.stringify({result:'success',base_code:'USD',time_last_update_unix:Math.floor(Date.now()/1000),rates}),{status:200});

test('rate provider fetches validated quotes without defaults and survives cache quota failures', async () => {
  for(const quota of [false,true]){
    const ui=await provider(null,rateResponse,quota);try{assert.deepEqual(ui.render().rates,{USD:'1'});await ui.settle();const state=await ui.settle();assert.deepEqual(state.rates,rates);assert.equal(state.ratesLoading,false);assert.equal(state.rateError,'');assert.equal(ui.fetches.length,1);assert.ok(ui.writes.every(w=>w.key==='finance_app_exchange_rates'));assert.equal(JSON.parse(ui.writes[0].value).rates.EUR,'0.92');}finally{ui.dispose();}
  }
});

test('missing/bad cache plus failed rate service fails closed for foreign conversions while USD stays usable', async () => {
  for(const cache of [null,rates,{rates,publishedAt:Date.now()-quotes.RATE_MAX_AGE_MS-1,fetchedAt:Date.now()}]){
    const ui=await provider(cache,()=>{throw new Error('Service offline');});try{ui.render();await ui.settle();const state=await ui.settle();assert.deepEqual(state.rates,{USD:'1'});assert.equal(state.ratesLoading,false);assert.match(state.rateError,/offline/);assert.equal(quotes.freshRate('USD',state.rates,state.ratesUpdatedAt),'1');assert.throws(()=>quotes.freshRate('EUR',state.rates,state.ratesUpdatedAt));assert.equal(ui.writes.length,0);}finally{ui.dispose();}
  }
});

test('rate provider rejects invalid HTTP data and never stores an unvalidated quote', async () => {
  for(const response of [()=>new Response('Unavailable',{status:503}),()=>new Response('{bad json'),()=>new Response(JSON.stringify({result:'success',base_code:'USD',time_last_update_unix:1,rates}))]){
    const ui=await provider(null,response);try{ui.render();await ui.settle();const state=await ui.settle();assert.deepEqual(state.rates,{USD:'1'});assert.ok(state.rateError);assert.equal(ui.writes.length,0);}finally{ui.dispose();}
  }
});

test('transaction dialog closes on Escape and explicitly restores a connected opener after React unmount', async () => {
  const state=hooks();let focused=0,opened=0,closed=0,canceled=0;
  class Element { isConnected=true; focus(){focused++;} }
  const opener=new Element(),doc={activeElement:opener};
  const Modal=(await load('src/components/modals/TransactionModal.tsx',{...state,__jsx:jsx,document:doc,HTMLElement:Element,X:'svg',SelectControl:'select',AmountInput:'input',UnknownWriteOutcomeError:class extends Error{},...money,...quotes,localDate:()=> '2026-10-26',useSettings:()=>({currency:'USD',rates:{USD:'1'},ratesUpdatedAt:null}),CURRENCY_SYMBOLS:{USD:'$'}})).default;
  const tree=Modal({isOpen:true,onClose:()=>{canceled++;},onSubmit:async()=>{}});
  assert.equal(tree.type,'dialog');
  const dialog={open:false,showModal(){opened++;this.open=true;},close(){closed++;this.open=false;}};
  tree.props.ref.current=dialog;
  const cleanup=state.effects[0]();assert.equal(opened,1);
  tree.props.onCancel({preventDefault(){assert.fail('Escape should close an idle form');}});assert.equal(canceled,1);
  const first={focus:()=>{doc.activeElement=first;}},last={focus:()=>{doc.activeElement=last;}};
  for(const [shiftKey,from,to] of [[true,first,last],[false,last,first]]){doc.activeElement=from;let prevented=false;tree.props.onKeyDown({key:'Tab',shiftKey,currentTarget:{querySelectorAll:()=>[first,last]},preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(doc.activeElement,to);}
  cleanup();assert.equal(closed,1);assert.equal(focused,1);
  opener.isConnected=false;state.effects[0]()();assert.equal(focused,1,'Disconnected previous-account controls must never regain focus');
});

test('shared settings formatting stays exact and never presents missing/stale quotes as current values', async () => {
  const state={currency:'EUR',rates:{...rates},ratesUpdatedAt:Date.now(),preferenceLoading:false,preferenceError:'',ratesLoading:false};
  const {useSettings}=await load('src/hooks/useSettings.ts',{...money,...quotes,useFinance:()=>state});
  assert.equal(useSettings().convertAmount('1000'),'920');assert.equal(useSettings().formatAmount('1000'),'€ 920,00');
  state.ratesUpdatedAt=Date.now()-quotes.RATE_MAX_AGE_MS-1;assert.ok(useSettings().preferenceError);assert.equal(useSettings().formatAmount('1000'),'€ —');assert.throws(()=>useSettings().toBaseCurrency('1000'));
  state.ratesLoading=true;state.rates={USD:'1'};state.ratesUpdatedAt=null;assert.equal(useSettings().preferenceLoading,false,'A pending rate service must not disable the USD currency escape');assert.match(useSettings().preferenceError,/loading/);
  state.currency='USD';state.rates={};assert.equal(useSettings().formatAmount('1000').replace(/\s/g,''),'$1000,00');assert.equal(useSettings().preferenceError,'');
});
