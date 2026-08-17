import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [process.env.MCP_SERVER_PATH || 'server.js'],
  env: {
    ...process.env,
    AMAZING_MARVIN_API_TOKEN: 'deliberately-invalid-test-token'
  },
  stderr: 'pipe'
});
const protocolVersion = process.env.MCP_TEST_PROTOCOL_VERSION;
const client = new Client(
  { name: 'amazing-marvin-smoke-test', version: '0.3.2' },
  protocolVersion ? { supportedProtocolVersions: [protocolVersion] } : undefined
);

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  const expected = [
    'marvin_add_project',
    'marvin_add_task',
    'marvin_get_categories',
    'marvin_get_due_tasks',
    'marvin_get_goals',
    'marvin_get_labels',
    'marvin_get_tracked_item',
    'marvin_get_todays_tasks',
    'marvin_test_connection'
  ].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected tools: ${names.join(', ')}`);
  }
  const probe = await client.callTool({ name: 'marvin_test_connection', arguments: {} });
  if (!probe.isError || !JSON.stringify(probe.content).includes('rejected the API token')) {
    throw new Error(`Invalid-token probe did not fail safely: ${JSON.stringify(probe)}`);
  }
  console.log(`Smoke test passed${protocolVersion ? ` on ${protocolVersion}` : ''}: ${names.length} tools; invalid token was rejected safely.`);
} finally {
  await client.close();
}
