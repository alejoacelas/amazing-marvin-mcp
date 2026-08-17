import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const token = (process.env.AMAZING_MARVIN_API_TOKEN || '').trim();
if (!token) throw new Error('AMAZING_MARVIN_API_TOKEN is required');
const allowWrites = process.env.MARVIN_ALLOW_WRITES === 'yes';
const enableBetaReads = process.env.MARVIN_ENABLE_BETA_READS === 'yes';
const onlyBetaReads = process.env.MARVIN_ONLY_BETA_READS === 'yes';
const prefix = process.env.MARVIN_QA_PREFIX || 'MCPB-QA-20260816-MCP';
const betaParentId = (process.env.MARVIN_QA_PARENT_ID || '').trim();
const betaTaskIds = (process.env.MARVIN_QA_TASK_IDS || '').split(',').map((value) => value.trim()).filter(Boolean);
const betaDate = (process.env.MARVIN_QA_DATE || '2026-08-16').trim();

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['server.js'],
  env: {
    ...process.env,
    AMAZING_MARVIN_API_TOKEN: token,
    AMAZING_MARVIN_ENABLE_BETA_READS: String(enableBetaReads)
  },
  stderr: 'pipe'
});
const client = new Client({ name: 'real-account-smoke', version: '0.3.1' });

function parse(result, name) {
  if (result.isError) throw new Error(`${name}: ${result.content?.[0]?.text || 'tool error'}`);
  const text = result.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return text; }
}

async function call(name, arguments_ = {}) {
  return parse(await client.callTool({ name, arguments: arguments_ }), name);
}

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const expectedTools = 9 + (enableBetaReads ? 5 : 0);
  console.log(`Real MCP configuration: writes=${allowWrites}, betaReads=${enableBetaReads}, tools=${tools.tools.length}.`);
  if (tools.tools.length !== expectedTools) throw new Error(`Expected ${expectedTools} tools, got ${tools.tools.length}`);
  if (!onlyBetaReads) {
    await call('marvin_test_connection');
    const reads = {
      today: await call('marvin_get_todays_tasks', { date: '2026-08-17', limit: 100 }),
      due: await call('marvin_get_due_tasks', { by: '2026-08-18', limit: 100 }),
      categories: await call('marvin_get_categories', { limit: 100 }),
      labels: await call('marvin_get_labels', { limit: 100 }),
      goals: await call('marvin_get_goals', { limit: 100 }),
      tracked: await call('marvin_get_tracked_item')
    };
    console.log(`Real MCP reads passed: today=${reads.today.total}, due=${reads.due.total}, categories=${reads.categories.total}, labels=${reads.labels.total}, goals=${reads.goals.total}, tracked=${reads.tracked.tracked_item ? 'yes' : 'no'}.`);
  }

  if (enableBetaReads) {
    const beta = {
      account: await call('marvin_who_am_i'),
      children: betaParentId ? await call('marvin_get_open_children_beta', { parent_id: betaParentId, limit: 100 }) : null,
      timeBlocks: await call('marvin_get_time_blocks_beta', { date: betaDate, limit: 100 }),
      tracks: betaTaskIds.length ? await call('marvin_get_time_tracking_history_beta', { task_ids: betaTaskIds }) : null,
      kudos: await call('marvin_get_kudos_beta')
    };
    if (!beta.account.masked_email || beta.children?.items.some((item) => item.done) || (beta.tracks && beta.tracks.items.length !== betaTaskIds.length) || !Number.isFinite(beta.kudos.level)) throw new Error('Beta read normalization failed');
    console.log(`Real MCP beta reads passed: account=masked, children=${beta.children?.total ?? 'skipped'}, timeBlocks=${beta.timeBlocks.total}, tracks=${beta.tracks?.items.length ?? 'skipped'}, kudosLevel=${beta.kudos.level}.`);
  }

  if (allowWrites) {
    const taskTitle = `${prefix} literal #not-project @not-label +tomorrow ~30 ^1`;
    const task = await call('marvin_add_task', { title: taskTitle, note: 'QA fixture; safe to delete', day: '2026-08-17', due_date: '2026-08-18', time_estimate_minutes: 20 });
    const project = await call('marvin_add_project', { title: `${prefix} empty project`, note: 'QA fixture; safe to delete', day: null, priority: 'mid' });
    const verifyTasks = await call('marvin_get_todays_tasks', { date: '2026-08-17', include_notes: true, limit: 100 });
    const verifyProjects = await call('marvin_get_categories', { limit: 100 });
    const createdTask = verifyTasks.items.find((item) => item.title === taskTitle);
    const createdProject = verifyProjects.items.find((item) => item.title === `${prefix} empty project`);
    if (!createdTask || createdTask.time_estimate_minutes !== 20 || createdTask.note !== 'QA fixture; safe to delete') throw new Error('Created task did not round-trip through MCP');
    if (!createdProject || createdProject.priority !== 'mid') throw new Error('Created project did not round-trip through MCP');
    console.log(`Real MCP writes passed: task=${task.id || createdTask.id}; project=${project.id || createdProject.id}.`);
  }
} finally {
  await client.close();
}
