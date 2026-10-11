const fs = require('fs');
const path = require('path');
const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..');
const eventApi = require(path.join(root, 'api/event-calendar.js'));
const monitor = require(path.join(root, 'scripts/bse-result-monitor.js'));
const bseFixture = [
  { scrip_Code: '541556', short_name: 'RITES', Long_Name: 'RITES Ltd', meeting_date: '04 Nov 2026', URL: 'https://www.bseindia.com/stock-share-price/rites-ltd/rites/541556/' },
  { scrip_Code: '532509', short_name: 'SUPRAJIT', Long_Name: 'Suprajit Engineering Ltd', meeting_date: '07 Nov 2026' }
];
const nseFixture = { data: [
  { symbol: 'RITES', company: 'RITES Limited', purpose: 'Financial Results', date: '04-Nov-2026' },
  { symbol: 'TCS', company: 'Tata Consultancy Services Limited', purpose: 'Financial Results', date: '12-Nov-2026' },
  { symbol: 'ABC', company: 'ABC Ltd', purpose: 'Other business matters', date: '12-Nov-2026' }
]};
const bseRows = eventApi.normalizeBseRows(bseFixture);
const nseRows = eventApi.normalizeNseRows(nseFixture);
assert.equal(bseRows.length, 2, 'BSE rows normalized');
assert.equal(nseRows.length, 2, 'NSE only keeps financial-results meetings');
assert.equal(nseRows[0].nseSymbol, 'RITES', 'NSE symbol normalized');
const merged = eventApi.mergeRows(bseRows, nseRows);
assert.equal(merged.length, 3, 'same company/date across exchanges merges');
const rites = merged.find(x => x.company.startsWith('RITES'));
assert.deepEqual(rites.sources, ['BSE', 'NSE'], 'cross-listed event has both sources');
assert.equal(rites.bseCode, '541556');
assert.equal(rites.nseSymbol, 'RITES');
const state = { events: { '541556|04 Nov 2026': '2026-10-10T00:00:00Z' } };
assert.equal(monitor.findNewEvents(merged, state).length, 2, 'legacy BSE state prevents duplicate RITES alert');
monitor.updateState(state, merged, '2026-10-11T00:00:00Z');
assert.ok(state.events['NSE|RITES|04 Nov 2026'], 'state records NSE alias');
const message = monitor.telegramMessage([rites], new Date('2026-10-11T16:00:00Z'));
assert.ok(message.includes('NEW COMPANY RESULTS DATE ALERT'));
assert.ok(message.includes('Expected Results Date: 04 Nov 2026 (scheduled)'));
assert.ok(message.includes('Board Meeting Date: 04 Nov 2026'));
assert.ok(message.includes('NSE company page') && message.includes('BSE company page'));
assert.ok(message.includes('BSE Code: 541556') && message.includes('NSE Symbol: RITES'));
assert.ok(message.includes('Checked: 11 Oct 2026'));
assert.ok(eventApi.parseBseDate('04-Nov-2026') < eventApi.parseBseDate('07 Nov 2026'));

const apiSource = fs.readFileSync(path.join(root, 'api/event-calendar.js'), 'utf8');
assert.ok(apiSource.includes('/Corpforthresults/w'));
assert.ok(fs.existsSync(path.join(root, 'api/_nse.js')));
assert.ok(fs.readFileSync(path.join(root, 'api/_nse.js'), 'utf8').includes('/api/event-calendar'));
assert.ok(!fs.readFileSync(path.join(root, 'api/_nse.js'), 'utf8').includes('/api/corporate-board-meetings'));
const html = fs.readFileSync(path.join(root, 'src/app/app.component.html'), 'utf8');
assert.ok(html.includes('NSE + BSE'));
const workflow = fs.readFileSync(path.join(root, '.github/workflows/bse-result-alert.yml'), 'utf8');
assert.ok(workflow.includes("cron: '*/30 * * * *'"));
assert.ok(workflow.includes('TELEGRAM_BOT_TOKEN') && workflow.includes('TELEGRAM_CHAT_ID'));

(async () => {
  const combinedResult = await eventApi.fetchCombinedRows('2026-10-11', '2027-01-10', {
    bseFetcher: async () => bseFixture,
    nseFetcher: async () => nseFixture
  });
  assert.equal(combinedResult.bseCount, 2);
  assert.equal(combinedResult.nseCount, 2);
  const eventCalendarAlias = eventApi.normalizeNseRows({ events: [{ Symbol: 'INFY', Company: 'Infosys Limited', event: 'Financial Results', eventDate: '13-Nov-2026' }] });
  assert.equal(eventCalendarAlias.length, 1, 'NSE event-calendar aliases normalize');
  assert.equal(combinedResult.data.length, 3);
  const partial = await eventApi.fetchCombinedRows('2026-10-11', '2027-01-10', {
    bseFetcher: async () => { throw new Error('mock BSE 403'); },
    nseFetcher: async () => nseFixture
  });
  assert.equal(partial.data.length, 2, 'NSE results remain available if BSE is blocked');
  assert.ok(partial.errors[0].includes('BSE: mock BSE 403'));
  await assert.rejects(() => eventApi.fetchCombinedRows('2026-10-11', '2027-01-10', {
    bseFetcher: async () => { throw new Error('mock BSE 403'); },
    nseFetcher: async () => { throw new Error('mock NSE 403'); }
  }), /Both exchanges failed/);
  console.log('PASS: BSE and NSE normalization, financial-results filtering, and cross-listing merge');
  console.log('PASS: legacy BSE saved-state compatibility and NSE alias deduplication');
  console.log('PASS: Telegram message includes expected results date and both exchange links');
  console.log('PASS: 30-minute GitHub Actions schedule and required Telegram secrets retained');
  console.log('PASS: independent source failure and both-sources-failed handling with mocked responses');
  console.log('NOTE: Live NSE/BSE access and real Telegram delivery were not tested.');
})().catch(err => { console.error('E2E FAILED:', err); process.exit(1); });
