const { bseJson, send } = require('./_bse');

const BSE_ENDPOINT = '/Corpforthresults/w';

function parseBseDate(value) {
  const m = String(value || '').trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const months = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  const month = months[m[2]];
  if (month === undefined) return Number.MAX_SAFE_INTEGER;
  return Date.UTC(Number(m[3]), month, Number(m[1]));
}

function formatIsoDate(ms) {
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

function indiaTodayIso() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function addDaysIso(iso, days) {
  const ms = Date.parse(`${iso}T00:00:00Z`) + days * 86400000;
  return formatIsoDate(ms);
}

function toBseDate(value) {
  const m = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}`;
}

function extractRows(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.Table)) return raw.Table;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.Data)) return raw.Data;
  return [];
}

function normalizeRows(raw) {
  return extractRows(raw)
    .map(row => ({
      scripCode: String(row?.scrip_Code ?? row?.scripCode ?? row?.Scrip_Code ?? '').trim(),
      symbol: String(row?.short_name ?? row?.shortName ?? row?.symbol ?? '').trim(),
      company: String(row?.Long_Name ?? row?.long_name ?? row?.company ?? '').trim(),
      meetingDate: String(row?.meeting_date ?? row?.meetingDate ?? row?.date ?? '').trim(),
      url: String(row?.URL ?? row?.url ?? '').trim()
    }))
    .filter(row => row.scripCode && row.company && row.meetingDate)
    .sort((a, b) => parseBseDate(a.meetingDate) - parseBseDate(b.meetingDate) || a.symbol.localeCompare(b.symbol));
}

function filterFromToday(rows, todayIso = indiaTodayIso()) {
  const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
  return rows.filter(row => parseBseDate(row.meetingDate) >= todayMs);
}

function mapApiRows(raw, todayIso = indiaTodayIso()) {
  return filterFromToday(normalizeRows(raw), todayIso);
}

module.exports = async function(req, res) {
  try {
    const u = new URL(req.url, 'https://vercel.local');
    const today = indiaTodayIso();
    const requestedFrom = u.searchParams.get('from_date') || today;
    const requestedTo = u.searchParams.get('to_date') || addDaysIso(today, 91);
    const fromIso = requestedFrom < today ? today : requestedFrom;
    const toIso = requestedTo < fromIso ? addDaysIso(fromIso, 91) : requestedTo;
    const from = toBseDate(fromIso);
    const to = toBseDate(toIso);
    if (!from || !to) return send(res, 400, { message: 'from_date and to_date must use YYYY-MM-DD format' });

    const query = new URLSearchParams({ fromdate: from, todate: to });
    const raw = await bseJson(`${BSE_ENDPOINT}?${query.toString()}`);
    const data = mapApiRows(raw, today);

    return send(res, 200, {
      data,
      from_date: fromIso,
      to_date: toIso,
      today,
      count: data.length,
      updatedAt: new Date().toISOString(),
      source: `https://api.bseindia.com/BseIndiaAPI/api/Corpforthresults/w?fromdate=${from}&todate=${to}`
    });
  } catch (e) {
    return send(res, 502, { message: `Unable to fetch BSE result calendar: ${e.message}` });
  }
};

module.exports.normalizeRows = normalizeRows;
module.exports.filterFromToday = filterFromToday;
module.exports.mapApiRows = mapApiRows;
module.exports.parseBseDate = parseBseDate;
module.exports.indiaTodayIso = indiaTodayIso;
module.exports.addDaysIso = addDaysIso;
