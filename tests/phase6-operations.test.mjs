/** Execute actual operation state/transport with fake HTTP; no network or browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

let serial=0;
const digest='d'.repeat(64);
const keyA='4ec4ad36-673b-47cb-80ae-9740cc5b49ae';
const keyB='ab19de94-2c99-4ad3-ac6a-34e55ed6707f';
const userA={id:'b1c786c4-efca-480b-b964-c872e5700587',email:'synthetic@example.test'};
const zero={transactions:0,subscriptions:0,budget_profiles:0,preferences:0};
function receipt({key=keyA,kind='reset',sha=null}={}){return{idempotency_key:key,operation:kind,status:'completed',completed_at:'2026-10-25T00:00:00Z',document_sha256:sha,removed:zero,created:zero};}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const command=(extra={})=>({kind:'reset',key:keyA,previewToken:'synthetic-preview-token',expiresAt:new Date(Date.now()+600000).toISOString(),password:'synthetic-password',confirmation:'RESET MY FINANCIAL DATA',...extra});

async function operations(send=async()=>Response.json(receipt())){
 let epoch=1,user=userA;const calls=[];const name=`__operations${serial++}`;
 class SessionChangedError extends Error{}
 const deps={API_BASE_URL:'http://127.0.0.1:18085/api/v1',getSessionEpoch:()=>epoch,getAuthSnapshot:()=>({user,status:user?'authenticated':'anonymous',epoch,error:''}),SessionChangedError,
  authenticatedFetch:async(...args)=>{calls.push(args);return send(...args);},
  readImportDocument:async file=>new TextDecoder().decode(await file.arrayBuffer()),
 };
 globalThis[name]=deps;
 try{
  const source=await readFile(new URL('../src/api/dataOperations.ts',import.meta.url),'utf8');
  let code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  code=code.replace(/^import .*;$/gm,'');
  code=`const {API_BASE_URL,getSessionEpoch,getAuthSnapshot,SessionChangedError,authenticatedFetch,readImportDocument}=globalThis.${name};\n${code}`;
  const module=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  return{...module,calls,setAccount:next=>{epoch++;user=next;},current:()=>module.getDataOperationState(user?.id||'anonymous')};
 }finally{delete globalThis[name];}
}

test('completed reset sends one explicit authenticated command and clears metadata only on matching receipt',async()=>{
 const api=await operations();
 assert.equal(await api.dispatchDataOperation(command()),'completed');
 assert.equal(api.calls.length,1);
 const [url,options]=api.calls[0];assert.equal(url,'http://127.0.0.1:18085/api/v1/data/reset');
 assert.equal(options.method,'POST');assert.equal(options.signal,undefined);
 assert.equal(new Headers(options.headers).get('Idempotency-Key'),keyA);
 assert.equal(new Headers(options.headers).get('X-CSRF-Protection'),'1');
 assert.deepEqual(JSON.parse(options.body),{preview_token:'synthetic-preview-token',password:'synthetic-password',confirmation:'RESET MY FINANCIAL DATA'});
 assert.equal(api.current().operation,null);assert.ok(api.current().revision>0);
});

test('pending metadata contains no password/token/document and blocks another command',async()=>{
 const pending=deferred();const api=await operations(()=>pending.promise);
 const first=api.dispatchDataOperation(command());await tick();
 const state=api.current();assert.equal(state.operation.status,'pending');
 assert.deepEqual(Object.keys(state.operation).sort(),['documentSha256','key','kind','status','userId']);
 assert.ok(!JSON.stringify(state).includes('synthetic-password')&&!JSON.stringify(state).includes('synthetic-preview-token'));
 await assert.rejects(api.dispatchDataOperation(command({key:keyB})));
 assert.equal(api.calls.length,1);pending.resolve(Response.json(receipt()));assert.equal(await first,'completed');
});

test('network loss is unknown and GET404 never clears the blocked operation',async()=>{
 const api=await operations(async url=>{if(url.includes('/operations/'))return Response.json({code:'OPERATION_NOT_OBSERVED',detail:'Not observed'},{status:404});throw new TypeError('lost acknowledgement');});
 assert.equal(await api.dispatchDataOperation(command()),'unknown');
 assert.equal(api.current().operation.status,'unknown');
 assert.equal(await api.checkDataOperationStatus(),'unknown');
 assert.equal(api.current().operation.key,keyA);
 assert.equal(api.calls.length,2);assert.ok(api.calls[1][0].endsWith(`/data/operations/${keyA}`));
});

for(const [code,status] of [['CONFIRMATION_FAILED',403],['PREVIEW_EXPIRED',409],['STATE_CHANGED',409],['PREVIEW_USED',409],['IDEMPOTENCY_CONFLICT',409],['INVALID_REQUEST',422],['DATA_OPERATIONS_UNAVAILABLE',503],['OPERATION_OUTCOME_UNKNOWN',503]]){
 test(`earlier unknown remains sticky after same-key retry ${code}`,async()=>{
  let calls=0;const api=await operations(async()=>{if(calls++===0)throw new TypeError('lost');return Response.json({code,detail:'Synthetic rejection'},{status});});
  assert.equal(await api.dispatchDataOperation(command()),'unknown');
  assert.equal(await api.dispatchDataOperation(command()),'unknown');
  assert.equal(api.current().operation.status,'unknown');assert.equal(api.current().operation.key,keyA);
  assert.equal(api.calls.length,2);
 });
}

test('initial definite pre-write failure clears gate but retains safe static notice',async()=>{
 const api=await operations(async()=>Response.json({code:'DATA_OPERATIONS_UNAVAILABLE',detail:'Unavailable'},{status:503}));
 assert.equal(await api.dispatchDataOperation(command()),'rejected');
 assert.equal(api.current().operation,null);assert.equal(api.current().notice.code,'DATA_OPERATIONS_UNAVAILABLE');
});

for(const [name,bad] of [['key',receipt({key:keyB})],['kind',receipt({kind:'import_replace',sha:digest})],['document',receipt({sha:digest})]]){
 test(`wrong ${name} receipt never certifies completion`,async()=>{
  const api=await operations(async()=>Response.json(bad));
  assert.equal(await api.dispatchDataOperation(command()),'unknown');
  assert.equal(api.current().operation.status,'unknown');
 });
}

test('matching status receipt resolves unknown without replaying any write',async()=>{
 const api=await operations(async url=>{if(url.includes('/operations/'))return Response.json(receipt());throw new TypeError('lost');});
 await api.dispatchDataOperation(command());assert.equal(await api.checkDataOperationStatus(),'completed');
 assert.equal(api.current().operation,null);
 assert.equal(api.calls.filter(([,options])=>options?.method==='POST').length,1);
});

test('logout/account switch hides metadata from other account but original user unresolved state survives in memory',async()=>{
 const api=await operations(async()=>{throw new TypeError('lost');});await api.dispatchDataOperation(command());
 api.setAccount(null);assert.equal(api.getDataOperationState('anonymous').operation,null);
 api.setAccount({id:'other-user',email:'other@example.test'});assert.equal(api.current().operation,null);
 api.setAccount(userA);assert.equal(api.current().operation.key,keyA);assert.equal(api.current().operation.status,'unknown');
});

test('unknown prevents new key even after initial dispatch component is gone',async()=>{
 const api=await operations(async()=>{throw new TypeError('lost');});await api.dispatchDataOperation(command());
 await assert.rejects(api.dispatchDataOperation(command({key:keyB})));
 assert.equal(api.calls.length,1);assert.equal(api.current().operation.key,keyA);
});

async function importCommand(extra={}){
 const document=' {"amount_usd":"999999999999.99999999","title":"Synthetic 😀"} ';
 const bytes=new TextEncoder().encode(document);
 const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
 return{document,sha,input:command({kind:'import_replace',confirmation:'REPLACE MY FINANCIAL DATA',file:{size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer},documentSha256:sha,...extra})};
}

test('import sends original document and exact money strings and accepts only matching digest receipt',async()=>{
 const value=await importCommand();const api=await operations(async()=>Response.json(receipt({kind:'import_replace',sha:value.sha})));
 assert.equal(await api.dispatchDataOperation(value.input),'completed');
 const [url,options]=api.calls[0];assert.ok(url.endsWith('/data/import'));
 const body=JSON.parse(options.body);assert.equal(body.document,value.document);
 assert.equal(body.mode,'replace');assert.equal(body.source_format,'v1');assert.equal(options.signal,undefined);
 assert.equal(api.current().operation,null);
});

test('unknown import refuses a different document before any second write',async()=>{
 const value=await importCommand();const api=await operations(async()=>{throw new TypeError('lost');});
 assert.equal(await api.dispatchDataOperation(value.input),'unknown');
 const changed=await importCommand({file:{size:1,arrayBuffer:async()=>new TextEncoder().encode('changed').buffer}});
 await assert.rejects(api.dispatchDataOperation(changed.input),error=>error.code==='FILE_CHANGED');
 assert.equal(api.calls.length,1);assert.equal(api.current().operation.documentSha256,value.sha);assert.equal(api.current().operation.status,'unknown');
});

for(const [name,change,code] of [['password',{password:''},'CONFIRMATION_REQUIRED'],['phrase',{confirmation:'reset'},'CONFIRMATION_REQUIRED'],['expired preview',{expiresAt:'2000-01-01T00:00:00Z'},'PREVIEW_EXPIRED'],['key',{key:'not-a-uuid'},'INVALID_KEY']]){
 test(`local ${name} guard does not dispatch or reserve operation`,async()=>{
  const api=await operations();await assert.rejects(api.dispatchDataOperation(command(change)),error=>error.code===code);
  assert.equal(api.calls.length,0);assert.equal(api.current().operation,null);
 });
}

test('unclassified server failure remains unknown on initial attempt',async()=>{
 const api=await operations(async()=>Response.json({detail:'Synthetic internal error'},{status:500}));
 assert.equal(await api.dispatchDataOperation(command()),'unknown');assert.equal(api.current().operation.status,'unknown');
});

test('account switch after write dispatch cannot certify success for new account',async()=>{
 const pending=deferred();const api=await operations(()=>pending.promise);
 const writing=api.dispatchDataOperation(command());await tick();api.setAccount({id:'other-user',email:'other@example.test'});
 pending.resolve(Response.json(receipt()));assert.equal(await writing,'unknown');
 assert.equal(api.current().operation,null);api.setAccount(userA);assert.equal(api.current().operation.status,'unknown');
});

test('two import file reads completing together reserve only one operation key',async()=>{
 const bytes=deferred();const value=await importCommand();const pendingHTTP=deferred();const api=await operations(()=>pendingHTTP.promise);
 const file={size:1,arrayBuffer:()=>bytes.promise};
 const first=api.dispatchDataOperation({...value.input,file});const second=api.dispatchDataOperation({...value.input,file,key:keyB});
 // Independent async digests may finish in either order; the invariant is one reservation/write.
 const results=[first,second].map(promise=>promise.then(value=>({status:'fulfilled',value}),error=>({status:'rejected',error})));
 bytes.resolve(new TextEncoder().encode(value.document).buffer);
 const rejected=await Promise.race(results);assert.equal(rejected.status,'rejected');assert.equal(rejected.error.code,'OPERATION_PENDING');
 assert.equal(api.calls.length,1);
 const winningKey=new Headers(api.calls[0][1].headers).get('Idempotency-Key');assert.ok([keyA,keyB].includes(winningKey));
 pendingHTTP.resolve(Response.json(receipt({key:winningKey,kind:'import_replace',sha:value.sha})));
 const settled=await Promise.all(results);assert.equal(settled.filter(result=>result.status==='fulfilled'&&result.value==='completed').length,1);assert.equal(settled.filter(result=>result.status==='rejected'&&result.error.code==='OPERATION_PENDING').length,1);assert.equal(api.calls.length,1);
});

async function dialogHarness(){
 const slots=[],effects=[],timers=[],calls=[];let cursor=0,closed=0,modalOpened=0;
 const previousTimeout=globalThis.setTimeout,previousClear=globalThis.clearTimeout;
 globalThis.setTimeout=(callback,delay)=>{const timer={callback,delay};timers.push(timer);return timer;};globalThis.clearTimeout=timer=>{if(timer)timer.cancelled=true;};
 const props={kind:'reset',initialPreview:{validation_status:'valid',current:{counts:zero},replacement_impact:{would_remove:zero,would_create:zero},warnings:[],preview_token:'synthetic-token',expires_at:new Date(Date.now()+600000).toISOString()},onClose:()=>{closed++;}};
 const key=`__dialog${serial++}`;const dispatched=deferred();
 const deps={
  useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
  useRef:initial=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useEffect:(callback,dependencies)=>{const i=cursor++;if(!slots[i]||dependencies.some((value,index)=>value!==slots[i].dependencies[index])){const old=slots[i];slots[i]={dependencies};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=callback();});}},
  useAuth:()=>({logout:async()=>{}}),getSessionEpoch:()=>1,previewImportFile:async()=>props.initialPreview,fetchResetPreview:async()=>props.initialPreview,checkDataOperationStatus:async()=>'unknown',
  dispatchDataOperation:input=>{calls.push(input);return dispatched.promise;},
  __jsx:(type,p,...children)=>{if(type==='dialog'&&p.ref)p.ref.current={showModal:()=>{modalOpened++;},close:()=>{}};return{type,props:p||{},children:children.flat(Infinity).filter(value=>value!==false&&value!=null)};},
 };
 globalThis[key]=deps;
 try{
  const source=await readFile(new URL('../src/components/DataConfirmationDialog.tsx',import.meta.url),'utf8');
  let code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React,jsxFactory:'__jsx'}}).outputText.replace(/^import .*;$/gm,'');
  code=`const {useState,useRef,useEffect,useAuth,getSessionEpoch,previewImportFile,fetchResetPreview,checkDataOperationStatus,dispatchDataOperation,__jsx}=globalThis.${key};\n${code}`;
  const {DataConfirmationDialog}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const nodes=()=>{cursor=0;const list=[];function visit(node){if(node&&typeof node==='object'){list.push(node);node.children?.forEach(visit);}}visit(DataConfirmationDialog(props));while(effects.length)effects.shift()();return list;};
  const text=node=>node.children.map(child=>typeof child==='object'?text(child):String(child)).join('');
  const input=type=>nodes().find(node=>node.type==='input'&&node.props.type===type);
  return{nodes,input,calls,timers,dispatched,closed:()=>closed,modalOpened:()=>modalOpened,submit:()=>nodes().find(node=>node.type==='form').props.onSubmit({preventDefault(){}}),button:label=>nodes().find(node=>node.type==='button'&&text(node).trim()===label),cleanup:()=>{for(const slot of slots)slot?.cleanup?.();globalThis.setTimeout=previousTimeout;globalThis.clearTimeout=previousClear;}};
 }catch(error){globalThis.setTimeout=previousTimeout;globalThis.clearTimeout=previousClear;throw error;}finally{delete globalThis[key];}
}

test('confirmation dialog never auto-dispatches and requires password plus exact typed phrase',async()=>{
 const view=await dialogHarness();try{
  view.nodes();assert.equal(view.modalOpened(),1);assert.equal(view.calls.length,0);
  assert.equal(view.input('password').props.type,'password');assert.equal(view.input('password').props.autoComplete,'current-password');
  await view.submit();assert.equal(view.calls.length,0);
  view.input('password').props.onChange({target:{value:'synthetic-password'}});
  view.input('text').props.onChange({target:{value:'wrong'}});await view.submit();assert.equal(view.calls.length,0);
  view.input('text').props.onChange({target:{value:'RESET MY FINANCIAL DATA'}});
  const pending=view.submit();assert.equal(view.calls.length,1);assert.equal(view.input('password').props.value,'');assert.equal(view.input('text').props.value,'');
  assert.equal(view.calls[0].confirmation,'RESET MY FINANCIAL DATA');assert.ok(view.calls[0].preDispatchSignal instanceof AbortSignal);
  view.dispatched.resolve('completed');await pending;assert.equal(view.closed(),1);
 }finally{view.cleanup();}
});

test('confirmation preview expiry clears password, phrase and authorization without dispatch',async()=>{
 const view=await dialogHarness();try{
  view.nodes();view.input('password').props.onChange({target:{value:'synthetic-password'}});view.input('text').props.onChange({target:{value:'RESET MY FINANCIAL DATA'}});
  const expiry=view.timers.find(timer=>timer.delay>0);assert.ok(expiry);expiry.callback();
  assert.equal(view.input('password').props.value,'');assert.equal(view.input('text').props.value,'');assert.equal(view.input('password').props.disabled,true);
  await view.submit();assert.equal(view.calls.length,0);
 }finally{view.cleanup();}
});

test('financial provider outer gate removes complete inner provider while pending or unknown and remounts by revision',async()=>{
 let state={operation:null,revision:0,notice:null};const key=`__outer${serial++}`;
 globalThis[key]={useAuth:()=>({user:userA}),useSyncExternalStore:(_subscribe,get)=>get(),getDataOperationState:()=>state,subscribeDataOperations:()=>()=>{},dismissDataOperationNotice:()=>{},DataOperationGate:'operation-gate',FinanceContext:{Provider:'context'},__jsx:(type,props,...children)=>({type,props:props||{},children}),__fragment:'fragment'};
 try{
  const source=await readFile(new URL('../src/state/FinanceProvider.tsx',import.meta.url),'utf8');
  let code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React,jsxFactory:'__jsx',jsxFragmentFactory:'__fragment'}}).outputText.replace(/^import .*;$/gm,'');
  code=`const {useAuth,useSyncExternalStore,getDataOperationState,subscribeDataOperations,dismissDataOperationNotice,DataOperationGate,FinanceContext,__jsx,__fragment}=globalThis.${key};\n${code}`;
  const {FinanceProvider}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const normal=FinanceProvider({children:'financial-forms'});assert.equal(normal.type,'fragment');
  for(const status of ['pending','unknown']){state={...state,operation:{key:keyA,kind:'reset',userId:userA.id,documentSha256:null,status}};const gated=FinanceProvider({children:'financial-forms'});assert.equal(gated.type,'operation-gate');assert.equal(gated.props.operation.status,status);assert.ok(!gated.children.includes('financial-forms'));}
  state={operation:null,revision:1,notice:null};const completed=FinanceProvider({children:'financial-forms'});
  const inner=completed.children.find(child=>child&&typeof child.type==='function');assert.equal(inner.props.key,1);
 }finally{delete globalThis[key];}
});

for(const status of [201,202]){
 test(`HTTP${status} receipt cannot certify an operation that requires exact200`,async()=>{
  const api=await operations(async()=>Response.json(receipt(),{status}));assert.equal(await api.dispatchDataOperation(command()),'unknown');assert.equal(api.current().operation.status,'unknown');
 });
}
