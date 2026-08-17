import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const API_ROOT = process.env.AMAZING_MARVIN_API_ROOT || 'https://serv.amazingmarvin.com/api';
const TOKEN = (process.env.AMAZING_MARVIN_API_TOKEN || '').trim();
const ENABLE_BETA_READS = process.env.AMAZING_MARVIN_ENABLE_BETA_READS === 'true';
const REQUEST_TIMEOUT_MS = Number(process.env.AMAZING_MARVIN_REQUEST_TIMEOUT_MS || 20_000);
const MIN_INTERVAL_MS = Number(process.env.AMAZING_MARVIN_MIN_INTERVAL_MS || 3_100);
const MAX_ITEMS = 100;
const MAX_OUTPUT = 25_000;

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

const DateString = z.string().refine(isDate, 'Use a real calendar date in YYYY-MM-DD format');
const MonthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const Title = z.string().trim().min(1).max(500);
const OptionalText = z.string().max(10_000).optional();
const Limit = z.number().int().min(1).max(MAX_ITEMS).optional().default(50);

function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timezoneOffset() {
  return -new Date().getTimezoneOffset();
}

function assertToken() {
  if (!TOKEN || TOKEN === 'PASTE_TOKEN_HERE' || TOKEN.startsWith('${')) {
    throw new Error('Amazing Marvin API token is missing. Configure the extension with API_TOKEN from Amazing features → Integrations → API; do not use FULL_ACCESS_TOKEN.');
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

let nextRequestAt = 0;
let throttleQueue = Promise.resolve();

async function throttle(operation) {
  const previous = throttleQueue;
  let release;
  throttleQueue = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) await delay(wait);
    return await operation();
  } finally {
    nextRequestAt = Date.now() + Math.max(0, MIN_INTERVAL_MS);
    release();
  }
}

function safeError(status, responseText) {
  if (status === 401 || status === 403 || /invalid access token/i.test(responseText)) {
    return 'Amazing Marvin rejected the API token. Copy API_TOKEN again from Amazing features → Integrations → API, or rotate it there and update this extension.';
  }
  if (status === 404) return 'Amazing Marvin could not find that item or endpoint.';
  if (status === 409) return 'Amazing Marvin rejected the request because it conflicts with current data. Refresh Marvin before trying again.';
  if (status === 429) return 'Amazing Marvin rate-limited the request. Wait at least three seconds before retrying.';
  if (status >= 500) return 'Amazing Marvin is temporarily unavailable. Try again later.';
  return `Amazing Marvin returned HTTP ${status}. Check Marvin before retrying any write request.`;
}

async function api(path, { method = 'GET', query, body, headers = {} } = {}) {
  assertToken();
  const url = new URL(`${API_ROOT}${path}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  return throttle(async () => {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          'X-API-Token': TOKEN,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error'
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' && method !== 'GET') throw new Error('Amazing Marvin did not respond before the timeout. The item may still have been created: check Marvin before retrying.');
      if (error?.name === 'TimeoutError') throw new Error('Amazing Marvin did not respond before the timeout. Check the network and try again.');
      if (method !== 'GET') throw new Error('Could not confirm the Amazing Marvin write. The item may still have been created: check Marvin before retrying.');
      throw new Error('Could not reach Amazing Marvin. Check the network or managed-device firewall and try again.');
    }

    const text = await response.text();
    if (!response.ok || /invalid access token/i.test(text)) throw new Error(safeError(response.status, text));
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  });
}

function expectArray(value, endpoint) {
  if (!Array.isArray(value)) throw new Error(`Amazing Marvin returned an unexpected response for ${endpoint}. No data was changed.`);
  return value;
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function note(value, include) {
  return include && typeof value === 'string' ? value.slice(0, 2_000) : undefined;
}

function normalizeItem(item, includeNotes) {
  if (!item || typeof item !== 'object') return null;
  return compact({
    id: item._id,
    title: item.title,
    type: item.type || (item.db === 'Tasks' ? 'task' : item.db === 'Projects' ? 'project' : undefined),
    done: Boolean(item.done),
    day: item.day || undefined,
    due_date: item.dueDate || undefined,
    parent_id: item.parentId || undefined,
    label_ids: Array.isArray(item.labelIds) ? item.labelIds : undefined,
    time_estimate_minutes: Number.isFinite(item.timeEstimate) ? item.timeEstimate / 60_000 : undefined,
    note: note(item.note, includeNotes)
  });
}

function normalizeCategory(item) {
  if (!item || typeof item !== 'object') return null;
  return compact({ id: item._id, title: item.title, type: item.type, parent_id: item.parentId, color: item.color, day: item.day || undefined, due_date: item.dueDate || undefined, priority: item.priority });
}

function normalizeLabel(item) {
  if (!item || typeof item !== 'object') return null;
  return compact({ id: item._id, title: item.title, color: item.color, icon: item.icon, group_id: item.groupId });
}

function normalizeGoal(item, includeDetails) {
  if (!item || typeof item !== 'object') return null;
  return compact({
    id: item._id,
    title: item.title,
    status: item.status,
    due_date: item.dueDate ?? undefined,
    parent_id: item.parentId,
    color: item.color,
    importance: item.importance,
    difficulty: item.difficulty,
    committed: item.committed,
    has_end: item.hasEnd,
    task_progress: item.taskProgress,
    note: note(item.note, includeDetails),
    motivations: includeDetails && Array.isArray(item.motivations) ? item.motivations.slice(0, 20) : undefined,
    sections: includeDetails && Array.isArray(item.sections) ? item.sections.slice(0, 20) : undefined
  });
}

function maskedEmail(value) {
  if (typeof value !== 'string' || !value.includes('@')) return undefined;
  const [local, domain] = value.split('@');
  return `${local.slice(0, 1)}${local.length > 1 ? '***' : ''}@${domain}`;
}

function normalizeTrack(item) {
  if (!item || typeof item !== 'object' || typeof item.taskId !== 'string' || !Array.isArray(item.times)) return null;
  const times = item.times.filter(Number.isFinite);
  return { task_id: item.taskId, times, interval_count: Math.floor(times.length / 2), currently_tracking: times.length % 2 === 1 };
}

function normalizeTimeBlock(item, includeNotes) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.title !== 'string' || typeof item.date !== 'string' || typeof item.time !== 'string' || !Number.isFinite(item.duration)) return null;
  return compact({
    id: item._id,
    title: item.title,
    date: item.date,
    start_time: item.time,
    duration_minutes: item.duration,
    note: note(item.note, includeNotes)
  });
}

function listResult(items, limit, normalizer) {
  const normalized = items.map(normalizer).filter(Boolean);
  return { items: normalized.slice(0, limit), returned: Math.min(normalized.length, limit), total: normalized.length, truncated: normalized.length > limit };
}

function result(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text.length > MAX_OUTPUT) throw new Error('The result is too large for one tool response. Use a smaller limit or exclude notes/details.');
  return { content: [{ type: 'text', text }] };
}

function failure(error) {
  return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Unexpected Amazing Marvin error.' }] };
}

function register(server, name, config, handler) {
  server.registerTool(name, config, async (input) => {
    try {
      return result(await handler(input));
    } catch (error) {
      return failure(error);
    }
  });
}

const server = new McpServer({ name: 'amazing-marvin', version: '0.3.0' });
const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

register(server, 'marvin_test_connection', {
  description: 'Verify the configured limited Amazing Marvin API token without reading or changing user data.',
  inputSchema: z.object({}), annotations: readAnnotations
}, async () => {
  const response = await api('/test', { method: 'POST' });
  if (response !== 'OK') throw new Error('Amazing Marvin returned an unexpected connection-test response.');
  return 'Connection successful.';
});

register(server, 'marvin_get_todays_tasks', {
  description: 'List open tasks and projects scheduled for one explicit local date, including rollover or auto-scheduled due items Marvin returns.',
  inputSchema: z.object({ date: DateString.optional(), include_notes: z.boolean().optional().default(false), limit: Limit }), annotations: readAnnotations
}, async ({ date, include_notes, limit }) => {
  const requestedDate = date || today();
  const items = expectArray(await api('/todayItems', { query: { date: requestedDate } }), 'todayItems');
  return { date: requestedDate, ...listResult(items, limit, (item) => normalizeItem(item, include_notes)) };
});

register(server, 'marvin_get_due_tasks', {
  description: 'List open tasks and projects due on or before one explicit local date.',
  inputSchema: z.object({ by: DateString.optional(), include_notes: z.boolean().optional().default(false), limit: Limit }), annotations: readAnnotations
}, async ({ by, include_notes, limit }) => {
  const requestedDate = by || today();
  const items = expectArray(await api('/dueItems', { query: { by: requestedDate } }), 'dueItems');
  return { by: requestedDate, ...listResult(items, limit, (item) => normalizeItem(item, include_notes)) };
});

register(server, 'marvin_get_categories', {
  description: 'List all Amazing Marvin categories and projects with IDs and parent relationships.',
  inputSchema: z.object({ limit: Limit }), annotations: readAnnotations
}, async ({ limit }) => listResult(expectArray(await api('/categories'), 'categories'), limit, normalizeCategory));

register(server, 'marvin_get_labels', {
  description: 'List all Amazing Marvin labels with IDs, colors, icons, and group IDs.',
  inputSchema: z.object({ limit: Limit }), annotations: readAnnotations
}, async ({ limit }) => listResult(expectArray(await api('/labels'), 'labels'), limit, normalizeLabel));

register(server, 'marvin_get_goals', {
  description: 'List Amazing Marvin goals. Notes, motivations, and sections are omitted unless include_details is true.',
  inputSchema: z.object({ include_details: z.boolean().optional().default(false), limit: Limit }), annotations: readAnnotations
}, async ({ include_details, limit }) => listResult(expectArray(await api('/goals'), 'goals'), limit, (item) => normalizeGoal(item, include_details)));

register(server, 'marvin_get_tracked_item', {
  description: 'Show the task currently being time-tracked without starting or stopping tracking.',
  inputSchema: z.object({}), annotations: readAnnotations
}, async () => {
  const item = await api('/trackedItem');
  return item ? { tracked_item: normalizeItem(item, false) } : { tracked_item: null };
});

if (ENABLE_BETA_READS) {
  register(server, 'marvin_who_am_i', {
    description: 'Confirm the connected Amazing Marvin account using a masked email and partial account ID. This read endpoint is not labelled stable; raw billing/profile fields are never returned.',
    inputSchema: z.object({}), annotations: readAnnotations
  }, async () => {
    const profile = await api('/me');
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Amazing Marvin returned an unexpected account response.');
    return { masked_email: maskedEmail(profile.email), account_id_suffix: typeof profile.userId === 'string' ? profile.userId.slice(-6) : undefined };
  });

  register(server, 'marvin_get_open_children_beta', {
    description: 'BETA: list direct open child tasks/projects for one category/project ID. This does not include grandchildren or completed items; an invalid parent may be indistinguishable from an empty parent.',
    inputSchema: z.object({ parent_id: z.string().min(1).max(200), include_notes: z.boolean().optional().default(false), limit: Limit }), annotations: readAnnotations
  }, async ({ parent_id, include_notes, limit }) => ({ parent_id, ...listResult(expectArray(await api('/children', { query: { parentId: parent_id } }), 'children'), limit, (item) => normalizeItem(item, include_notes)) }));

  register(server, 'marvin_get_time_blocks_beta', {
    description: 'BETA: list time blocks for one explicit local date. Marvin labels this endpoint experimental. This read does not create, move, or delete blocks; duration is returned in minutes.',
    inputSchema: z.object({ date: DateString.optional(), include_notes: z.boolean().optional().default(false), limit: Limit }), annotations: readAnnotations
  }, async ({ date, include_notes, limit }) => {
    const requestedDate = date || today();
    const items = expectArray(await api('/todayTimeBlocks', { query: { date: requestedDate } }), 'todayTimeBlocks');
    return { date: requestedDate, ...listResult(items, limit, (item) => normalizeTimeBlock(item, include_notes)) };
  });

  register(server, 'marvin_get_time_tracking_history_beta', {
    description: 'BETA: read source-of-truth tracking timestamps for up to 100 task IDs. This can reveal detailed work patterns. It does not start or stop tracking.',
    inputSchema: z.object({ task_ids: z.array(z.string().min(1).max(200)).min(1).max(100) }), annotations: readAnnotations
  }, async ({ task_ids }) => ({ items: expectArray(await api('/tracks', { method: 'POST', body: { taskIds: task_ids } }), 'tracks').map(normalizeTrack).filter(Boolean) }));

  register(server, 'marvin_get_kudos_beta', {
    description: 'BETA: read Marvin Kudos level and progress. This endpoint is not labelled stable.',
    inputSchema: z.object({}), annotations: readAnnotations
  }, async () => {
    const value = await api('/kudos');
    if (!value || typeof value !== 'object' || Array.isArray(value) || !['kudos', 'level', 'kudosRemaining'].every((key) => Number.isFinite(value[key]))) throw new Error('Amazing Marvin returned an unexpected kudos response.');
    return { kudos: value.kudos, level: value.level, kudos_remaining: value.kudosRemaining };
  });
}

const createFields = {
  title: Title,
  note: OptionalText,
  day: DateString.nullable().optional(),
  due_date: DateString.nullable().optional(),
  parent_id: z.string().min(1).max(200).optional(),
  label_ids: z.array(z.string().min(1).max(200)).max(50).optional(),
  time_estimate_minutes: z.number().int().min(1).max(1_440).optional(),
  is_starred: z.boolean().optional(),
  backburner: z.boolean().optional(),
  planned_week: DateString.nullable().optional(),
  planned_month: MonthString.nullable().optional(),
  review_date: DateString.nullable().optional()
};

function createPayload(input, extra = {}) {
  return compact({
    title: input.title,
    done: false,
    timeZoneOffset: timezoneOffset(),
    note: input.note,
    day: input.day,
    dueDate: input.due_date,
    parentId: input.parent_id,
    labelIds: input.label_ids,
    timeEstimate: input.time_estimate_minutes === undefined ? undefined : input.time_estimate_minutes * 60_000,
    isStarred: input.is_starred,
    backburner: input.backburner,
    plannedWeek: input.planned_week,
    plannedMonth: input.planned_month,
    reviewDate: input.review_date,
    ...extra
  });
}

function createdResult(response, input, kind) {
  const id = response && typeof response === 'object' ? response._id || response.id : undefined;
  return compact({ created: true, kind, id, title: input.title, day: input.day, due_date: input.due_date, parent_id: input.parent_id, label_ids: input.label_ids, time_estimate_minutes: input.time_estimate_minutes });
}

register(server, 'marvin_add_task', {
  description: 'Create one task using Marvin’s stable limited-access API. This is non-idempotent: show every proposed field and obtain explicit user approval immediately before calling it.',
  inputSchema: z.object(createFields), annotations: writeAnnotations
}, async (input) => {
  const response = await api('/addTask', { method: 'POST', body: createPayload(input), headers: { 'X-Auto-Complete': 'false' } });
  return createdResult(response, input, 'task');
});

register(server, 'marvin_add_project', {
  description: 'Create one project/category using Marvin’s stable limited-access API. This is non-idempotent and has no limited-token delete counterpart: show every proposed field and obtain explicit user approval immediately before calling it.',
  inputSchema: z.object({ ...createFields, priority: z.enum(['high', 'mid', 'low']).optional() }), annotations: writeAnnotations
}, async (input) => {
  const response = await api('/addProject', { method: 'POST', body: createPayload(input, { priority: input.priority }), headers: { 'X-Auto-Complete': 'false' } });
  return createdResult(response, input, 'project');
});

const transport = new StdioServerTransport();
await server.connect(transport);
