import { ComputerUseToolRegistry } from '../../../tools/index.js';
import http from 'node:http';

const args = process.argv.slice(2);
const toolName = args[0] || 'list_apps';
const parsedArgs = {};

for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--')) {
    const key = arg.slice(2);
    const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
    if (key === 'target' || key === 'from' || key === 'to') {
      parsedArgs[key] = val.split(',').map(Number);
    } else if (key === 'click_count' || key === 'pages' || key === 'element_index') {
      parsedArgs[key] = Number(val);
    } else {
      parsedArgs[key] = val;
    }
  }
}

// Notify local BetterGravity bridge if running
function notifyBridge(event, data) {
  try {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 51829,
      path: '/event',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 300,
    });
    req.on('error', () => {});
    req.write(JSON.stringify({ type: event, ...data }));
    req.end();
  } catch {}
}

const registry = new ComputerUseToolRegistry();

notifyBridge('tool_start', { toolName, args: parsedArgs });

registry.executeTool(toolName, parsedArgs)
  .then((result) => {
    notifyBridge('tool_complete', { toolName, args: parsedArgs, result });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  })
  .catch((err) => {
    notifyBridge('tool_complete', { toolName, args: parsedArgs, error: err.message });
    process.stderr.write(JSON.stringify({ status: 'error', error: err.message }) + '\n');
    process.exit(1);
  });
