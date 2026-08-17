import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('manifest collects the limited token as sensitive configuration', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  assert.equal(manifest.server.type, 'node');
  assert.equal(manifest.user_config.api_token.sensitive, true);
  assert.equal(manifest.user_config.api_token.required, true);
  assert.equal(manifest.server.mcp_config.env.AMAZING_MARVIN_API_TOKEN, '${user_config.api_token}');
  assert.equal(manifest.server.mcp_config.env.AMAZING_MARVIN_ENABLE_BETA_READS, '${user_config.enable_beta_reads}');
  assert.equal(manifest.user_config.enable_beta_reads.default, false);
  assert.deepEqual(Object.keys(manifest.user_config).sort(), ['api_token', 'enable_beta_reads']);
  assert.equal(manifest.user_config.api_token.description, 'Paste API_TOKEN from Amazing features → Integrations → API');
  assert.equal(manifest.user_config.enable_beta_reads.title, 'Enable experimental features');
  assert.equal(manifest.tools_generated, true);
  assert.deepEqual(manifest.tools.map(({ name }) => name).sort(), [
    'marvin_add_project',
    'marvin_add_task',
    'marvin_get_categories',
    'marvin_get_due_tasks',
    'marvin_get_goals',
    'marvin_get_labels',
    'marvin_get_todays_tasks',
    'marvin_get_tracked_item',
    'marvin_test_connection'
  ]);
  assert.deepEqual(manifest.compatibility.platforms, ['darwin']);
});

test('server never references the full-access token header', async () => {
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  assert.equal(source.includes('X-Full-Access-Token'), false);
  assert.equal(source.includes('FULL_ACCESS_TOKEN'), true, 'guidance should explicitly reject the full token');
  assert.equal(source.includes("'X-API-Token': TOKEN"), true);
  assert.equal(source.includes("redirect: 'error'"), true);
  assert.equal(source.includes("'X-Auto-Complete': 'false'"), true);
  assert.equal(source.includes('responseText.slice'), false, 'upstream response bodies must not enter tool errors');
  assert.equal(source.includes("TOKEN.startsWith('${')"), true);
  assert.equal(source.includes("MIN_INTERVAL_MS || 3_100"), true);
});

test('server exits cleanly on stdin EOF and writes no non-protocol stdout', async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, AMAZING_MARVIN_API_TOKEN: 'fake-token' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stdin.end();
  const [code, signal] = await once(child, 'exit');
  assert.equal(signal, null);
  assert.equal(code, 0);
  assert.equal(stdout, '');
});
