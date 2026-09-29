const { spawn } = require('child_process');
const path = require('path');
const isWin = process.platform === 'win32';
const node = process.execPath;
const root = path.join(__dirname, '..');

const api = spawn(node, ['server/server.js'], { cwd: root, stdio: 'inherit', env: process.env });
const ngCli = path.join(root, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
const ng = spawn(node, [ngCli, 'serve', '--proxy-config', 'proxy.conf.json'], { cwd: root, stdio: 'inherit', env: process.env });

function stop(code = 0) { try { api.kill(); } catch {} try { ng.kill(); } catch {} process.exit(code); }
api.on('exit', code => { if (code && !ng.killed) stop(code); });
ng.on('exit', code => stop(code || 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
