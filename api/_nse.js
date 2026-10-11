const NSE_HOME = 'https://www.nseindia.com/';
// Match the official NSE Event Calendar page, which exposes the upcoming event list.
const NSE_API = 'https://www.nseindia.com/api/event-calendar';
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/companies-listing/corporate-filings-event-calendar',
  'Origin': 'https://www.nseindia.com',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin'
};

function ddmmyyyy(iso) {
  const [y, m, d] = String(iso).split('-');
  return `${d}-${m}-${y}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function nseJson(fromIso, toIso) {
  let cookies = '';
  // NSE's public site may issue session cookies before its public JSON endpoint responds.
  try {
    const home = await fetchWithTimeout(NSE_HOME, { headers: { ...headers, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } }, 10000);
    const setCookies = typeof home.headers?.getSetCookie === 'function'
      ? home.headers.getSetCookie()
      : [home.headers?.get('set-cookie')].filter(Boolean);
    cookies = setCookies.map(x => String(x).split(';')[0]).filter(Boolean).join('; ');
    await home.text().catch(() => '');
  } catch (e) {
    console.warn(`NSE landing-page warmup failed: ${e.message}`);
  }
  const url = new URL(NSE_API);
  url.searchParams.set('index', 'equities');
  url.searchParams.set('from_date', ddmmyyyy(fromIso));
  url.searchParams.set('to_date', ddmmyyyy(toIso));
  const response = await fetchWithTimeout(url.toString(), {
    headers: { ...headers, ...(cookies ? { Cookie: cookies } : {}) }
  }, 25000);
  const text = await response.text();
  if (!response.ok) throw new Error(`NSE HTTP ${response.status}`);
  let payload;
  try { payload = JSON.parse(text); }
  catch { throw new Error('NSE returned non-JSON/HTML response'); }
  const hasRows = Array.isArray(payload) || Array.isArray(payload.data) || Array.isArray(payload.records) || Array.isArray(payload.events) || Array.isArray(payload.eventCalendar);
  if (typeof payload === 'string' || !hasRows) {
    throw new Error('NSE Event Calendar response did not contain a recognizable event list');
  }
  return payload;
}

module.exports = { nseJson, ddmmyyyy };
