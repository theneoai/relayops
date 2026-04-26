import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

const app = express();
const PORT = parseInt(process.env.PORT || '8084');
const DEVKIT_API = process.env.DEVKIT_API_URL || 'http://devkit-api:8080';
const ORCHESTRATOR = process.env.ORCHESTRATOR_URL || 'http://orchestrator:8081';
const TOOL_SERVICE = process.env.TOOL_SERVICE_URL || 'http://tool-service:8083';

const server = new McpServer({
  name: 'agent-platform-mcp',
  version: '0.1.0'
});

// ── TOOLS ──

server.tool(
  'list_agents',
  'List all registered agents on the platform',
  {},
  async () => {
    const res = await fetch(`${DEVKIT_API}/api/v1/agents`);
    const data = await res.json();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(data.agents || [], null, 2) }]
    };
  }
);

server.tool(
  'execute_agent',
  'Execute an agent with user input and return the result',
  {
    agent_name: z.string().describe('The name of the agent to execute'),
    input: z.string().describe('The user input / query to send to the agent')
  },
  async ({ agent_name, input }) => {
    const res = await fetch(`${ORCHESTRATOR}/api/v1/executions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agent_name, input })
    });
    const data = await res.json();
    const text = data.response || JSON.stringify(data, null, 2);
    return {
      content: [{ type: 'text' as const, text }]
    };
  }
);

server.tool(
  'list_tools',
  'List all available tools on the platform',
  {},
  async () => {
    const res = await fetch(`${TOOL_SERVICE}/api/v1/tools`);
    const data = await res.json();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(data.tools || [], null, 2) }]
    };
  }
);

server.tool(
  'invoke_tool',
  'Invoke a platform tool by name with JSON inputs',
  {
    tool_name: z.string().describe('The name of the tool to invoke'),
    inputs: z.string().describe('JSON string of tool input parameters')
  },
  async ({ tool_name, inputs }) => {
    const res = await fetch(`${TOOL_SERVICE}/api/v1/tools/${tool_name}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: inputs
    });
    const data = await res.json();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }]
    };
  }
);

// ── RESOURCES ──

server.resource(
  'agents-list',
  'agents://list',
  async (uri) => {
    const res = await fetch(`${DEVKIT_API}/api/v1/agents`);
    const data = await res.json();
    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify(data.agents || [], null, 2),
        mimeType: 'application/json'
      }]
    };
  }
);

// ── SSE TRANSPORT ──

const transports = new Map<string, SSEServerTransport>();

app.get('/mcp/sse', async (_req, res) => {
  const transport = new SSEServerTransport('/mcp/messages', res);
  transports.set(transport.sessionId, transport);
  console.log(`[MCP] SSE connected, sessionId=${transport.sessionId}`);
  res.on('close', () => {
    console.log(`[MCP] SSE disconnected, sessionId=${transport.sessionId}`);
    transports.delete(transport.sessionId);
  });
  await server.connect(transport);
});

app.post('/mcp/messages', async (req, res) => {
  const sessionId = req.query.sessionId as string;
  console.log(`[MCP] POST /messages sessionId=${sessionId}, content-type=${req.headers['content-type']}`);
  const transport = transports.get(sessionId);
  if (!transport) {
    console.log(`[MCP] Transport not found for sessionId=${sessionId}`);
    return res.status(503).json({ error: 'SSE transport not found for sessionId: ' + sessionId });
  }
  try {
    await transport.handlePostMessage(req, res);
  } catch (err: any) {
    console.error(`[MCP] handlePostMessage error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'mcp-server' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔌 MCP Server running on port ${PORT}`);
  console.log(`   SSE endpoint: http://localhost:${PORT}/mcp/sse`);
});
