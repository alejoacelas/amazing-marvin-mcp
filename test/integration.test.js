import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const SECRET = 'super-secret-qa-token';

async function fakeApi() {
  const requests = [];
  let mode = 'normal';
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    const url = new URL(request.url, 'http://localhost');
    requests.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: request.headers, body, at: Date.now() });

    if (mode === 'timeout' && url.pathname === '/api/addTask') {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (mode === 'invalid-token-200') return response.end('Invalid access token');
    if (mode === 'wrong-shape' && url.pathname === '/api/categories') {
      response.setHeader('Content-Type', 'application/json');
      return response.end('{}');
    }
    if (mode === 'server-error') {
      response.statusCode = 500;
      return response.end(`private upstream body ${SECRET}`);
    }

    response.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/api/test') return response.end('"OK"');
    if (url.pathname === '/api/todayItems') return response.end(JSON.stringify([
      { _id: 'task-1', db: 'Tasks', title: 'Literal #project @label +tomorrow', done: false, day: '2026-08-17', dueDate: '2026-08-18', parentId: 'unassigned', labelIds: ['label-1'], timeEstimate: 600000, note: 'private note' },
      null
    ]));
    if (url.pathname === '/api/dueItems') return response.end(JSON.stringify([{ _id: 'task-2', db: 'Tasks', title: 'Due task', done: false, dueDate: '2026-08-17' }]));
    if (url.pathname === '/api/categories') return response.end(JSON.stringify([{ _id: 'project-1', title: 'Work', type: 'project', parentId: 'root', color: '#123456' }]));
    if (url.pathname === '/api/labels') return response.end(JSON.stringify([{ _id: 'label-1', title: 'Urgent', color: '#ff0000', icon: 'tag', groupId: 'group-1' }]));
    if (url.pathname === '/api/goals') return response.end(JSON.stringify([{ _id: 'goal-1', title: 'Ship safely', status: 'active', dueDate: '2026-12-31', note: 'private goal note', motivations: ['reason'], sections: [{ _id: 'section-1', title: 'First' }] }]));
    if (url.pathname === '/api/trackedItem') {
      if (mode === 'no-tracked-item') { response.statusCode = 204; return response.end(); }
      return response.end(JSON.stringify({ _id: 'task-3', db: 'Tasks', title: 'Tracked task' }));
    }
    if (url.pathname === '/api/me') return response.end(JSON.stringify({ email: 'tester@example.com', userId: 'account-123456', billingPeriod: 'private' }));
    if (url.pathname === '/api/children') return response.end(JSON.stringify([{ _id: 'child-1', db: 'Tasks', title: 'Direct child', done: false, parentId: url.searchParams.get('parentId'), dueDate: '2026-08-18' }]));
    if (url.pathname === '/api/todayTimeBlocks') return response.end(JSON.stringify([{ _id: 'block-1', title: 'Deep work', date: url.searchParams.get('date'), time: '14:00', duration: 60, note: 'private block note', fieldUpdates: { private: true } }]));
    if (url.pathname === '/api/tracks') return response.end(JSON.stringify((body.taskIds || []).map((taskId) => ({ taskId, times: [1000, 2000] }))));
    if (url.pathname === '/api/kudos') return response.end(JSON.stringify({ kudos: 12, level: 2, kudosRemaining: 88, private: 'omitted' }));
    if (url.pathname === '/api/addTask') return response.end(JSON.stringify({ _id: 'created-task', title: body.title }));
    if (url.pathname === '/api/addProject') return response.end(JSON.stringify({ _id: 'created-project', title: body.title }));
    response.statusCode = 404;
    return response.end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { server, requests, root: `http://127.0.0.1:${port}/api`, setMode(value) { mode = value; } };
}

async function connect(root, { timeout = 1_000, interval = 0, enableBetaReads = false } = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['server.js'],
    env: {
      ...process.env,
      AMAZING_MARVIN_API_TOKEN: SECRET,
      AMAZING_MARVIN_API_ROOT: root,
      AMAZING_MARVIN_REQUEST_TIMEOUT_MS: String(timeout),
      AMAZING_MARVIN_MIN_INTERVAL_MS: String(interval),
      AMAZING_MARVIN_ENABLE_BETA_READS: String(enableBetaReads)
    },
    stderr: 'pipe'
  });
  const client = new Client({ name: 'integration-test', version: '0.3.0' });
  await client.connect(transport);
  return { client, transport };
}

test('stable task and project creation are always model-visible', async () => {
  const api = await fakeApi();
  const { client } = await connect(api.root);
  try {
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 9);
    assert.equal(listed.tools.some(({ name }) => name === 'marvin_add_task'), true);
    assert.equal(listed.tools.some(({ name }) => name === 'marvin_add_project'), true);
  } finally {
    await client.close();
    api.server.close();
  }
});

test('beta switch exposes only tested read-only non-stable tools with normalized output', async () => {
  const api = await fakeApi();
  const { client } = await connect(api.root, { enableBetaReads: true });
  try {
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 14);
    for (const name of ['marvin_who_am_i', 'marvin_get_open_children_beta', 'marvin_get_time_blocks_beta', 'marvin_get_time_tracking_history_beta', 'marvin_get_kudos_beta']) {
      const tool = listed.tools.find((item) => item.name === name);
      assert.ok(tool, name);
      assert.equal(tool.annotations.readOnlyHint, true);
    }
    const me = json(await client.callTool({ name: 'marvin_who_am_i', arguments: {} }));
    assert.equal(me.masked_email, 't***@example.com');
    assert.equal(JSON.stringify(me).includes('billingPeriod'), false);
    const children = json(await client.callTool({ name: 'marvin_get_open_children_beta', arguments: { parent_id: 'project-1' } }));
    assert.equal(children.items[0].due_date, '2026-08-18');
    const blocks = json(await client.callTool({ name: 'marvin_get_time_blocks_beta', arguments: { date: '2026-08-16', include_notes: true } }));
    assert.deepEqual(blocks.items[0], { id: 'block-1', title: 'Deep work', date: '2026-08-16', start_time: '14:00', duration_minutes: 60, note: 'private block note' });
    assert.equal(JSON.stringify(blocks).includes('fieldUpdates'), false);
    assert.equal(api.requests.find((request) => request.path === '/api/todayTimeBlocks').query.date, '2026-08-16');
    assert.equal((await client.callTool({ name: 'marvin_get_time_blocks_beta', arguments: { date: '2026-02-30' } })).isError, true);
    const tracks = json(await client.callTool({ name: 'marvin_get_time_tracking_history_beta', arguments: { task_ids: ['task-1'] } }));
    assert.deepEqual(tracks.items[0], { task_id: 'task-1', times: [1000, 2000], interval_count: 1, currently_tracking: false });
    assert.deepEqual(json(await client.callTool({ name: 'marvin_get_kudos_beta', arguments: {} })), { kudos: 12, level: 2, kudos_remaining: 88 });
  } finally {
    await client.close();
    api.server.close();
  }
});

function json(result) {
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return JSON.parse(result.content[0].text);
}

test('all nine tools obey the stable API contracts', async () => {
  const api = await fakeApi();
  const { client } = await connect(api.root);
  try {
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 9);
    assert.equal((await client.callTool({ name: 'marvin_test_connection', arguments: {} })).content[0].text, 'Connection successful.');

    const today = json(await client.callTool({ name: 'marvin_get_todays_tasks', arguments: { date: '2026-08-17', limit: 20 } }));
    assert.equal(today.total, 1);
    assert.equal(today.items[0].title, 'Literal #project @label +tomorrow');
    assert.equal(today.items[0].note, undefined);
    const withNotes = json(await client.callTool({ name: 'marvin_get_todays_tasks', arguments: { date: '2026-08-17', include_notes: true } }));
    assert.equal(withNotes.items[0].note, 'private note');

    assert.equal(json(await client.callTool({ name: 'marvin_get_due_tasks', arguments: { by: '2026-08-17' } })).items[0].id, 'task-2');
    assert.equal(json(await client.callTool({ name: 'marvin_get_categories', arguments: {} })).items[0].parent_id, 'root');
    assert.equal(json(await client.callTool({ name: 'marvin_get_labels', arguments: {} })).items[0].group_id, 'group-1');
    const goals = json(await client.callTool({ name: 'marvin_get_goals', arguments: { include_details: true } }));
    assert.equal(goals.items[0].note, 'private goal note');
    assert.equal(json(await client.callTool({ name: 'marvin_get_tracked_item', arguments: {} })).tracked_item.id, 'task-3');

    const task = json(await client.callTool({ name: 'marvin_add_task', arguments: { title: ' literal #project @label +tomorrow ', day: '2026-08-17', due_date: '2026-08-18', time_estimate_minutes: 10, label_ids: ['label-1'] } }));
    assert.equal(task.id, 'created-task');
    const project = json(await client.callTool({ name: 'marvin_add_project', arguments: { title: 'QA project', day: null, priority: 'high' } }));
    assert.equal(project.id, 'created-project');

    const taskRequest = api.requests.find((request) => request.path === '/api/addTask');
    assert.equal(taskRequest.headers['x-auto-complete'], 'false');
    assert.equal(taskRequest.body.title, 'literal #project @label +tomorrow');
    assert.equal(taskRequest.body.timeEstimate, 600000);
    assert.equal(Number.isInteger(taskRequest.body.timeZoneOffset), true);
    const projectRequest = api.requests.find((request) => request.path === '/api/addProject');
    assert.equal(projectRequest.body.day, null);
    assert.equal(projectRequest.body.priority, 'high');
    assert.equal(api.requests.every((request) => request.headers['x-api-token'] === SECRET), true);
  } finally {
    await client.close();
    api.server.close();
  }
});

test('auth, malformed data, empty tracking, API errors, and ambiguous writes fail safely', async () => {
  const api = await fakeApi();
  const { client } = await connect(api.root, { timeout: 30 });
  try {
    api.setMode('invalid-token-200');
    let response = await client.callTool({ name: 'marvin_test_connection', arguments: {} });
    assert.equal(response.isError, true);
    assert.match(response.content[0].text, /rejected the API token/i);

    api.setMode('wrong-shape');
    response = await client.callTool({ name: 'marvin_get_categories', arguments: {} });
    assert.equal(response.isError, true);
    assert.match(response.content[0].text, /unexpected response/i);

    api.setMode('no-tracked-item');
    assert.equal(json(await client.callTool({ name: 'marvin_get_tracked_item', arguments: {} })).tracked_item, null);

    api.setMode('server-error');
    response = await client.callTool({ name: 'marvin_get_labels', arguments: {} });
    assert.equal(response.isError, true);
    assert.equal(response.content[0].text.includes(SECRET), false);
    assert.equal(response.content[0].text.includes('private upstream body'), false);

    api.setMode('timeout');
    response = await client.callTool({ name: 'marvin_add_task', arguments: { title: 'Ambiguous write' } });
    assert.equal(response.isError, true);
    assert.match(response.content[0].text, /may still have been created/i);
    assert.equal(api.requests.filter((request) => request.path === '/api/addTask').length, 1, 'writes are never retried');
  } finally {
    await client.close();
    api.server.close();
  }
});

test('date and write schemas reject impossible or unsafe inputs before an API call', async () => {
  const api = await fakeApi();
  const { client } = await connect(api.root);
  try {
    const before = api.requests.length;
    for (const arguments_ of [{ date: '2026-02-30' }, { date: '2026-00-10' }, { date: 'not-a-date' }]) {
      const response = await client.callTool({ name: 'marvin_get_todays_tasks', arguments: arguments_ });
      assert.equal(response.isError, true);
    }
    for (const arguments_ of [{ title: '   ' }, { title: 'x'.repeat(501) }, { title: 'x', time_estimate_minutes: 0 }, { title: 'x', time_estimate_minutes: 1.5 }, { title: 'x', time_estimate_minutes: 1441 }]) {
      const response = await client.callTool({ name: 'marvin_add_task', arguments: arguments_ });
      assert.equal(response.isError, true);
    }
    assert.equal(api.requests.length, before);
  } finally {
    await client.close();
    api.server.close();
  }
});

test('concurrent reads are serialized by the vendor-rate-limit queue', async () => {
  const api = await fakeApi();
  const { client } = await connect(api.root, { interval: 40 });
  try {
    await Promise.all([
      client.callTool({ name: 'marvin_get_categories', arguments: {} }),
      client.callTool({ name: 'marvin_get_labels', arguments: {} }),
      client.callTool({ name: 'marvin_get_goals', arguments: {} })
    ]);
    const gaps = api.requests.slice(1).map((request, index) => request.at - api.requests[index].at);
    assert.equal(gaps.every((gap) => gap >= 35), true, JSON.stringify(gaps));
  } finally {
    await client.close();
    api.server.close();
  }
});
