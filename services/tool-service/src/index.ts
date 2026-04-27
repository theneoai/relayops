import express, { Request, Response } from 'express';
import morgan from 'morgan';
import { Pool } from 'pg';

const app = express();
const PORT = parseInt(process.env.PORT || '8083');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:changeme@postgres:5432/agent_platform'
});

app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

// ── 内置工具实现 ──
const BUILT_IN_TOOLS: Record<string, (inputs: any) => Promise<any>> = {
  // 天气查询（Mock）
  weather_query: async (inputs: { city?: string }) => {
    const city = inputs.city || '北京';
    const mockData: Record<string, any> = {
      '北京': { temperature: 22, condition: '晴', humidity: 45, wind: '3级', city: '北京' },
      '上海': { temperature: 25, condition: '多云', humidity: 60, wind: '4级', city: '上海' },
      '深圳': { temperature: 28, condition: '晴', humidity: 70, wind: '2级', city: '深圳' },
      '杭州': { temperature: 23, condition: '小雨', humidity: 80, wind: '3级', city: '杭州' },
    };
    return mockData[city] || { temperature: 20, condition: '未知', humidity: 50, wind: '微风', city };
  },

  // 订单查询（Mock）
  order_query: async (inputs: { order_id?: string }) => {
    const orderId = inputs.order_id || 'ORD-' + Math.floor(Math.random() * 100000);
    const statuses = ['待付款', '已付款', '已发货', '运输中', '已签收', '已完成'];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    return {
      order_id: orderId,
      status,
      amount: Math.floor(Math.random() * 1000) + 100,
      currency: 'CNY',
      created_at: new Date(Date.now() - Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000)).toISOString(),
      items: [
        { name: '示例商品A', quantity: 1, price: 299 },
        { name: '示例商品B', quantity: 2, price: 199 }
      ]
    };
  },

  // 汇率查询（Mock）
  exchange_rate: async (inputs: { from?: string; to?: string }) => {
    const from = inputs.from || 'CNY';
    const to = inputs.to || 'USD';
    const rates: Record<string, number> = { 'CNY-USD': 0.138, 'USD-CNY': 7.25, 'CNY-EUR': 0.128, 'EUR-CNY': 7.82 };
    const rate = rates[`${from}-${to}`] || 1.0;
    return { from, to, rate, timestamp: new Date().toISOString() };
  },

  // 发送邮件（Mock）
  send_email: async (inputs: { to?: string; subject?: string; body?: string }) => {
    return {
      message_id: `MSG-${Date.now()}`,
      to: inputs.to || 'user@example.com',
      subject: inputs.subject || '无主题',
      status: 'sent',
      sent_at: new Date().toISOString()
    };
  },

  // ── 新增工具 ──

  // HTTP请求
  http_request: async (inputs: { url: string; method?: string; headers?: Record<string, string>; body?: any; timeout?: number }) => {
    const method = (inputs.method || 'GET').toUpperCase();
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(inputs.headers || {}) };
    const options: RequestInit = { method, headers, signal: AbortSignal.timeout((inputs.timeout || 30) * 1000) };
    if (inputs.body && method !== 'GET' && method !== 'HEAD') {
      options.body = typeof inputs.body === 'string' ? inputs.body : JSON.stringify(inputs.body);
    }
    const resp = await fetch(inputs.url, options);
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return {
      status: resp.status,
      statusText: resp.statusText,
      headers: Object.fromEntries(resp.headers.entries()),
      body: json || text
    };
  },

  // 搜索（Mock聚合搜索）
  search: async (inputs: { query: string; limit?: number }) => {
    const query = inputs.query || '';
    const limit = inputs.limit || 5;
    // Mock搜索结果
    const results = [
      { title: `${query} - 百度百科`, url: `https://baike.baidu.com/item/${encodeURIComponent(query)}`, snippet: `${query}的相关百科信息...` },
      { title: `${query} - 知乎`, url: `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(query)}`, snippet: `关于${query}的热门讨论...` },
      { title: `${query} - 维基百科`, url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(query)}`, snippet: `${query}的维基百科条目...` },
      { title: `${query}相关新闻`, url: `https://news.baidu.com/ns?word=${encodeURIComponent(query)}`, snippet: `最新关于${query}的新闻报道...` },
      { title: `${query} - 相关文档`, url: `https://www.google.com/search?q=${encodeURIComponent(query)}`, snippet: `Google搜索结果摘要...` },
    ].slice(0, limit);
    return { query, results, total: results.length, source: 'mock_search' };
  },

  // 计算器（使用 Function 构造函数 + 严格字符白名单，避免 eval 风险）
  calculator: async (inputs: { expression: string }) => {
    const expr = inputs.expression || '';
    try {
      // 只允许数字、基本运算符和括号，不允许任何字母（防止函数调用或变量注入）
      const sanitized = expr.replace(/\s/g, '');
      if (!/^[\d+\-*/.()%]+$/.test(sanitized)) {
        throw new Error('Expression contains invalid characters');
      }
      // 无字母 = 无函数调用、无关键字，Function 构造在此场景安全
      // eslint-disable-next-line no-new-func
      const fn = new Function(`"use strict"; return (${sanitized});`);
      const result = fn() as number;
      if (typeof result !== 'number' || !isFinite(result)) {
        throw new Error('Expression did not produce a finite number');
      }
      return { expression: expr, result, status: 'success' };
    } catch (err: any) {
      return { expression: expr, error: err.message, status: 'error' };
    }
  },

  // 日期时间
  datetime: async (inputs: { format?: string; timezone?: string }) => {
    const now = new Date();
    const format = inputs.format || 'iso';
    const tz = inputs.timezone || 'Asia/Shanghai';
    return {
      iso: now.toISOString(),
      timestamp: now.getTime(),
      local: now.toLocaleString('zh-CN', { timeZone: tz }),
      date: now.toLocaleDateString('zh-CN', { timeZone: tz }),
      time: now.toLocaleTimeString('zh-CN', { timeZone: tz }),
      timezone: tz,
      format
    };
  },

  // 文件操作（Mock）
  file_ops: async (inputs: { operation: 'read' | 'write' | 'list' | 'delete'; path?: string; content?: string }) => {
    const op = inputs.operation;
    const filePath = inputs.path || '/tmp/mockfile.txt';
    switch (op) {
      case 'read':
        return { operation: op, path: filePath, content: 'Mock file content for: ' + filePath, size: 1024, exists: true };
      case 'write':
        return { operation: op, path: filePath, bytes_written: (inputs.content || '').length, status: 'written' };
      case 'list':
        return { operation: op, path: filePath, files: ['file1.txt', 'file2.json', 'data.csv'], count: 3 };
      case 'delete':
        return { operation: op, path: filePath, status: 'deleted' };
      default:
        return { operation: op, error: 'Unknown operation', supported: ['read', 'write', 'list', 'delete'] };
    }
  },

  // 随机数生成
  random: async (inputs: { min?: number; max?: number; count?: number; type?: 'int' | 'float' | 'uuid' | 'string' }) => {
    const type = inputs.type || 'int';
    const min = inputs.min ?? 0;
    const max = inputs.max ?? 100;
    const count = inputs.count ?? 1;
    const results: any[] = [];
    for (let i = 0; i < count; i++) {
      if (type === 'int') results.push(Math.floor(Math.random() * (max - min + 1)) + min);
      else if (type === 'float') results.push(Math.random() * (max - min) + min);
      else if (type === 'uuid') results.push(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
      else if (type === 'string') results.push(Math.random().toString(36).slice(2, 10));
    }
    return count === 1 ? { value: results[0], type } : { values: results, type, count };
  },

  // JSON处理
  json_processor: async (inputs: { operation: 'parse' | 'stringify' | 'get' | 'set' | 'filter'; data: any; path?: string; value?: any; key?: string }) => {
    const op = inputs.operation;
    switch (op) {
      case 'parse':
        return { result: typeof inputs.data === 'string' ? JSON.parse(inputs.data) : inputs.data };
      case 'stringify':
        return { result: JSON.stringify(inputs.data, null, 2) };
      case 'get': {
        const keys = (inputs.path || '').split('.');
        let val = inputs.data;
        for (const k of keys) { val = val?.[k]; }
        return { result: val };
      }
      case 'set': {
        const keys = (inputs.path || '').split('.');
        const obj = { ...inputs.data };
        let target: any = obj;
        for (let i = 0; i < keys.length - 1; i++) { target = target[keys[i]] = target[keys[i]] || {}; }
        target[keys[keys.length - 1]] = inputs.value;
        return { result: obj };
      }
      case 'filter': {
        const arr = Array.isArray(inputs.data) ? inputs.data : [];
        const filtered = arr.filter((item: any) => {
          const val = inputs.key ? item[inputs.key] : JSON.stringify(item);
          return String(val).toLowerCase().includes(String(inputs.value || '').toLowerCase());
        });
        return { result: filtered, count: filtered.length, total: arr.length };
      }
      default:
        return { error: 'Unknown operation', supported: ['parse', 'stringify', 'get', 'set', 'filter'] };
    }
  }
};

// ── 健康检查 ──
app.get('/health', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', service: 'tool-service', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: 'Database unavailable' });
  }
});

// ── 列出工具 ──
app.get('/api/v1/tools', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, description, method, input_schema, output_schema, enabled FROM tools WHERE enabled = true ORDER BY name'
    );
    const dbTools = result.rows;
    const builtInToolNames = Object.keys(BUILT_IN_TOOLS);
    // 为内置工具生成schema描述
    const builtInSchemas: Record<string, any> = {
      weather_query: { description: '查询指定城市的天气情况', inputs: { city: 'string' }, outputs: { temperature: 'number', condition: 'string', humidity: 'number' } },
      order_query: { description: '查询订单信息', inputs: { order_id: 'string' }, outputs: { order_id: 'string', status: 'string', amount: 'number' } },
      exchange_rate: { description: '查询货币汇率', inputs: { from: 'string', to: 'string' }, outputs: { from: 'string', to: 'string', rate: 'number' } },
      send_email: { description: '发送邮件（Mock）', inputs: { to: 'string', subject: 'string', body: 'string' }, outputs: { message_id: 'string', status: 'string' } },
      http_request: { description: '发送HTTP请求', inputs: { url: 'string', method: 'string', headers: 'object', body: 'any', timeout: 'number' }, outputs: { status: 'number', body: 'any' } },
      search: { description: '执行搜索查询', inputs: { query: 'string', limit: 'number' }, outputs: { results: 'array', total: 'number' } },
      calculator: { description: '计算数学表达式', inputs: { expression: 'string' }, outputs: { result: 'number', status: 'string' } },
      datetime: { description: '获取当前日期时间', inputs: { format: 'string', timezone: 'string' }, outputs: { iso: 'string', local: 'string', date: 'string', time: 'string' } },
      file_ops: { description: '文件操作（Mock）', inputs: { operation: 'string', path: 'string', content: 'string' }, outputs: { operation: 'string', path: 'string', content: 'string' } },
      random: { description: '生成随机数/UUID/字符串', inputs: { type: 'string', min: 'number', max: 'number', count: 'number' }, outputs: { value: 'any', values: 'array' } },
      json_processor: { description: 'JSON处理工具', inputs: { operation: 'string', data: 'any', path: 'string', value: 'any', key: 'string' }, outputs: { result: 'any' } }
    };
    // MCP标准化：生成MCP-compatible的工具schema
    const mcpTools = builtInToolNames.map(name => {
      const schema = builtInSchemas[name];
      return {
        name,
        description: schema.description,
        inputSchema: {
          type: 'object',
          properties: Object.fromEntries(Object.entries(schema.inputs).map(([k, v]) => [k, { type: v }])),
          required: Object.keys(schema.inputs)
        },
        source: 'built_in',
        mcp_enabled: true
      };
    });

    res.json({
      tools: dbTools,
      built_in: builtInToolNames.map(name => ({ name, ...builtInSchemas[name], source: 'built_in' })),
      mcp_tools: mcpTools,
      count: dbTools.length + builtInToolNames.length
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 返回数据是模拟数据的工具集合
const MOCK_TOOLS = new Set(['weather_query', 'order_query', 'exchange_rate', 'send_email', 'search', 'file_ops']);

// ── 调用工具 ──
app.post('/api/v1/tools/:name/invoke', async (req: Request, res: Response) => {
  const toolName = req.params.name;
  const inputs = req.body;
  const startTime = Date.now();

  try {
    const builtIn = BUILT_IN_TOOLS[toolName];
    if (builtIn) {
      const result = await builtIn(inputs);
      return res.json({
        tool: toolName,
        result,
        latency_ms: Date.now() - startTime,
        source: 'built_in',
        ...(MOCK_TOOLS.has(toolName) && { mock: true, note: 'This tool returns simulated data. Replace with a real integration for production use.' })
      });
    }

    const dbResult = await pool.query('SELECT * FROM tools WHERE name = $1 AND enabled = true', [toolName]);
    if (dbResult.rows.length === 0) {
      return res.status(404).json({ error: `Tool '${toolName}' not found` });
    }

    const toolDef = dbResult.rows[0];
    if (toolDef.endpoint) {
      const resp = await fetch(toolDef.endpoint, {
        method: toolDef.method || 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputs),
        signal: AbortSignal.timeout(30000)
      });
      const result = await resp.json();
      return res.json({
        tool: toolName,
        result,
        latency_ms: Date.now() - startTime,
        source: 'external'
      });
    }

    res.status(400).json({ error: 'Tool has no implementation' });
  } catch (err: any) {
    console.error(`Tool invocation error (${toolName}):`, err);
    res.status(500).json({ error: err.message, tool: toolName });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔧 Tool Service running on port ${PORT}`);
  console.log(`   Built-in tools:`, Object.keys(BUILT_IN_TOOLS));
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
