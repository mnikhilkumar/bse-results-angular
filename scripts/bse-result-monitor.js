const fs = require('fs');
const path = require('path');
const eventApi = require('../api/event-calendar');

const ROOT = path.join(__dirname, '..');
const STATE_FILE = path.join(ROOT, 'data', 'bse-result-state.json');

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

function eventAliases(row) {
  const keys = [];
  if (row.scripCode || row.bseCode) keys.push(`${row.scripCode || row.bseCode}|${row.meetingDate}`);
  if (row.nseSymbol) keys.push(`NSE|${row.nseSymbol}|${row.meetingDate}`);
  if (row.id) keys.push(row.id);
  return [...new Set(keys)];
}
function eventKey(row) { return eventAliases(row)[0] || `${row.company}|${row.meetingDate}`; }
function findNewEvents(rows, state) {
  return rows.filter(row => !eventAliases(row).some(key => state.events[key]));
}
function updateState(state, rows, now = new Date().toISOString()) {
  for (const row of rows) for (const key of eventAliases(row)) state.events[key] = now;
  return state;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function checkedTimeIndia(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true
  }).format(date).replace(',', '');
}

function telegramMessage(rows, checkedAt = new Date()) {
  const lines = [
    '<b>🆕 NEW COMPANY RESULTS DATE ALERT</b>',
    `<b>${rows.length} new compan${rows.length === 1 ? 'y' : 'ies'}</b>`,
    ''
  ];
  for (const row of rows) {
    const company = escapeHtml(row.company || 'Unknown company');
    const nseSymbol = escapeHtml(row.nseSymbol || row.symbol || 'N/A');
    const code = escapeHtml(row.bseCode || row.scripCode || 'N/A');
    const date = escapeHtml(row.resultsDate || row.meetingDate || 'Not announced');
    const meeting = escapeHtml(row.meetingDate || 'Not announced');
    const purpose = escapeHtml(row.purpose || 'Consider financial results');
    const sources = escapeHtml((row.sources || [row.exchange || 'Unknown']).join(' + '));
    const links = [
      row.nseUrl ? `<a href="${escapeHtml(row.nseUrl)}">NSE company page</a>` : '',
      row.bseUrl ? `<a href="${escapeHtml(row.bseUrl)}">BSE company page</a>` : ''
    ].filter(Boolean).join(' | ');
    lines.push(
      `🏢 <b>${company}</b>\n` +
      `🔹 NSE Symbol: ${nseSymbol}\n` +
      `🔢 BSE Code: ${code}\n` +
      `📊 Results: Financial results\n` +
      `📅 Expected Results Date: ${date} (scheduled)\n` +
      `🗓️ Board Meeting Date: ${meeting}\n` +
      `📌 Purpose: ${purpose}\n` +
      (links ? `🔗 ${links}\n` : '') +
      `⏰ Checked: ${escapeHtml(checkedTimeIndia(checkedAt))}\n` +
      `📡 Source: ${sources}`
    );
  }
  return lines.join('\n\n');
}

async function sendTelegram(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  const chatIds = (process.env.TELEGRAM_CHAT_ID || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is missing');
  }

  if (chatIds.length === 0) {
    throw new Error('TELEGRAM_CHAT_ID is missing');
  }

  // Telegram allows max 4096 characters.
  // Keep some margin for safety.
  const MAX_LENGTH = 3800;

  function splitMessage(text) {
    const chunks = [];
    let remaining = String(text);

    while (remaining.length > MAX_LENGTH) {
      // Prefer splitting at a newline.
      let splitAt = remaining.lastIndexOf('\n', MAX_LENGTH);

      // If there is no suitable newline, split at a space.
      if (splitAt < MAX_LENGTH * 0.5) {
        splitAt = remaining.lastIndexOf(' ', MAX_LENGTH);
      }

      // Last fallback: hard split.
      if (splitAt <= 0) {
        splitAt = MAX_LENGTH;
      }

      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }

    if (remaining.length > 0) {
      chunks.push(remaining);
    }

    return chunks;
  }

  const chunks = splitMessage(message);

  console.log(
    `Telegram: sending ${chunks.length} message(s) to ${chatIds.length} chat(s)`
  );

  for (const chatId of chatIds) {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      try {
        const response = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              chat_id: chatId,
              text: chunk,
              parse_mode: 'HTML',
              disable_web_page_preview: true
            })
          }
        );

        const data = await response.json();

        if (!response.ok || !data.ok) {
          throw new Error(
            `Telegram HTTP ${response.status} for chat ${chatId}: ${JSON.stringify(data)}`
          );
        }

        console.log(
          `Telegram: sent ${i + 1}/${chunks.length} to chat ${chatId}`
        );
      } catch (error) {
        console.error(
          `Telegram failed for chat ${chatId}, message ${i + 1}/${chunks.length}:`,
          error.message
        );

        // Continue with other chats instead of killing the BSE monitor.
      }
    }
  }
}

async function main() {
  const today = eventApi.indiaTodayIso();
  const to = eventApi.addDaysIso(today, 91);
  const combined = await eventApi.fetchCombinedRows(today, to);
  const rows = combined.data;
  const state = readState();
  const isFirstRun = Object.keys(state.events).length === 0;
  const nseBaselineKey = '__meta|nse-baseline-created';
  const nseNeedsBaseline = !state.events[nseBaselineKey];
  let newRows = findNewEvents(rows, state);
  // Preserve the old BSE first-run baseline behavior and avoid flooding Telegram
  // with every already-scheduled NSE meeting when NSE support is first enabled.
  if (nseNeedsBaseline && !isFirstRun) {
    const nseOnly = rows.filter(row => (row.sources || []).includes('NSE') && !(row.sources || []).includes('BSE'));
    updateState(state, nseOnly);
    state.events[nseBaselineKey] = new Date().toISOString();
    newRows = newRows.filter(row => !nseOnly.includes(row));
  }
  if (isFirstRun) {
    updateState(state, rows);
    state.events[nseBaselineKey] = new Date().toISOString();
    writeState(state);
    console.log(`Baseline created: ${rows.length} combined NSE/BSE result-calendar events. No Telegram alert sent.`);
    return;
  }
  if (!newRows.length) {
    // Record all known aliases so cross-listed events do not re-alert after source recovery.
    updateState(state, rows);
    writeState(state);
    console.log(`No new NSE/BSE result-calendar events. Current events: ${rows.length}; BSE records: ${combined.bseCount}; NSE records: ${combined.nseCount}.`);
    if (combined.errors.length) console.warn(`Partial source outage: ${combined.errors.join(' | ')}`);
    return;
  }
  await sendTelegram(telegramMessage(newRows));
  updateState(state, rows);
  state.events[nseBaselineKey] = new Date().toISOString();
  writeState(state);
  console.log(`Telegram alert sent for ${newRows.length} new NSE/BSE result-calendar events.`);
  if (combined.errors.length) console.warn(`Partial source outage: ${combined.errors.join(' | ')}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('BSE result monitor failed:', err);
    process.exit(1);
  });
}

module.exports = { eventKey, eventAliases, findNewEvents, updateState, telegramMessage };
