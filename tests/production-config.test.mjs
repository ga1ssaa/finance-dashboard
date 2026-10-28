import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { validateApiBaseUrl } from '../src/api/apiConfig.ts';

const app = 'https://app.synthetic-avero.me';
const api = 'https://api.synthetic-avero.me/api/v1';

test('shared endpoint validation allows loopback development and same-site HTTPS production', () => {
  for (const base of ['http://127.0.0.1:8000/api/v1','http://localhost:8000/api/v1','https://[::1]:8000/api/v1']) assert.equal(validateApiBaseUrl(base,'','http://localhost:5173').href,base);
  assert.equal(validateApiBaseUrl(api,app,app).href,api);
  assert.equal(validateApiBaseUrl('https://synthetic-avero.me/api/v1','https://synthetic-avero.me','https://synthetic-avero.me').hostname,'synthetic-avero.me');
});

for (const [url,origin,page] of [
  [api,'',app],[api,app,'https://preview.vercel.app'],
  ['http://api.synthetic-avero.me/api/v1',app,app],
  ['https://api.other.me/api/v1',app,app],
  ['https://api.synthetic-avero.me.evil.test/api/v1',app,app],
  ['https://api.synthetic-avero.me:8443/api/v1',app,app],
  ['https://user:secret@api.synthetic-avero.me/api/v1',app,app],
  [api+'?token=private',app,app],[api+'#fragment',app,app],[api+'/other',app,app],
  ['http://127.0.0.1:8000/api/v1','',app],
  ['https://test.herokuapp.com/api/v1','https://test.vercel.app','https://test.vercel.app'],
  [api,app+'/path',app], [api,'http://app.synthetic-avero.me',app],
]) test(`unsafe frontend endpoint configuration rejected: ${url} / ${origin} / ${page}`,()=>{
  assert.throws(()=>validateApiBaseUrl(url,origin,page));
});

test('actual production auth module preserves credential/CSRF, rotation and logout transport', async () => {
  let source = await readFile(new URL('../src/api/authSession.ts',import.meta.url),'utf8');
  source=source.replace(/^import .*$/m,'');
  const key='__productionAuthConfig';
  globalThis[key]=value=>validateApiBaseUrl(value,app,app);
  const code=ts.transpileModule(`const validateApiBaseUrl=globalThis.${key};\n${source}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const auth=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  delete globalThis[key];auth.configureAuthApi(api);
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return url.endsWith('/logout')?new Response(null,{status:204}):Response.json({user:{id:'synthetic-user',email:'synthetic@example.test'},access_token:'synthetic-token',token_type:'bearer',expires_in:300});};
  try {
    await auth.login('synthetic@example.test','synthetic-password');
    await auth.restoreSession();await auth.logout();
    assert.deepEqual(calls.map(c=>c.url),['auth/login','auth/refresh','auth/logout'].map(path=>api+'/'+path));
    assert.ok(calls.every(c=>c.options.credentials==='include'&&c.options.headers['X-CSRF-Protection']==='1'));
    assert.equal(auth.getAuthSnapshot().status,'anonymous');
  } finally {globalThis.fetch=original;}
});

test('Vercel retains SPA routes and uses the existing Vite production build',async()=>{
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.equal(config.framework,'vite');assert.equal(config.buildCommand,'npm run build');assert.equal(config.outputDirectory,'dist');
  assert.deepEqual(config.rewrites,[{source:'/(.*)',destination:'/index.html'}]);
});

test('registered getavero.app apex and API subdomain are compatible without changing local development',()=>{
  assert.equal(validateApiBaseUrl('https://api.getavero.app/api/v1','https://getavero.app','https://getavero.app').href,'https://api.getavero.app/api/v1');
  assert.equal(validateApiBaseUrl('http://127.0.0.1:8000/api/v1','','http://127.0.0.1:5173').href,'http://127.0.0.1:8000/api/v1');
});

for(const [endpoint,origin,page] of [
  ['https://api.getavero.app/api/v1','','https://getavero.app'],
  ['http://api.getavero.app/api/v1','https://getavero.app','https://getavero.app'],
  ['https://api.other.app/api/v1','https://getavero.app','https://getavero.app'],
  ['https://api.getavero.app.evil.app/api/v1','https://getavero.app','https://getavero.app'],
  ['https://api.notgetavero.app/api/v1','https://getavero.app','https://getavero.app'],
  ['https://api.getavero.me/api/v1','https://getavero.app','https://getavero.app'],
  ['https://api.getavero.app:8443/api/v1','https://getavero.app','https://getavero.app'],
  ['https://user:synthetic@api.getavero.app/api/v1','https://getavero.app','https://getavero.app'],
  ['https://api.getavero.app/api/v1?x=1','https://getavero.app','https://getavero.app'],
  ['https://api.getavero.app/api/v1#x','https://getavero.app','https://getavero.app'],
  ['https://api.getavero.app/api/v1','https://getavero.app/','https://getavero.app'],
  ['https://api.getavero.app/api/v1','http://getavero.app','https://getavero.app'],
  ['https://api.getavero.app/api/v1','https://getavero.app','https://www.getavero.app'],
  ['https://api.getavero.app/api/v1','https://getavero.app','https://preview.vercel.app'],
])test(`getavero.app refuses unapproved endpoint/origin: ${endpoint} / ${origin} / ${page}`,()=>{
  assert.throws(()=>validateApiBaseUrl(endpoint,origin,page));
});
