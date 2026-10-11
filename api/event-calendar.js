const { bseJson, send } = require('./_bse');
const { nseJson } = require('./_nse');

const BSE_ENDPOINT = '/Corpforthresults/w';
const NSE_SOURCE_URL = 'https://www.nseindia.com/companies-listing/corporate-filings-event-calendar';
const BSE_SOURCE_URL = 'https://www.bseindia.com/corporates/corporate_act.aspx';

function parseDate(value) {
  const s = String(value || '').trim();
  let m = s.match(/^(\d{1,2})[- /]([A-Za-z]{3})[- /](\d{4})$/i);
  if (m) {
    const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
    const month = months[m[2].toLowerCase()];
    if (month !== undefined) return Date.UTC(Number(m[3]), month, Number(m[1]));
  }
  m = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (m) return Date.UTC(Number(m[1]), Number(m[2])-1, Number(m[3]));
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return Date.UTC(Number(m[3]), Number(m[2])-1, Number(m[1]));
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? Date.UTC(new Date(parsed).getUTCFullYear(), new Date(parsed).getUTCMonth(), new Date(parsed).getUTCDate()) : Number.MAX_SAFE_INTEGER;
}

function formatDisplayDate(value) {
  const ms = parseDate(value);
  if (ms === Number.MAX_SAFE_INTEGER) return String(value || '').trim();
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2,'0')} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function indiaTodayIso() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function addDaysIso(iso, days) { return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0,10); }
function toBseDate(iso) { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[1]}${m[2]}${m[3]}` : null; }
function extractRows(raw) {
  if (Array.isArray(raw)) return raw;
  for (const key of ['Table','table','data','Data','records','rows','result','events','eventCalendar','event_calendar']) if (Array.isArray(raw?.[key])) return raw[key];
  return [];
}
function isFinancialResultsText(value) { return /financial\s*results?|quarterly\s*results?|unaudited\s+results?|audited\s+results?/i.test(String(value || '')); }
function safeBseUrl(row, code) {
  const raw = String(row?.URL ?? row?.url ?? '').trim();
  if (/^https:\/\/www\.bseindia\.com\//i.test(raw)) return raw;
  const slug = String(row?.slug ?? '').trim();
  if (slug && /^[a-z0-9-]+$/i.test(slug)) return `https://www.bseindia.com/stock-share-price/${slug}/${slug}/${code}/`;
  return `https://www.bseindia.com/stock-share-price/`;
}
function normalizeBseRows(raw) {
  return extractRows(raw).map(row => {
    const code = String(row?.scrip_Code ?? row?.scripCode ?? row?.Scrip_Code ?? row?.scripcode ?? '').trim();
    const date = String(row?.meeting_date ?? row?.meetingDate ?? row?.date ?? row?.MeetingDate ?? '').trim();
    const company = String(row?.Long_Name ?? row?.long_name ?? row?.company ?? row?.CompanyName ?? '').trim();
    const symbol = String(row?.short_name ?? row?.shortName ?? row?.symbol ?? '').trim();
    return {
      id: `BSE|${code}|${formatDisplayDate(date)}`, exchange: 'BSE', scripCode: code, bseCode: code, nseSymbol: '', symbol,
      company, meetingDate: formatDisplayDate(date), resultsDate: formatDisplayDate(date), purpose: String(row?.purpose ?? row?.Purpose ?? 'Financial Results').trim(),
      url: safeBseUrl(row, code), bseUrl: safeBseUrl(row, code), nseUrl: '', sources: ['BSE']
    };
  }).filter(row => row.scripCode && row.company && row.meetingDate && parseDate(row.meetingDate) !== Number.MAX_SAFE_INTEGER);
}
function normalizeNseRows(raw) {
  return extractRows(raw).map(row => {
    const symbol = String(row?.symbol ?? row?.SYMBOL ?? row?.sm_symbol ?? row?.nseSymbol ?? row?.Symbol ?? '').trim().toUpperCase();
    const company = String(row?.company ?? row?.companyName ?? row?.company_name ?? row?.COMPANY ?? row?.sm_name ?? row?.companyname ?? row?.Company ?? '').trim();
    const purpose = String(row?.purpose ?? row?.bm_purpose ?? row?.bm_desc ?? row?.description ?? row?.subject ?? row?.PURPOSE ?? row?.event ?? row?.eventType ?? '').trim();
    const date = String(row?.meeting_date ?? row?.meetingDate ?? row?.bm_date ?? row?.date ?? row?.meetingDateTime ?? row?.meeting_date_time ?? row?.DATE ?? row?.eventDate ?? row?.meeting_date_str ?? '').trim();
    if (!isFinancialResultsText(purpose)) return null;
    const displayDate = formatDisplayDate(date);
    return {
      id: `NSE|${symbol}|${displayDate}`, exchange: 'NSE', scripCode: '', bseCode: '', nseSymbol: symbol, symbol,
      company, meetingDate: displayDate, resultsDate: displayDate, purpose,
      url: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`,
      bseUrl: '', nseUrl: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`, sources: ['NSE']
    };
  }).filter(row => row && row.nseSymbol && row.company && row.meetingDate && parseDate(row.meetingDate) !== Number.MAX_SAFE_INTEGER);
}
function filterFromToday(rows, todayIso = indiaTodayIso()) {
  const min = Date.parse(`${todayIso}T00:00:00Z`);
  return rows.filter(row => parseDate(row.meetingDate) >= min);
}
function mergeRows(bseRows, nseRows) {
  // Keep exchange listings distinct in the table/alerts, but merge links when the same company/date is obvious.
  const result = [];
  const byCompanyDate = new Map();
  for (const row of [...bseRows, ...nseRows]) {
    const normCompany = row.company.toLowerCase().replace(/\b(limited|ltd|india|company|corporation)\b/g, '').replace(/[^a-z0-9]/g, '');
    const key = `${normCompany}|${row.meetingDate}`;
    const prior = byCompanyDate.get(key);
    if (!prior) {
      const copy = { ...row, sources: [...row.sources] };
      byCompanyDate.set(key, copy); result.push(copy); continue;
    }
    if (row.exchange === 'BSE') { prior.bseCode = row.bseCode; prior.bseUrl = row.bseUrl; prior.scripCode = row.scripCode; }
    if (row.exchange === 'NSE') { prior.nseSymbol = row.nseSymbol; prior.nseUrl = row.nseUrl; if (!prior.symbol) prior.symbol = row.symbol; }
    if (!prior.sources.includes(row.exchange)) prior.sources.push(row.exchange);
    if (prior.exchange !== row.exchange) prior.exchange = 'NSE+BSE';
    prior.url = prior.bseUrl || prior.nseUrl || prior.url;
  }
  return result.sort((a,b) => parseDate(a.meetingDate)-parseDate(b.meetingDate) || a.company.localeCompare(b.company));
}
async function fetchCombinedRows(fromIso, toIso, { bseFetcher = bseJson, nseFetcher = nseJson } = {}) {
  const bsePath = `${BSE_ENDPOINT}?fromdate=${toBseDate(fromIso)}&todate=${toBseDate(toIso)}`;
  const results = await Promise.allSettled([
    bseFetcher(bsePath).then(raw => normalizeBseRows(raw)),
    nseFetcher(fromIso, toIso).then(raw => normalizeNseRows(raw))
  ]);
  const bse = results[0].status === 'fulfilled' ? results[0].value : [];
  const nse = results[1].status === 'fulfilled' ? results[1].value : [];
  const errors = [];
  if (results[0].status === 'rejected') errors.push(`BSE: ${results[0].reason?.message || results[0].reason}`);
  if (results[1].status === 'rejected') errors.push(`NSE: ${results[1].reason?.message || results[1].reason}`);
  if (errors.length === 2) throw new Error(`Both exchanges failed. ${errors.join(' | ')}`);
  return { data: mergeRows(filterFromToday(bse, fromIso), filterFromToday(nse, fromIso)), bseCount: bse.length, nseCount: nse.length, errors };
}

module.exports = async function(req, res) {
  try {
    const u = new URL(req.url, 'https://local');
    const today = indiaTodayIso();
    const requestedFrom = u.searchParams.get('from_date') || today;
    const requestedTo = u.searchParams.get('to_date') || addDaysIso(today, 91);
    const fromIso = requestedFrom < today ? today : requestedFrom;
    const toIso = requestedTo < fromIso ? addDaysIso(fromIso, 91) : requestedTo;
    if (!toBseDate(fromIso) || !toBseDate(toIso)) return send(res, 400, { message: 'from_date and to_date must use YYYY-MM-DD format' });
    const combined = await fetchCombinedRows(fromIso, toIso);
    return send(res, 200, { data: combined.data, from_date: fromIso, to_date: toIso, today, count: combined.data.length, bseCount: combined.bseCount, nseCount: combined.nseCount, sourceStatus: combined.errors, updatedAt: new Date().toISOString(), source: 'BSE India + NSE India' });
  } catch (e) {
    return send(res, 502, { message: `Unable to fetch result calendar from NSE/BSE: ${e.message}` });
  }
};

module.exports.normalizeBseRows = normalizeBseRows;
module.exports.normalizeNseRows = normalizeNseRows;
module.exports.filterFromToday = filterFromToday;
module.exports.parseBseDate = parseDate;
module.exports.indiaTodayIso = indiaTodayIso;
module.exports.addDaysIso = addDaysIso;
module.exports.mergeRows = mergeRows;
module.exports.fetchCombinedRows = fetchCombinedRows;
