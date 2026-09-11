#!/usr/bin/env node
const http = require('node:http');
const readline = require('node:readline');
const path = require('node:path');

let registryInstance = null;

async function getRegistry() {
  if (!registryInstance) {
    const { ComputerUseToolRegistry } = await import('./tools/index.js');
    registryInstance = new ComputerUseToolRegistry();
  }
  return registryInstance;
}

const sseClients = new Set();
const recentEvents = [];

try {
  const bridgeServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.url === '/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(': keepalive\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (req.url === '/poll' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(recentEvents.slice(-20)));
      return;
    }

    if (req.url === '/event' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const ev = JSON.parse(body);
          broadcastEvent(ev);
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"status":"ok"}');
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  bridgeServer.on('error', () => {});
  bridgeServer.listen(51829, '127.0.0.1');
} catch {}

function broadcastEvent(ev) {
  recentEvents.push(ev);
  if (recentEvents.length > 100) recentEvents.shift();
  const payload = `data: ${JSON.stringify(ev)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch {}
  }
}

function notifyBridge(type, data) {
  broadcastEvent({ type, timestamp: Date.now(), ...data });
}

function sendResponse(response) {
  process.stdout.write(JSON.stringify(response) + '\n');
}

async function handleMessage(message) {
  if (!message || typeof message !== 'object') return;
  const { id, method, params } = message;

  if (method === 'initialize') {
    sendResponse({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'computer-use',
          version: '1.0.0',
        },
      },
    });
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'tools/list') {
    const reg = await getRegistry();
    const manifest = reg.getToolManifest();
    sendResponse({
      jsonrpc: '2.0',
      id,
      result: { tools: manifest },
    });
    return;
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};
    const reg = await getRegistry();

    notifyBridge('tool_start', { toolName, args });

    try {
      const result = await reg.executeTool(toolName, args);
      notifyBridge('tool_complete', { toolName, args, result });
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        },
      });
    } catch (err) {
      notifyBridge('tool_complete', { toolName, args, error: err.message });
      sendResponse({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: err.message,
        },
      });
    }
    return;
  }

  if (id != null) {
    sendResponse({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: 'Method not found: ' + method },
    });
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const msg = JSON.parse(trimmed);
    handleMessage(msg).catch(() => {});
  } catch {}
});
