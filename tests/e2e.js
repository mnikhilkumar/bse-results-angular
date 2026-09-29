const fs = require('fs');
const path = require('path');
const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync('/mnt/data/Pasted text(1).txt', 'utf8').trim());
const eventApi = require(path.join(root, 'api/event-calendar.js'));
const monitor = require(path.join(root, 'scripts/bse-result-monitor.js'));

assert.equal(fixture.length, 90, 'uploaded BSE fixture should contain 90 companies');
const today = '2026-09-29';
const results = eventApi.mapApiRows(fixture, today);
assert.equal(results.length, 90, 'all fixture companies are today or future');
assert.equal(results[0].meetingDate, '29 Sep 2026', 'first row starts from present date');
assert.equal(results[0].symbol, 'ANSALAPI', 'first company is ANSALAPI');
assert.equal(results[results.length - 1].meetingDate, '14 Nov 2026', 'last date sorted correctly');
for (let i = 1; i < results.length; i++) {
  assert.ok(eventApi.parseBseDate(results[i].meetingDate) >= eventApi.parseBseDate(results[i - 1].meetingDate), `dates sorted at ${i}`);
}

const old = [{ scripCode: '500013', symbol: 'ANSALAPI', company: 'Ansal Properties & Infrastructure Ltd', meetingDate: '29 Sep 2026', url: 'x' }];
const state = { events: {} };
assert.equal(monitor.findNewEvents(results, state).length, 90, 'empty state detects all as new');
monitor.updateState(state, old, '2026-09-29T09:00:00Z');
const additions = monitor.findNewEvents(results, state);
assert.equal(additions.length, 89, 'after baseline, only untracked companies are new');
assert.equal(additions[0].symbol, 'MYSPAPE', 'new company detection is stable');
const message = monitor.telegramMessage([results[1]]);
assert.ok(message.includes('Mysore Paper Mills Ltd'), 'Telegram message includes company');
assert.ok(message.includes('MYSPAPE'), 'Telegram message includes symbol');
assert.ok(message.includes(results[1].meetingDate), 'Telegram message includes meeting date');

const apiSource = fs.readFileSync(path.join(root, 'api/event-calendar.js'), 'utf8');
assert.ok(apiSource.includes('/Corpforthresults/w'), 'BSE result API configured');
assert.ok(apiSource.includes('fromdate'), 'BSE fromdate configured');
assert.ok(apiSource.includes('todate'), 'BSE todate configured');
const html = fs.readFileSync(path.join(root, 'src/app/app.component.html'), 'utf8');
assert.ok(html.includes('BSE'), 'UI changed to BSE');
assert.ok(html.includes('today onward'), 'UI states present-date filter');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/bse-result-alert.yml'), 'utf8');
assert.ok(workflow.includes("cron: '*/30 * * * *'"), '30-minute workflow configured');
assert.ok(workflow.includes('TELEGRAM_BOT_TOKEN'), 'Telegram token secret configured');
assert.ok(workflow.includes('TELEGRAM_CHAT_ID'), 'Telegram chat secret configured');

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: pathname }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

(async () => {
  const mockPort = 4101;
  const apiPort = 4100;
  const mock = http.createServer((req, res) => {
    if (req.url.startsWith('/Corpforthresults/w')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(fixture));
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => mock.listen(mockPort, resolve));
  const env = { ...process.env, BSE_BASE_URL: `http://127.0.0.1:${mockPort}`, PORT: String(apiPort) };
  const child = spawn(process.execPath, ['server/server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('local API server did not start')), 5000);
      child.stdout.on('data', chunk => {
        if (String(chunk).includes(`on ${apiPort}`)) { clearTimeout(timer); resolve(); }
      });
      child.on('error', reject);
    });
    const response = await request(apiPort, '/api/event-calendar?from_date=2026-09-28&to_date=2026-12-28');
    assert.equal(response.status, 200, 'local API returns 200');
    const body = JSON.parse(response.body);
    assert.equal(body.count, 90, 'local API returns fixture rows');
    assert.equal(body.data[0].symbol, 'ANSALAPI', 'local API normalizes BSE symbol');
    assert.equal(body.data[0].scripCode, '500013', 'local API normalizes BSE code');
    assert.equal(body.from_date, '2026-09-29', 'local API clamps past start date to present date');
    console.log('PASS: uploaded BSE fixture parsed (90 companies)');
    console.log('PASS: present-date filter and ascending meeting-date sort');
    console.log('PASS: Telegram new-company detection and message generation');
    console.log('PASS: BSE Corpforthresults endpoint and GitHub Actions configuration');
    console.log('PASS: local API end-to-end with mock BSE server');
    console.log('ALL LOCAL E2E TESTS PASSED');
    console.log('NOTE: Real BSE HTTP and real Telegram delivery are not run in this sandbox; the API contract is exercised end-to-end against the supplied BSE fixture and a local mock server.');
  } finally {
    child.kill();
    await new Promise(resolve => mock.close(resolve));
  }
})().catch(err => { console.error('E2E FAILED:', err); process.exit(1); });
