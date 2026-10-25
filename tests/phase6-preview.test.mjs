/** Import preview only, using actual modules with fake transport/file/React hooks. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

let serial=0;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
const counts={transactions:1,subscriptions:0,budget_profiles:0,preferences:0};
const response=()=>({validation_status:'valid',document_sha256:'a'.repeat(64),source:{format:'finance-dashboard',schema_version:1,exported_at:'2026-10-25T00:00:00Z',base_currency:'USD',counts},current:{counts:{transactions:2,subscriptions:3,budget_profiles:1,preferences:1}},replacement_impact:{would_remove:{transactions:2,subscriptions:3,budget_profiles:1,preferences:1},would_create:counts},warnings:[{code:'PREVIEW_ONLY',message:'Nothing is changed.'},{code:'REPLACE_ALL_DATA',message:'Future import would replace all data.'}]});
const rawDocument=' {"format":"finance-dashboard","schema_version":1,"exported_at":"2026-10-25T00:00:00Z","base_currency":"USD","data":{"transactions":[{"title":"Synthetic","amount_usd":"0.00000001","type":"income","category":"Synthetic","transaction_date":"2026-10-25"}],"subscriptions":[],"budget":null,"preferences":null}} ';
function file(raw=rawDocument){const bytes=new TextEncoder().encode(raw);return{size:bytes.byteLength,name:'synthetic.json',arrayBuffer:async()=>bytes.buffer,text:()=>{throw new Error('Must read bytes with fatal UTF8, never File.text');}};}

async function previewModule(send=async()=>Response.json(response())){
 let epoch=1;const calls=[];const key=`__preview${serial++}`;
 class SessionChangedError extends Error{}
 globalThis[key]={API_BASE_URL:'http://127.0.0.1:18085/api/v1',authenticatedFetch:async(...args)=>{calls.push(args);return send(...args);},getSessionEpoch:()=>epoch,SessionChangedError};
 try{
  let source=await readFile(new URL('../src/api/importPreview.ts',import.meta.url),'utf8');
  source=source.replace(/^import .*$/gm,'');
  source=`const {API_BASE_URL,authenticatedFetch,getSessionEpoch,SessionChangedError}=globalThis.${key};\n${source}`;
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const module=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  return{...module,calls,switchAccount:()=>{epoch++;},SessionChangedError};
 }finally{delete globalThis[key];}
}

test('preview posts exact original document string inside replace/v1 wrapper with no owner or mutation token',async()=>{
 const api=await previewModule();const controller=new AbortController();
 const value=await api.previewImportFile(file(),controller.signal);
 assert.deepEqual(value,response());assert.equal(api.calls.length,1);
 const [url,options]=api.calls[0];assert.equal(url,'http://127.0.0.1:18085/api/v1/data/import/preview');assert.equal(options.method,'POST');
 assert.deepEqual(JSON.parse(options.body),{mode:'replace',source_format:'v1',document:rawDocument});
 assert.equal(options.signal,controller.signal);assert.equal(new Headers(options.headers).get('Content-Type'),'application/json');
 assert.equal('preview_token' in value,false);assert.equal('receipt' in value,false);
});

test('oversize selected file is rejected before reading bytes or sending HTTP',async()=>{
 const api=await previewModule();let reads=0;
 await assert.rejects(api.previewImportFile({size:5*1024*1024+1,arrayBuffer:async()=>{reads++;throw new Error('Should not read');}}));
 assert.equal(reads,0);assert.equal(api.calls.length,0);
});

test('actual file bytes cannot bypass declared size',async()=>{
 const api=await previewModule();
 await assert.rejects(api.previewImportFile({size:1,arrayBuffer:async()=>new Uint8Array(5*1024*1024+1).buffer}));
 assert.equal(api.calls.length,0);
});

test('malformed UTF8 is rejected without replacement or HTTP',async()=>{
 const api=await previewModule();await assert.rejects(api.previewImportFile({size:1,arrayBuffer:async()=>new Uint8Array([0xff]).buffer}));
 assert.equal(api.calls.length,0);
});

test('switching accounts while bytes load prevents sending old account preview',async()=>{
 const bytes=deferred();const api=await previewModule();
 const pending=api.previewImportFile({size:10,arrayBuffer:()=>bytes.promise});const rejected=assert.rejects(pending,api.SessionChangedError);
 await tick();api.switchAccount();bytes.resolve(new TextEncoder().encode(rawDocument).buffer);await rejected;
 assert.equal(api.calls.length,0);
});

test('cancel while bytes load prevents sending preview even if File ignores abort',async()=>{
 const bytes=deferred();const api=await previewModule();const controller=new AbortController();
 const pending=api.previewImportFile({size:10,arrayBuffer:()=>bytes.promise},controller.signal);const rejected=assert.rejects(pending,error=>error.name==='AbortError');
 await tick();controller.abort();bytes.resolve(new TextEncoder().encode(rawDocument).buffer);await rejected;
 assert.equal(api.calls.length,0);
});

test('account switch during HTTP response body read discards stale summary',async()=>{
 const body=deferred();const api=await previewModule(async()=>({ok:true,json:()=>body.promise}));
 const pending=api.previewImportFile(file());const rejected=assert.rejects(pending,api.SessionChangedError);
 await tick();api.switchAccount();body.resolve(response());await rejected;assert.equal(api.calls.length,1);
});

for(const [name,send] of [['network',async()=>{throw new TypeError('offline');}],['validation',async()=>Response.json({detail:'Invalid import document'},{status:422})],['size',async()=>Response.json({detail:'Too large'},{status:413})],['invalid JSON',async()=>new Response('{')]]){
 test(`${name} failure never retries or sends an import/reset`,async()=>{const api=await previewModule(send);await assert.rejects(api.previewImportFile(file()));assert.equal(api.calls.length,1);assert.ok(api.calls[0][0].endsWith('/import/preview'));});
}

async function settingsHarness(){
 const slots=[],cleanup=[],calls=[];let cursor=0,epoch=1,mounted=true,staleWrites=0;
 const key=`__previewSettings${serial++}`;
 const deps={
  useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{if(!mounted)staleWrites++;slots[i]=value;}];},
  useRef:initial=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useEffect:callback=>{const i=cursor++;if(!(i in slots)){slots[i]=true;cleanup.push(callback());}},
  getSessionEpoch:()=>epoch,downloadAccountExport:async()=>{},
  previewImportFile:(selected,signal)=>{const pending=deferred();calls.push({selected,signal,...pending});return pending.promise;},
  useSettings:()=>({currency:'USD',setCurrency:()=>{},preferenceError:'',preferenceLoading:false,refresh:()=>{}}),CURRENCY_SYMBOLS:{USD:'$'},ResourceStatus:()=>null,
  __jsx:(type,props,...children)=>{
   if(typeof type==='function')return type(props||{});
   return{type,props:props||{},children:children.flat(Infinity).filter(item=>item!==false&&item!=null)};
  },
 };
 globalThis[key]=deps;
 async function load(path){
  let source=await readFile(new URL(path,import.meta.url),'utf8');
  const icons=source.match(/import \{([^}]+)\} from ["']lucide-react["'];?/)[1].split(',').map(value=>value.trim());
  source=source.replace(/^import .*$/gm,'');
  const names='useState,useRef,useEffect,getSessionEpoch,downloadAccountExport,previewImportFile,useSettings,CURRENCY_SYMBOLS,ResourceStatus,__jsx'+(path.includes('SettingsPage')?',DangerZone':'');
  source=`const {${names}}=globalThis.${key};\n${icons.map(name=>`const ${name}=${JSON.stringify(name)};`).join('\n')}\n${source}`;
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React,jsxFactory:'__jsx'}}).outputText;
  return(await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
 }
 try{
  deps.DangerZone=await load('../src/features/settings/DangerZone.tsx');
  const Settings=await load('../src/pages/SettingsPage.tsx');
  const nodes=()=>{cursor=0;const found=[];function visit(node){if(node&&typeof node==='object'){found.push(node);node.children?.forEach(visit);}}visit(Settings({}));return found;};
  const text=node=>node.children.map(child=>typeof child==='object'?text(child):String(child)).join('');
  const button=label=>{const list=nodes().filter(node=>node.type==='button'&&text(node).trim()===label);assert.equal(list.length,1);return list[0];};
  const select=selected=>{const input=nodes().find(node=>node.type==='input'&&node.props.type==='file');const target={files:[selected],value:'synthetic.json'};const result=input.props.onChange({currentTarget:target});assert.equal(target.value,'');return result;};
  return{nodes,text,button,select,calls,switchAccount:()=>{epoch++;},unmount:()=>{mounted=false;cleanup.forEach(fn=>fn?.());},staleWrites:()=>staleWrites};
 }finally{delete globalThis[key];}
}

test('Settings file selection previews counts and warnings while final import and reset stay disabled',async()=>{
 const view=await settingsHarness();
 assert.equal(view.button('Confirm Import (unavailable)').props.disabled,true);
 assert.equal(view.button('Reset All Data').props.disabled,true);
 assert.equal(view.button('Import Backup').props.type,'button');
 const selected=file();const pending=view.select(selected);
 assert.equal(view.calls.length,1);assert.equal(view.calls[0].selected,selected);
 assert.ok(view.nodes().some(node=>node.props.role==='status'&&view.text(node).includes('Validating')));
 view.calls[0].resolve(response());await pending;
 const text=view.nodes().map(view.text).join(' ');
 assert.ok(text.includes('a'.repeat(64))&&text.includes('No account data was changed.'));
 assert.ok(text.includes('Would remove')&&text.includes('Would create'));
 assert.ok(text.includes('Future import would replace all data.'));
 assert.equal(view.button('Confirm Import (unavailable)').props.disabled,true);
 view.unmount();
});

test('new file selection aborts previous operation and stale response cannot replace current preview',async()=>{
 const view=await settingsHarness();
 const old=view.select(file('old')), latest=view.select(file('new'));
 assert.equal(view.calls.length,2);assert.equal(view.calls[0].signal.aborted,true);
 view.calls[1].resolve(response());await latest;
 view.calls[0].resolve({...response(),document_sha256:'b'.repeat(64)});await old;
 const text=view.nodes().map(view.text).join(' ');
 assert.ok(text.includes('a'.repeat(64))&&!text.includes('b'.repeat(64)));
 view.unmount();
});

test('cancel clears preview and stale failure cannot show an error',async()=>{
 const view=await settingsHarness();const pending=view.select(file());
 view.button('Cancel preview').props.onClick();
 assert.equal(view.calls[0].signal.aborted,true);
 view.calls[0].reject(new Error('stale sensitive failure'));await pending;
 assert.ok(!view.nodes().some(node=>node.props.role==='alert'));
 assert.ok(!view.nodes().map(view.text).join(' ').includes('a'.repeat(64)));
 view.unmount();
});

test('logout/account epoch change prevents stale preview summary',async()=>{
 const view=await settingsHarness();const pending=view.select(file());view.switchAccount();
 view.calls[0].resolve(response());await pending;
 assert.ok(!view.nodes().map(view.text).join(' ').includes('a'.repeat(64)));
 view.unmount();
});

test('unmount aborts pending preview and suppresses all later state updates',async()=>{
 const view=await settingsHarness();const pending=view.select(file());view.unmount();
 assert.equal(view.calls[0].signal.aborted,true);view.calls[0].resolve(response());await pending;
 assert.equal(view.staleWrites(),0);
});

test('file read/validation failure is visible and clears loading without enabling confirmation',async()=>{
 const view=await settingsHarness();const pending=view.select(file());
 view.calls[0].reject(new Error('Synthetic invalid backup'));await pending;
 assert.ok(view.nodes().some(node=>node.props.role==='alert'&&view.text(node)==='Synthetic invalid backup'));
 assert.ok(!view.nodes().some(node=>node.props.role==='status'&&view.text(node).includes('Validating')));
 assert.equal(view.button('Confirm Import (unavailable)').props.disabled,true);view.unmount();
});

test('file BOM/duplicate keys are forwarded intact for strict server validation, not silently rewritten',async()=>{
 for(const raw of ['\ufeff{}','{"a":1,"a":2}']){
  const api=await previewModule(async()=>Response.json({detail:'Invalid'},{status:422}));
  await assert.rejects(api.previewImportFile(file(raw)));
  assert.equal(JSON.parse(api.calls[0][1].body).document,raw);
 }
});

test('outer JSON expansion cannot exceed ten MiB even for five MiB raw input',async()=>{
 const api=await previewModule();const raw='"'.repeat(5*1024*1024);
 await assert.rejects(api.previewImportFile(file(raw)));assert.equal(api.calls.length,0);
});

test('empty file validation error cannot echo server-supplied contents',async()=>{
 const marker='SYNTHETIC_PRIVATE_MARKER';
 const api=await previewModule(async()=>Response.json({detail:marker},{status:422}));
 await assert.rejects(api.previewImportFile(file('')),error=>!error.message.includes(marker));
 assert.equal(JSON.parse(api.calls[0][1].body).document,'');
});
