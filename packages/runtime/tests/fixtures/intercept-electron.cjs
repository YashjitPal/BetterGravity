const assert = require('node:assert/strict');
const { X509Certificate } = require('node:crypto');
const fs = require('node:fs');
const http2 = require('node:http2');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');

const directory = process.argv[2];
const { installSourceInterceptor, mintAuthority, mintLeaf } = require(path.join(directory, 'runtime.cjs'));
const result = { electron: process.versions.electron, opened: 0, closed: 0, errors: [] };
const active = new Set();
const connections = new Set();
const bytes = Buffer.from([0, 255, 128, 42]);
let window;
let server;

app.setPath('userData', path.join(directory, 'profile'));
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-background-timer-throttling');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = () => fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ ...result, active: active.size }, null, 2));
const fail = error => { result.errors.push(String(error?.stack ?? error)); save(); app.exit(1); };
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
const watchdog = setTimeout(() => fail(new Error('Electron interceptor regression test timed out')), 50_000);

async function within(operation, label) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(label)), 2_000); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function until(predicate, label) {
  await within((async () => { while (!predicate()) await delay(5); })(), label);
}

app.whenReady().then(async () => {
  const authority = mintAuthority();
  const leaf = mintLeaf(authority.certificate, authority.privateKeyPem);
  // This trust override belongs only to the isolated test profile.
  session.defaultSession.setCertificateVerifyProc((request, callback) => callback(request.hostname === '127.0.0.1' ? 0 : -3));
  server = http2.createSecureServer({
    key: leaf.privateKeyPem,
    cert: new X509Certificate(leaf.certificate).toString(),
    settings: { maxConcurrentStreams: 250 }
  }, (request, response) => {
    const url = new URL(request.url, 'https://127.0.0.1');
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      if (['/stream', '/delayed', '/no-first-byte'].includes(url.pathname)) {
        assert.equal(request.httpVersion, '2.0');
        assert.equal(request.method, 'POST');
        assert.deepEqual(Buffer.concat(chunks), bytes);
        result.opened++;
        active.add(response);
        response.once('close', () => { active.delete(response); result.closed++; });
        const start = () => {
          if (response.destroyed) return;
          response.writeHead(200, { 'content-type': 'application/connect+proto', 'cache-control': 'no-store' });
          response.flushHeaders();
          if (url.pathname !== '/no-first-byte') response.write(bytes);
        };
        if (url.pathname === '/delayed') setTimeout(start, 100);
        else start();
      } else if (url.pathname === '/binary') {
        response.writeHead(201, { 'content-type': 'application/octet-stream', 'x-preserved': 'yes' });
        response.end(Buffer.concat(chunks));
      } else if (url.pathname === '/empty') {
        response.writeHead(204);
        response.end();
      } else if (url.pathname === '/assets/main.js') {
        const source = 'window.bundleValue="bundle-anchor:original";';
        response.writeHead(200, { 'content-type': 'text/javascript', 'content-length': String(Buffer.byteLength(source)) });
        response.end(source);
      } else if (url.pathname === '/assets/module.js') {
        response.writeHead(200, { 'content-type': 'text/javascript' });
        response.end('import { value } from "./dependency.js"; export { value }; export const sourceUrl = import.meta.url;');
      } else if (url.pathname === '/assets/dependency.js') {
        response.writeHead(200, { 'content-type': 'text/javascript' });
        response.end('export const value = "relative-import-kept";');
      } else if (url.pathname === '/unavailable.js') {
        response.writeHead(503, { 'content-type': 'text/plain' });
        response.end('upstream unavailable');
      } else {
        response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
        response.end('<!doctype html><title>Source interceptor regression</title><script src="/assets/main.js?v=1"></script>');
      }
    });
  });
  server.on('session', connection => {
    connections.add(connection);
    connection.once('close', () => connections.delete(connection));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `https://127.0.0.1:${server.address().port}`;
  assert.equal(installSourceInterceptor(session.defaultSession, [{
    pluginId: 'transport-regression',
    patches: [{ find: 'bundle-anchor', replace: [{ match: 'original', with: 'patched-successfully' }] }]
  }]), true);

  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await window.loadURL(origin);
  assert.equal(await window.webContents.executeJavaScript('window.bundleValue'), 'bundle-anchor:patched-successfully');
  result.bundlePatched = true;
  const imported = await window.webContents.executeJavaScript('import("/assets/module.js").then(module => ({value: module.value, sourceUrl: module.sourceUrl}))');
  assert.deepEqual(imported, { value: 'relative-import-kept', sourceUrl: `${origin}/assets/module.js` });
  result.relativeImport = true;
  const echo = await window.webContents.executeJavaScript(`(async () => {
    const response = await fetch('/binary', { method: 'POST', body: new Uint8Array([0,255,128,42]) });
    return { status: response.status, header: response.headers.get('x-preserved'), bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
  })()`);
  assert.deepEqual(echo, { status: 201, header: 'yes', bytes: [...bytes] });
  result.binaryEcho = true;
  assert.equal(await window.webContents.executeJavaScript('fetch("/empty").then(response => response.status)'), 204);
  assert.deepEqual(await window.webContents.executeJavaScript('fetch("/unavailable.js").then(async response => ({status: response.status, body: await response.text()}))'), { status: 503, body: 'upstream unavailable' });

  // Read one frame, then leave the next read idle as a chat subscription would.
  // A cancelled reader alone is not evidence: the SERVER must see stream close.
  for (let index = 0; index < 260; index++) {
    const observation = await within(window.webContents.executeJavaScript(`(async () => {
      const controller = new AbortController();
      const response = await fetch('/stream?id=${index}', {method:'POST', body:new Uint8Array([0,255,128,42]), signal:controller.signal});
      const reader = response.body.getReader();
      const first = await reader.read();
      const pending = reader.read().then(value => value.done, error => error.name);
      controller.abort();
      return { bytes: Array.from(first.value), afterAbort: await pending };
    })()`), `Subscription ${index + 1} stalled`);
    assert.deepEqual(observation, { bytes: [...bytes], afterAbort: 'AbortError' });
  }
  await until(() => active.size === 0, 'Cancelled chat streams remained open');

  // Cancelling just the reader must also close the network request.
  await window.webContents.executeJavaScript(`(async () => {
    const response = await fetch('/stream?id=reader-cancel', {method:'POST', body:new Uint8Array([0,255,128,42])});
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
  })()`);
  await until(() => active.size === 0, 'Reader cancellation leaked a stream');

  // Cancellation without a first response byte, and before delayed headers.
  for (const endpoint of ['/no-first-byte', '/delayed']) {
    const opened = result.opened;
    await window.webContents.executeJavaScript(`window.pendingController = new AbortController();
      window.pendingRequest = fetch(${JSON.stringify(endpoint)}, {method:'POST', body:new Uint8Array([0,255,128,42]), signal:window.pendingController.signal})
        .then(response => response.arrayBuffer()).catch(error => error.name); void 0;`);
    await until(() => result.opened > opened, 'The pending request never reached the server');
    await window.webContents.executeJavaScript('window.pendingController.abort(); void 0;');
    await until(() => active.size === 0, `${endpoint} cancellation leaked a stream`);
  }
  result.delayedHeadersCancelled = true;

  await window.webContents.executeJavaScript(`(async () => {
    window.navigationStream = await fetch('/stream?id=navigation', {method:'POST', body:new Uint8Array([0,255,128,42])});
    window.navigationReader = window.navigationStream.body.getReader();
    await window.navigationReader.read();
  })()`);
  await window.loadURL(`${origin}/?view=history`);
  await until(() => active.size === 0, 'Navigation left a chat stream open');
  assert.equal(await window.webContents.executeJavaScript('window.bundleValue'), 'bundle-anchor:patched-successfully');
  result.navigationCancelled = true;
  save();

  window.destroy();
  for (const connection of connections) connection.destroy();
  await new Promise(resolve => server.close(resolve));
  clearTimeout(watchdog);
  app.exit(0);
}).catch(fail);
