const token = (process.env.AMAZING_MARVIN_API_TOKEN || '').trim();
if (!token) throw new Error('AMAZING_MARVIN_API_TOKEN is required');

const root = 'https://serv.amazingmarvin.com/api';
const interval = 3_100;
let lastRequest = 0;

async function request(path, { method = 'GET', query, body } = {}) {
  const wait = Math.max(0, lastRequest + interval - Date.now());
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  const url = new URL(`${root}${path}`);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    method,
    headers: {
      'X-API-Token': token,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(20_000)
  });
  lastRequest = Date.now();
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  try { return JSON.parse(text); } catch { return text || null; }
}

function shape(value) {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return 'null';
  return typeof value === 'object' ? `object(${Object.keys(value).sort().join(',')})` : typeof value;
}

const date = process.env.MARVIN_QA_DATE || '2026-08-17';
const taskIds = (process.env.MARVIN_QA_TASK_IDS || '').split(',').map((value) => value.trim()).filter(Boolean);
const parentId = process.env.MARVIN_QA_PARENT_ID || 'unassigned';

const me = await request('/me');
const kudos = await request('/kudos');
const habits = await request('/habits');
const children = await request('/children', { query: { parentId } });
const timeBlocks = await request('/todayTimeBlocks', { query: { date } });
const tracks = taskIds.length ? await request('/tracks', { method: 'POST', body: { taskIds } }) : [];

const evidence = {
  me: {
    shape: shape(me),
    keys: me && typeof me === 'object' ? Object.keys(me).sort() : [],
    has_email: Boolean(me?.email)
  },
  kudos: {
    shape: shape(kudos),
    values_are_numbers: ['kudos', 'level', 'kudosRemaining'].every((key) => Number.isFinite(kudos?.[key]))
  },
  habits: { shape: shape(habits) },
  children: { parent_id: parentId, shape: shape(children), ids: Array.isArray(children) ? children.map((item) => item?._id).filter(Boolean) : [] },
  today_time_blocks: { date, shape: shape(timeBlocks) },
  tracks: { requested: taskIds.length, shape: shape(tracks), returned: Array.isArray(tracks) ? tracks.length : null }
};

console.log(JSON.stringify(evidence, null, 2));
