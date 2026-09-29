const fs = require('fs');
const path = require('path');
const { bseJson } = require('../api/_bse');
const eventApi = require('../api/event-calendar');

const ROOT = path.join(__dirname, '..');
const STATE_FILE = path.join(ROOT, 'data', 'bse-result-state.json');
const BSE_ENDPOINT = '/Corpforthresults/w';

function readState() {
  try {
    const value = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return value && typeof value === 'object' && value.events && typeof value.events === 'object'
      ? value
      : { events: {} };
  } catch {
    return { events: {} };
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

function eventKey(row) {
  return `${row.scripCode}|${row.meetingDate}`;
}

function findNewEvents(rows, state) {
  return rows.filter(row => !state.events[eventKey(row)]);
}

function updateState(state, rows, now = new Date().toISOString()) {
  for (const row of rows) state.events[eventKey(row)] = now;
  return state;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function telegramMessage(rows) {
  const lines = [`<b>🆕 New BSE Result Calendar Update</b>`, `<b>${rows.length} new compan${rows.length === 1 ? 'y' : 'ies'}</b>`, ''];
  for (const row of rows) {
    const company = escapeHtml(row.company);
    const symbol = escapeHtml(row.symbol);
    const date = escapeHtml(row.meetingDate);
    const code = escapeHtml(row.scripCode);
    const url = row.url ? `\n<a href="${escapeHtml(row.url)}">BSE company page</a>` : '';
    lines.push(`• <b>${company}</b> (${symbol})\n  Meeting: ${date} | BSE: ${code}${url}`);
  }
  return lines.join('\n');
}

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required');
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}: ${text}`);
  const data = JSON.parse(text);
  if (!data.ok) throw new Error(`Telegram API error: ${text}`);
  return data;
}

async function main() {
  const today = eventApi.indiaTodayIso();
  const to = eventApi.addDaysIso(today, 91);
  const raw = await bseJson(`${BSE_ENDPOINT}?fromdate=${today.replaceAll('-', '')}&todate=${to.replaceAll('-', '')}`);
  const rows = eventApi.mapApiRows(raw, today);
  const state = readState();
  const isFirstRun = Object.keys(state.events).length === 0;
  const newRows = findNewEvents(rows, state);

  if (isFirstRun) {
    updateState(state, rows);
    writeState(state);
    console.log(`Baseline created: ${rows.length} current BSE result-calendar companies. No Telegram alert sent.`);
    return;
  }

  if (!newRows.length) {
    console.log(`No new BSE result-calendar companies. Current companies: ${rows.length}.`);
    return;
  }

  await sendTelegram(telegramMessage(newRows));
  updateState(state, rows);
  writeState(state);
  console.log(`Telegram alert sent for ${newRows.length} new BSE result-calendar companies.`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('BSE result monitor failed:', err);
    process.exit(1);
  });
}

module.exports = { eventKey, findNewEvents, updateState, telegramMessage };
