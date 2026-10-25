/** Controlled browser ports exercise actual frontend code; native picker/decoder rendering needs browser QA. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { MAX_AVATAR_BYTES, avatarStorageKey, prepareAvatar, readAvatar, removeAvatar, saveAvatar } from '../src/utils/avatar.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+afooAAAAASUVORK5CYII=';
const pngBytes = Buffer.from(PNG.split(',')[1], 'base64');
const userA = { id: 'user-A', email: 'a@example.test' };
const userB = { id: 'user-B', email: 'b@example.test' };
function memoryStorage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
async function withGlobals(values, run) {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    return await run();
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}
function imagePorts(options = {}) {
  const calls = { decode: [], draw: [], release: 0 };
  return {
    calls,
    createImageBitmap: async blob => {
      calls.decode.push(blob.type);
      if (options.decodeError) throw new Error('Synthetic decoder failure');
      return { width: options.width ?? 640, height: 480, close: () => { calls.release++; } };
    },
    document: { createElement: tag => {
      assert.equal(tag, 'canvas');
      return {
        getContext: () => ({ drawImage: (...args) => { calls.draw.push(args); if (options.drawError) throw new Error('Synthetic canvas failure'); } }),
        toDataURL: type => { assert.equal(type, 'image/png'); return PNG; },
      };
    } },
  };
}

test('JPEG, PNG and WebP are detected by bytes, decoded and normalized; bitmap resources are released', async () => {
  const webp = Buffer.alloc(16);
  webp.write('RIFF'); webp.writeUInt32LE(8, 4); webp.write('WEBP', 8);
  for (const [bytes, expected] of [[pngBytes, 'image/png'], [Buffer.from([255,216,255,224]), 'image/jpeg'], [webp, 'image/webp']]) {
    const ports = imagePorts();
    await withGlobals(ports, async () => {
      // Filename and declared MIME are deliberately misleading: actual bytes decide the format.
      assert.equal(await prepareAvatar(new File([bytes], 'renamed.txt', { type: 'text/plain' })), PNG);
      assert.deepEqual(ports.calls.decode, [expected]);
      assert.equal(ports.calls.draw.length, 1);
      assert.deepEqual(ports.calls.draw[0].slice(1), [80, 0, 480, 480, 0, 0, 256, 256]);
      assert.equal(ports.calls.release, 1);
    });
  }
});

test('renamed SVG/GIF, empty and corrupt images are refused before storage', async () => {
  const ports = imagePorts();
  await withGlobals(ports, async () => {
    for (const bytes of ['<svg xmlns="http://www.w3.org/2000/svg"/>', 'GIF89a', '', 'not an image']) {
      await assert.rejects(prepareAvatar(new File([bytes], 'fake.png', { type: 'image/png' })), /JPEG, PNG or WebP/);
    }
    assert.equal(ports.calls.decode.length, 0);
  });
  const broken = imagePorts({ decodeError: true });
  await withGlobals(broken, async () => {
    await assert.rejects(prepareAvatar(new File([pngBytes], 'truncated.png')), /could not be decoded/);
    assert.equal(broken.calls.draw.length, 0);
  });
});

test('oversized files fail before reading; actual byte count cannot bypass the 2 MB limit', async () => {
  let reads = 0;
  await assert.rejects(prepareAvatar({ size: MAX_AVATAR_BYTES + 1, arrayBuffer: () => { reads++; } }), /2 MB/);
  assert.equal(reads, 0);
  await assert.rejects(prepareAvatar({ size: 1, arrayBuffer: async () => new ArrayBuffer(MAX_AVATAR_BYTES + 1) }), /2 MB/);
});

test('decoding cleanup runs on canvas failure and excessive decoded dimensions', async () => {
  for (const options of [{ drawError: true }, { width: 9000 }]) {
    const ports = imagePorts(options);
    await withGlobals(ports, async () => {
      await assert.rejects(prepareAvatar(new File([pngBytes], 'image.png')));
      assert.equal(ports.calls.release, 1);
    });
  }
});

test('Image fallback revokes object URLs after successful and failed decoding', async () => {
  for (const fail of [false, true]) {
    const ports = imagePorts();
    const revoked = [];
    class FakeImage {
      naturalWidth = 640;
      naturalHeight = 480;
      set src(value) {
        assert.equal(value, 'blob:avatar-test');
        queueMicrotask(() => fail ? this.onerror?.() : this.onload?.());
      }
    }
    await withGlobals({ ...ports, createImageBitmap: undefined, Image: FakeImage, URL: { createObjectURL: () => 'blob:avatar-test', revokeObjectURL: url => revoked.push(url) } }, async () => {
      const result = prepareAvatar(new File([pngBytes], 'image.png'));
      if (fail) await assert.rejects(result, /could not be decoded/);
      else assert.equal(await result, PNG);
      assert.deepEqual(revoked, ['blob:avatar-test']);
    });
  }
});

test('local avatar persistence is scoped by account; removal leaves other users and preferences intact', async () => {
  const storage = memoryStorage();
  await withGlobals({ localStorage: storage }, () => {
    storage.setItem('finance_app_theme', 'dark');
    saveAvatar(userA.id, PNG);
    assert.equal(readAvatar(userA.id), PNG);
    assert.equal(readAvatar(userB.id), null);
    saveAvatar(userB.id, PNG);
    removeAvatar(userA.id);
    assert.equal(readAvatar(userA.id), null);
    assert.equal(readAvatar(userB.id), PNG);
    assert.equal(storage.getItem('finance_app_theme'), 'dark');
    assert.notEqual(avatarStorageKey('user/a'), avatarStorageKey('user%2Fa'));
    assert.throws(() => saveAvatar('', PNG), /Sign in/);
    assert.deepEqual([...storage.values.keys()].sort(), ['finance_app_theme', avatarStorageKey(userB.id)].sort());
  });
});

test('blocked storage and quota errors are explicit and keep the previous avatar', async () => {
  const storage = memoryStorage();
  storage.setItem(avatarStorageKey(userA.id), PNG);
  await withGlobals({ localStorage: { ...storage, setItem: () => { throw new Error('QuotaExceededError'); } } }, () => {
    assert.throws(() => saveAvatar(userA.id, PNG), /storage may be full or blocked/);
    assert.equal(readAvatar(userA.id), PNG);
  });
  await withGlobals({ localStorage: { getItem: () => { throw new Error('SecurityError'); }, removeItem: () => { throw new Error('SecurityError'); } } }, () => {
    assert.throws(() => readAvatar(userA.id), /storage is unavailable/);
    assert.throws(() => removeAvatar(userA.id), /could not remove/i);
  });
  await withGlobals({ localStorage: storage }, () => {
    storage.setItem(avatarStorageKey(userA.id), 'https://untrusted.example/photo.svg');
    assert.equal(readAvatar(userA.id), null, 'Stored URLs and SVG must never become image sources');
    assert.throws(() => saveAvatar(userA.id, 'data:image/svg+xml,svg'), /Unable to save/);
  });
});

let sequence = 0;
async function profile(options = {}) {
  const user = options.user || userA;
  const slots = [], effects = [], dom = new Map(), listeners = new Map();
  const calls = { logout: 0, picker: 0, staleWrites: 0 };
  let cursor = 0, tree, mounted = true;
  const text = node => typeof node === 'string' ? node : node?.children?.map(text).join('') || '';
  const nodes = (node = tree) => !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap(child => nodes(child))];
  const document = {
    activeElement: null,
    addEventListener: (type, callback) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener: (type, callback) => listeners.get(type)?.delete(callback),
    emit: (type, event) => listeners.get(type)?.forEach(callback => callback(event)),
  };
  const key = `__profile_${sequence++}`;
  const dependencies = {
    document,
    useState: initial => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], next => { if (!mounted) calls.staleWrites++; slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useRef: initial => { const i = cursor++; return slots[i] ||= { current: initial, refId: i }; },
    useId: () => { const i = cursor++; return slots[i] ||= key; },
    useCallback: (callback, deps) => {
      const i = cursor++;
      if (!slots[i] || deps.some((value,index) => value !== slots[i].deps[index])) slots[i] = { callback, deps };
      return slots[i].callback;
    },
    useEffect: (callback, deps) => {
      const i = cursor++, previous = effects[i];
      if (!previous || deps.some((value,index) => value !== previous.deps[index])) {
        previous?.cleanup?.(); effects[i] = { callback, deps, pending: true };
      }
    },
    prepareAvatar: options.prepare || prepareAvatar,
    readAvatar, saveAvatar, removeAvatar,
    Link: props => dependencies.__jsx('a', { ...props, href: props.to }, ...props.children),
    __jsx: (type, props, ...children) => {
      props ||= {};
      children = children.flat(Infinity).filter(child => child !== false && child != null);
      if (typeof type === 'function') return type({ ...props, children });
      const name = props.ref ? `ref:${props.ref.refId}` : props.role === 'menuitem' ? children.map(text).join('') : props.id || props['aria-label'];
      const node = { type, props, children };
      if (name) {
        if (!dom.has(name)) dom.set(name, {
          focus() { document.activeElement = this; document.emit('focusin', { target: this }); },
          click() { calls.picker++; },
          contains(target) { return nodes().some(item => item.element === target); },
          querySelectorAll() { return nodes().filter(item => item.props.role === 'menuitem' && !item.props.disabled).map(item => item.element); },
          querySelector() { return this.querySelectorAll()[0]; },
        });
        node.element = dom.get(name);
        node.element.node = node;
        if (props.ref) props.ref.current = node.element;
      }
      return node;
    },
  };
  globalThis[key] = dependencies;
  let Component;
  try {
    let source = await readFile(new URL('../src/components/ProfileMenu.tsx', import.meta.url), 'utf8');
    const icons = source.match(/import \{([^}]+)\} from 'lucide-react';/)[1].split(',').map(icon => icon.trim());
    source = source.replace(/^import .*$/gm, '');
    source = `const {useState,useRef,useId,useCallback,useEffect,Link,prepareAvatar,readAvatar,saveAvatar,removeAvatar,__jsx,document}=globalThis.${key};\n${icons.map(icon => `const ${icon}='${icon}';`).join('\n')}\n${source}`;
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, jsxFactory: '__jsx' } }).outputText;
    Component = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
  } finally { delete globalThis[key]; }
  const render = () => {
    cursor = 0;
    tree = Component({ user, identityError: false, logout: async () => { calls.logout++; if (options.logoutError) throw new Error('Synthetic logout failure'); } });
    for (const effect of effects.filter(Boolean)) if (effect.pending) { effect.pending = false; effect.cleanup = effect.callback(); }
  };
  const find = (type, predicate = () => true) => {
    const found = nodes().filter(node => node.type === type && predicate(node.props, node));
    assert.equal(found.length, 1, `Expected one ${type}`); return found[0];
  };
  const event = key => ({ key, prevented: false, preventDefault() { this.prevented = true; } });
  const trigger = () => find('button', props => props['aria-label'] === 'User menu');
  render();
  return {
    nodes, find, calls, render, trigger, document,
    text: () => text(tree),
    action: label => nodes().find(node => node.props.role === 'menuitem' && text(node) === label),
    open: key => { if (key) trigger().props.onKeyDown(event(key)); else trigger().props.onClick(); render(); },
    key: key => { const e = event(key); if (key === 'Escape') document.emit('keydown', e); else find('div', props => props.role === 'menu').props.onKeyDown(e); render(); return e; },
    focused: () => document.activeElement?.node ? text(document.activeElement.node) : null,
    outside: type => { const target = { outside: true }; document.activeElement = target; document.emit(type, { target }); render(); return target; },
    select: async file => { const target = { files: file ? [file] : [], value: 'chosen.png' }; find('input', props => props.type === 'file').props.onChange({ currentTarget: target }); render(); await new Promise(resolve => setImmediate(resolve)); render(); return target; },
    unmount: () => { effects.forEach(effect => effect.cleanup?.()); mounted = false; },
    listenerCount: () => [...listeners.values()].reduce((sum, list) => sum + list.size, 0),
  };
}

test('profile upload persists a decoded avatar, removal restores the initial and only removes this account', async () => {
  const storage = memoryStorage(), ports = imagePorts();
  await withGlobals({ ...ports, localStorage: storage }, async () => {
    saveAvatar(userB.id, PNG);
    const view = await profile();
    assert.equal(view.trigger().props['aria-haspopup'], 'menu');
    assert.equal(view.trigger().props['aria-expanded'], false);
    view.open();
    assert.ok(view.text().includes(userA.email));
    assert.ok(!view.text().includes('Photo stored only in this browser'));
    assert.ok(!view.text().includes('JPEG, PNG or WebP · Up to 2 MB'));
    assert.equal(view.action('Remove profile photo').props.disabled, true);
    view.action('Change profile photo').props.onClick(); view.render();
    assert.equal(view.calls.picker, 1);
    const input = await view.select(new File([pngBytes], 'photo.png'));
    assert.equal(input.value, '', 'Same file can be selected again');
    assert.equal(readAvatar(userA.id), PNG);
    assert.equal(view.nodes().filter(node => node.type === 'img' && node.props.src === PNG).length, 2);
    assert.ok(view.find('div', props => props.role === 'status').children.includes('Profile photo saved on this browser.'));
    view.action('Remove profile photo').props.onClick(); view.render();
    assert.equal(readAvatar(userA.id), null);
    assert.equal(readAvatar(userB.id), PNG);
    assert.equal(view.nodes().filter(node => node.type === 'img').length, 0);
    assert.equal(view.focused(), 'Change profile photo');
    view.unmount();
  });
});

test('profile storage failures keep the old photo and present actionable errors', async () => {
  const storage = memoryStorage(); storage.setItem(avatarStorageKey(userA.id), PNG);
  await withGlobals({ localStorage: { ...storage, setItem: () => { throw new Error('Quota'); }, removeItem: () => { throw new Error('Blocked'); } } }, async () => {
    const view = await profile({ prepare: async () => PNG });
    await view.select(new File([pngBytes], 'photo.png'));
    assert.ok(view.text().includes('storage may be full or blocked'));
    assert.equal(view.nodes().filter(node => node.type === 'img').length, 2);
    view.action('Remove profile photo').props.onClick(); view.render();
    assert.ok(view.text().includes('Could not remove'));
    assert.equal(storage.getItem(avatarStorageKey(userA.id)), PNG);
    view.unmount();
  });
});

test('invalid uploads leave avatar unchanged and show feedback; canceling selection does nothing', async () => {
  await withGlobals({ localStorage: memoryStorage() }, async () => {
    const view = await profile();
    view.open();
    await view.select(null);
    assert.equal(view.text().includes('Profile photo saved'), false);
    await view.select(new File(['<svg/>'], 'fake.png', { type: 'image/png' }));
    assert.ok(view.text().includes('file contents must match'));
    assert.equal(readAvatar(userA.id), null);
    await view.select({ size: MAX_AVATAR_BYTES + 1 });
    assert.ok(view.text().includes('2 MB'));
    assert.equal(readAvatar(userA.id), null);
    view.unmount();
  });
});

test('menu supports arrow keys, Home/End, Escape, Tab and Settings while skipping disabled items', async () => {
  await withGlobals({ localStorage: memoryStorage() }, async () => {
    const view = await profile();
    view.open('ArrowDown');
    assert.equal(view.focused(), 'Change profile photo');
    assert.equal(view.key('ArrowDown').prevented, true);
    assert.equal(view.focused(), 'Settings');
    view.key('End'); assert.equal(view.focused(), 'Log out');
    view.key('ArrowDown'); assert.equal(view.focused(), 'Change profile photo');
    view.key('ArrowUp'); assert.equal(view.focused(), 'Log out');
    view.key('Home'); assert.equal(view.focused(), 'Change profile photo');
    view.key('Escape');
    assert.equal(view.trigger().props['aria-expanded'], false);
    assert.equal(view.document.activeElement, view.trigger().element);
    view.open('ArrowUp'); assert.equal(view.focused(), 'Log out');
    assert.equal(view.key('Tab').prevented, false, 'Tab may continue browser navigation');
    assert.equal(view.trigger().props['aria-expanded'], false);
    view.open();
    assert.equal(view.action('Settings').props.href, '/settings');
    view.action('Settings').props.onClick(); view.render();
    assert.equal(view.trigger().props['aria-expanded'], false);
    view.unmount();
  });
});

test('outside pointer/focus dismiss without stealing focus and listeners are cleaned up', async () => {
  await withGlobals({ localStorage: memoryStorage() }, async () => {
    const view = await profile();
    for (const type of ['pointerdown', 'focusin']) {
      view.open();
      const outside = view.outside(type);
      assert.equal(view.trigger().props['aria-expanded'], false);
      assert.equal(view.document.activeElement, outside);
      assert.equal(view.listenerCount(), 0);
    }
    view.open(); view.unmount();
    assert.equal(view.listenerCount(), 0);
  });
});

test('account teardown suppresses pending uploads; another account starts without the old avatar', async () => {
  const storage = memoryStorage(); let resolve;
  await withGlobals({ localStorage: storage }, async () => {
    const pending = new Promise(done => { resolve = done; });
    const first = await profile({ prepare: () => pending });
    await first.select(new File([pngBytes], 'photo.png'));
    first.unmount();
    const second = await profile({ user: userB });
    assert.equal(second.nodes().some(node => node.type === 'img'), false);
    resolve(PNG); await new Promise(done => setImmediate(done));
    assert.equal(readAvatar(userA.id), null);
    assert.equal(readAvatar(userB.id), null);
    assert.equal(first.calls.staleWrites, 0);
    second.unmount();
  });
});

test('logout invokes existing handler once, tolerates rejection, retains stored avatar and cancels late upload', async () => {
  for (const logoutError of [false, true]) {
    const storage = memoryStorage(); storage.setItem(avatarStorageKey(userA.id), PNG);
    let resolve;
    await withGlobals({ localStorage: storage }, async () => {
      const view = await profile({ logoutError, prepare: () => new Promise(done => { resolve = done; }) });
      await view.select(new File([pngBytes], 'new.png'));
      view.action('Log out').props.onClick(); view.render();
      assert.equal(view.calls.logout, 1);
      assert.equal(view.trigger().props['aria-expanded'], false);
      resolve(PNG); await new Promise(done => setImmediate(done));
      assert.equal(readAvatar(userA.id), PNG);
      view.unmount();
    });
  }
});

test('UserMenu mounts a different keyed profile for each authenticated account and ignores mismatched identity', async () => {
  let current = userA, identity = userB;
  const key = `__wrapper_${sequence++}`;
  globalThis[key] = { useAuth: () => ({ user: current, logout: async () => {} }), useResource: () => ({ data: identity, error: '' }), ProfileMenu: 'ProfileMenu', __jsx: (type, props) => ({ type, props }) };
  try {
    let source = await readFile(new URL('../src/components/UserMenu.tsx', import.meta.url), 'utf8');
    source = `const {useAuth,useResource,ProfileMenu,__jsx}=globalThis.${key};\n` + source.replace(/^import .*$/gm, '');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, jsxFactory: '__jsx' } }).outputText;
    const { UserMenu } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    const first = UserMenu(); assert.equal(first.props.user.id, userA.id);
    current = userB; identity = userA;
    const second = UserMenu(); assert.equal(second.props.user.id, userB.id);
    assert.notEqual(first.props.key, second.props.key);
    current = null; assert.equal(UserMenu(), null);
  } finally { delete globalThis[key]; }
});

test('a file at the exact size limit is accepted after byte validation and decoding', async () => {
  const bytes = new Uint8Array(MAX_AVATAR_BYTES); bytes.set(pngBytes);
  const ports = imagePorts();
  await withGlobals(ports, async () => {
    assert.equal(await prepareAvatar(new File([bytes], 'limit.png')), PNG);
    assert.equal(ports.calls.decode.length, 1);
    assert.equal(ports.calls.release, 1);
  });
});

test('blocked avatar reads show the initial and an error while Settings and logout remain available', async () => {
  await withGlobals({ localStorage: { getItem: () => { throw new Error('Blocked'); } } }, async () => {
    const view = await profile(); view.open();
    assert.equal(view.nodes().some(node => node.type === 'img'), false);
    assert.ok(view.text().includes('storage is unavailable'));
    assert.equal(view.action('Settings').props.href, '/settings');
    view.action('Log out').props.onClick(); view.render();
    assert.equal(view.calls.logout, 1);
    view.unmount();
  });
});
