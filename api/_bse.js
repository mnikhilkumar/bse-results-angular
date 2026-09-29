const BASE = process.env.BSE_BASE_URL || 'https://api.bseindia.com/BseIndiaAPI/api';
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://www.bseindia.com',
  'Referer': 'https://www.bseindia.com/',
  'Cache-Control': 'no-cache'
};

async function bseJson(pathname) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(BASE + pathname, { headers, signal: controller.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`BSE HTTP ${r.status}`);
    try { return JSON.parse(text); }
    catch { throw new Error('BSE returned non-JSON response'); }
  } finally {
    clearTimeout(timer);
  }
}

function send(res, status, body) {
  res.status(status).setHeader('content-type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(body));
}

module.exports = { bseJson, send };
