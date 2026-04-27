import express, { Request, Response, NextFunction } from 'express';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import path from 'path';

// ── 简单内存速率限制器 ──
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
function rateLimit(windowMs: number, max: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const entry = rateLimitStore.get(key);
    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: 'Too many requests' });
    }
    entry.count++;
    next();
  };
}

const app = express();
const PORT = parseInt(process.env.PORT || '8000');
const JWT_SECRET = process.env.JWT_SECRET || 'changeme';

// 上游服务配置（精确路由匹配，从上到下优先匹配）
const ROUTES: Array<{ pattern: RegExp; target: string }> = [
  // MCP → MCP Server
  { pattern: /^\/mcp/, target: process.env.MCP_SERVER_URL || 'http://mcp-server:8084' },
  // Agent 执行 → Orchestrator
  { pattern: /^\/api\/v1\/agents\/[^/]+\/execute$/, target: process.env.ORCHESTRATOR_URL || 'http://orchestrator:8081' },
  // Executions → Orchestrator
  { pattern: /^\/api\/v1\/executions/, target: process.env.ORCHESTRATOR_URL || 'http://orchestrator:8081' },
  // LLM → LLM Gateway
  { pattern: /^\/api\/v1\/llm/, target: process.env.LLM_GATEWAY_URL || 'http://llm-gateway:8082' },
  // Tools → Tool Service
  { pattern: /^\/api\/v1\/tools/, target: process.env.TOOL_SERVICE_URL || 'http://tool-service:8083' },
  // Knowledge Base → DevKit API
  { pattern: /^\/api\/v1\/knowledge/, target: process.env.DEVKIT_API_URL || 'http://devkit-api:8080' },
  // Scheduler → DevKit API
  { pattern: /^\/api\/v1\/scheduler/, target: process.env.DEVKIT_API_URL || 'http://devkit-api:8080' },
  // Agents CRUD → DevKit API（兜底）
  { pattern: /^\/api\/v1\/agents/, target: process.env.DEVKIT_API_URL || 'http://devkit-api:8080' },
];

function resolveTarget(path: string): string | null {
  for (const route of ROUTES) {
    if (route.pattern.test(path)) return route.target;
  }
  return null;
}

app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

// ── 安全响应头 ──
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.removeHeader('X-Powered-By');
  next();
});

// ── CORS ──
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes('*') ? '*' : origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  }
  if (req.method === 'OPTIONS') return res.status(204).send('');
  next();
});

// ── 速率限制（API路径：每分钟200次）──
app.use('/api/', rateLimit(60_000, 200));

// ── 健康检查 ──
app.get('/health', async (_req: Request, res: Response) => {
  const checks: Record<string, { status: string; latency_ms?: number }> = {};
  
  const seen = new Set<string>();
  for (const route of ROUTES) {
    const serviceName = new URL(route.target).hostname;
    if (seen.has(serviceName)) continue;
    seen.add(serviceName);
    try {
      const start = Date.now();
      const headers: Record<string, string> = {};
      if (serviceName === 'litellm') {
        headers['Authorization'] = 'Bearer sk-relayops-master-key';
      }
      const resp = await fetch(`${route.target}/health`, { signal: AbortSignal.timeout(3000), headers });
      checks[serviceName] = { 
        status: resp.ok ? 'pass' : 'fail', 
        latency_ms: Date.now() - start 
      };
    } catch (err) {
      checks[serviceName] = { status: 'fail' };
    }
  }

  const allHealthy = Object.values(checks).every(c => c.status === 'pass');
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    service: 'api-gateway',
    version: process.env.VERSION || '0.1.0',
    timestamp: new Date().toISOString(),
    checks
  });
});

// ── 简易JWT验证中间件（MVP简化版）──
const MVP_SKIP_AUTH = process.env.MVP_SKIP_AUTH === 'true';

const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (MVP_SKIP_AUTH) {
    return next();
  }
  
  if (req.path === '/health') {
    return next();
  }
  
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }
  
  try {
    const token = auth.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    (req as any).user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

app.use(authMiddleware);

// ── 手动路由代理（更可控）──
async function proxyRequest(req: Request, res: Response, targetBase: string) {
  try {
    // 使用 req.url 保留查询参数（req.path 会丢失 ?page=1&status=... 等参数）
    const targetUrl = `${targetBase}${req.url}`;
    const headers: Record<string, string> = {
      'Content-Type': req.headers['content-type'] || 'application/json',
    };
    
    const options: RequestInit = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(60000)
    };
    
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      options.body = JSON.stringify(req.body);
    }
    
    const resp = await fetch(targetUrl, options);
    const body = await resp.text();
    
    res.status(resp.status);
    resp.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'content-encoding') {
        res.setHeader(key, value);
      }
    });
    res.send(body);
  } catch (err: any) {
    console.error(`Proxy error to ${targetBase}:`, err.message);
    res.status(502).json({ error: 'Upstream unavailable', message: err.message });
  }
}

app.all('/api/v1/*', (req: Request, res: Response) => {
  const target = resolveTarget(req.path);
  if (!target) {
    return res.status(404).json({ error: 'No upstream route found', path: req.path });
  }
  return proxyRequest(req, res, target);
});

// ── 监控指标 ──
app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const devkitUrl = process.env.DEVKIT_API_URL || 'http://devkit-api:8080';
    const orchUrl = process.env.ORCHESTRATOR_URL || 'http://orchestrator:8081';

    // 并行获取统计
    const [agentCount, execStats, toolCount] = await Promise.all([
      fetch(`${devkitUrl}/api/v1/agents`).then(r => r.json()).then(d => d.count || 0).catch(() => 0),
      fetch(`${orchUrl}/api/v1/executions/stats`).then(r => r.json()).catch(() => ({ total: 0, by_status: {} })),
      fetch(`${process.env.TOOL_SERVICE_URL || 'http://tool-service:8083'}/api/v1/tools`).then(r => r.json()).then(d => d.count || 0).catch(() => 0),
    ]);

    res.json({
      platform: {
        name: 'Agent Platform',
        version: process.env.VERSION || '0.1.0',
        uptime_seconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
      },
      agents: { total: agentCount },
      tools: { total: toolCount },
      executions: {
        total: execStats.total || 0,
        by_status: execStats.by_status || {},
        top_agents: execStats.by_agent || []
      },
      services: Object.keys(ROUTES.reduce((acc: Record<string,boolean>, r) => {
        try { acc[new URL(r.target).hostname] = true; } catch {}
        return acc;
      }, {}))
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 静态文件服务 (Web UI) ──
const STATIC_DIR = process.env.STATIC_DIR || path.join(process.cwd(), 'ui');
app.use('/app', express.static(STATIC_DIR));
app.get('/app/*', (_req: Request, res: Response) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

// ── 根路径 ──
app.get('/', (_req: Request, res: Response) => {
  res.redirect('/app');
});

// ── 错误处理 ──
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Gateway error:', err);
  res.status(500).json({ error: 'Internal gateway error' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API Gateway running on port ${PORT}`);
  console.log(`   Routes configured for:`, ['/api/v1/agents', '/api/v1/executions', '/api/v1/llm', '/api/v1/tools']);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
