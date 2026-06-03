import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type McpHost, type McpReport, createMcpHost } from '../../src/main/helper/mcp-host.js';

let host: McpHost;
let port: number;

/** Connect a real MCP client to a session's endpoint with a bearer token —
 *  exactly what the engine CLI does when it registers the server on Connect. */
async function connect(sessionId: string, token: string | undefined): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp/${sessionId}`),
    token === undefined
      ? undefined
      : { requestInit: { headers: { authorization: `Bearer ${token}` } } },
  );
  await client.connect(transport);
  return client;
}

beforeEach(async () => {
  host = createMcpHost();
  port = await host.listen();
});

afterEach(async () => {
  await host.close();
});

test('listen is idempotent and reports the bound port + endpoint', async () => {
  const again = await host.listen();
  assert.equal(again, port);
  assert.equal(host.port(), port);
  assert.equal(host.endpoint('s1'), `http://127.0.0.1:${port}/mcp/s1`);
});

test('a registered session routes a tool call to its onReport with the typed payload', async () => {
  const reports: McpReport[] = [];
  await host.register({ sessionId: 's1', token: 'tok', onReport: (r) => reports.push(r) });

  const client = await connect('s1', 'tok');
  const board = { focuses: [{ title: 'AI Helper', here: true }] };
  const result = await client.callTool({ name: 'report_dashboard', arguments: { board } });

  // The model sees a plain ack; the app receives the structured payload.
  assert.equal((result.content as Array<{ text: string }>)[0]?.text, 'received');
  assert.deepEqual(reports, [{ tool: 'report_dashboard', payload: board }]);
  await client.close();
});

test('a tool arg passed as a JSON string is normalized to an object (the Claude shape)', async () => {
  // Verified against the real CLIs (2026-06-03): under a loose schema Gemini
  // passes the arg as an object, Claude passes it as a JSON string. The host
  // parses the string so the renderer always receives structured data.
  const reports: McpReport[] = [];
  await host.register({ sessionId: 's1', token: 'tok', onReport: (r) => reports.push(r) });
  const client = await connect('s1', 'tok');
  const board = { focuses: [{ id: 'x' }], rollup: { inPlay: 1 } };
  await client.callTool({ name: 'report_dashboard', arguments: { board: JSON.stringify(board) } });
  assert.deepEqual(reports, [{ tool: 'report_dashboard', payload: board }]);
  await client.close();
});

test('the report tools are advertised on the session', async () => {
  await host.register({ sessionId: 's1', token: 'tok', onReport: () => {} });
  const client = await connect('s1', 'tok');
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  // The dashboard crawl plus the two curation ops (CR10).
  assert.ok(names.includes('report_dashboard'));
  assert.ok(names.includes('report_humanized'));
  assert.ok(names.includes('report_consolidation'));
  await client.close();
});

test('report_humanized routes its typed rewrites array to onReport (CR10)', async () => {
  const reports: McpReport[] = [];
  await host.register({ sessionId: 's1', token: 'tok', onReport: (r) => reports.push(r) });
  const client = await connect('s1', 'tok');
  const rewrites = ['the first thing, in plain words', 'the second thing'];
  await client.callTool({ name: 'report_humanized', arguments: { rewrites } });
  assert.deepEqual(reports, [{ tool: 'report_humanized', payload: rewrites }]);
  await client.close();
});

test('report_consolidation routes its typed {title,text} merge to onReport (CR10)', async () => {
  const reports: McpReport[] = [];
  await host.register({ sessionId: 's1', token: 'tok', onReport: (r) => reports.push(r) });
  const client = await connect('s1', 'tok');
  await client.callTool({
    name: 'report_consolidation',
    arguments: { title: 'Ship the thing', text: 'one combined piece of work' },
  });
  assert.deepEqual(reports, [
    {
      tool: 'report_consolidation',
      payload: { title: 'Ship the thing', text: 'one combined piece of work' },
    },
  ]);
  await client.close();
});

test('a wrong token is rejected and the callback never fires', async () => {
  let fired = false;
  await host.register({
    sessionId: 's1',
    token: 'tok',
    onReport: () => {
      fired = true;
    },
  });
  // The bad-token rejection surfaces as a failed connect/initialize.
  await assert.rejects(connect('s1', 'wrong'));
  assert.equal(fired, false);
});

test('an absent token is rejected and the callback never fires', async () => {
  let fired = false;
  await host.register({
    sessionId: 's1',
    token: 'tok',
    onReport: () => {
      fired = true;
    },
  });
  await assert.rejects(connect('s1', undefined));
  assert.equal(fired, false);
});

test('an unknown session is refused', async () => {
  await assert.rejects(connect('ghost', 'tok'));
});

test('an unregistered session (after unregister) is refused', async () => {
  await host.register({ sessionId: 's1', token: 'tok', onReport: () => {} });
  await host.unregister('s1');
  await assert.rejects(connect('s1', 'tok'));
});

test('two sessions route to their own callbacks', async () => {
  const a: McpReport[] = [];
  const b: McpReport[] = [];
  await host.register({ sessionId: 'a', token: 'ta', onReport: (r) => a.push(r) });
  await host.register({ sessionId: 'b', token: 'tb', onReport: (r) => b.push(r) });

  const ca = await connect('a', 'ta');
  const cb = await connect('b', 'tb');
  await ca.callTool({ name: 'report_dashboard', arguments: { board: 'from-a' } });
  await cb.callTool({ name: 'report_dashboard', arguments: { board: 'from-b' } });

  assert.deepEqual(a, [{ tool: 'report_dashboard', payload: 'from-a' }]);
  assert.deepEqual(b, [{ tool: 'report_dashboard', payload: 'from-b' }]);
  await ca.close();
  await cb.close();
});
