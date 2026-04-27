import express, { Request, Response } from 'express';
import morgan from 'morgan';
import { Pool } from 'pg';
import IORedis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { Langfuse } from 'langfuse-node';

const app = express();
const PORT = parseInt(process.env.PORT || '8081');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:changeme@postgres:5432/agent_platform'
});

const redis = new IORedis(process.env.REDIS_URL || 'redis://redis:6379/0', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: false
});

const LLM_GATEWAY_URL = process.env.LLM_GATEWAY_URL || 'http://litellm:4000';

// ── Langfuse 可观测性 ──
const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY || 'pk-lf-dev',
  secretKey: process.env.LANGFUSE_SECRET_KEY || 'sk-lf-dev',
  baseUrl: process.env.LANGFUSE_BASEURL || 'http://langfuse:3000'
});
const TOOL_SERVICE_URL = process.env.TOOL_SERVICE_URL || 'http://tool-service:8083';
const DEVKIT_API_URL = process.env.DEVKIT_API_URL || 'http://devkit-api:8080';

app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

// ── 条件求值（修复：明确处理布尔字符串，避免运算符优先级问题）──
function evaluateCondition(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no' || v === '') return false;
  // 非空、非明确假值的字符串视为 true（例如模板渲染后有内容）
  return v !== 'null' && v !== 'undefined' && v !== 'nan';
}

// ── 健康检查 ──
app.get('/health', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    await redis.ping();
    res.json({ status: 'healthy', service: 'orchestrator', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: 'Dependency unavailable' });
  }
});

// ── 工作流执行引擎 ──
interface StepResult {
  node: string;
  type: string;
  status: 'success' | 'failed' | 'skipped';
  output?: any;
  error?: string;
  started_at: string;
  completed_at: string;
  latency_ms: number;
}

function renderTemplate(template: string, context: Record<string, any>): string {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, path) => {
    const keys = path.trim().split('.');
    let value: any = context;
    for (const key of keys) {
      if (value === undefined || value === null) return '';
      value = value[key];
    }
    return value !== undefined && value !== null ? String(value) : '';
  });
}

// 渲染步骤的输入（递归处理对象/数组）
function renderInputs(inputs: any, context: Record<string, any>): any {
  if (typeof inputs === 'string') return renderTemplate(inputs, context);
  if (Array.isArray(inputs)) return inputs.map(v => renderInputs(v, context));
  if (inputs && typeof inputs === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(inputs)) {
      out[k] = renderInputs(v, context);
    }
    return out;
  }
  return inputs;
}

// 执行单个步骤
async function executeStep(
  step: any,
  context: Record<string, any>,
  executionId: string
): Promise<StepResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  try {
    const renderedStep = {
      ...step,
      prompt: step.prompt ? renderTemplate(step.prompt, context) : undefined,
      inputs: step.inputs ? renderInputs(step.inputs, context) : undefined,
      condition: step.condition ? renderTemplate(step.condition, context) : undefined,
      iterable: step.iterable ? renderTemplate(step.iterable, context) : undefined,
    };

    let output: any;

    switch (renderedStep.type) {
      case 'llm': {
        const trace = langfuse.trace({ id: executionId, name: 'agent-execution', metadata: { step: renderedStep.id } });
        const span = trace.span({ name: `llm-${renderedStep.id}`, input: renderedStep.prompt });
        try {
          const resp = await fetch(`${LLM_GATEWAY_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer sk-relayops-master-key' },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: renderedStep.prompt }],
              temperature: renderedStep.model?.temperature ?? 0.7
            })
          });
          if (!resp.ok) throw new Error(`LLM call failed: ${resp.status}`);
          const data = await resp.json();
          output = data.choices?.[0]?.message?.content || '';
          span.end({ output, statusMessage: 'success' });
        } catch (err: any) {
          span.end({ statusMessage: 'error', level: 'ERROR' });
          throw err;
        }
        break;
      }

      case 'tool': {
        const toolName = renderedStep.tool || renderedStep.tool_name;
        const resp = await fetch(`${TOOL_SERVICE_URL}/api/v1/tools/${toolName}/invoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(renderedStep.inputs || {})
        });
        if (!resp.ok) throw new Error(`Tool call failed: ${resp.status}`);
        const data = await resp.json();
        output = data.result;
        break;
      }

      case 'condition': {
        const conditionValue = renderedStep.condition || 'false';
        const isTrue = evaluateCondition(conditionValue);
        output = { condition_result: isTrue, matched_branch: isTrue ? 'then' : 'else' };
        break;
      }

      case 'pass': {
        output = renderedStep.output || null;
        break;
      }

      default:
        throw new Error(`Unknown step type: ${renderedStep.type}`);
    }

    return {
      node: renderedStep.id || renderedStep.name || 'unknown',
      type: renderedStep.type,
      status: 'success',
      output,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      latency_ms: Date.now() - startTime
    };
  } catch (err: any) {
    return {
      node: step.id || step.name || 'unknown',
      type: step.type,
      status: 'failed',
      error: err.message,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      latency_ms: Date.now() - startTime
    };
  }
}

// 执行步骤列表（sequential）
async function executeSteps(
  steps: any[],
  context: Record<string, any>,
  executionId: string,
  results: StepResult[]
): Promise<void> {
  for (const step of steps) {
    await redis.setex(`execution:${executionId}:state`, 3600, JSON.stringify({ context, steps: results }));

    if (step.type === 'parallel') {
      const parallelStart = Date.now();
      const parallelStartedAt = new Date().toISOString();
      const branches = step.branches || [];
      const branchResults = await Promise.all(
        branches.map(async (branch: any, idx: number) => {
          const branchSteps = branch.steps || [];
          const branchRes: StepResult[] = [];
          for (const bs of branchSteps) {
            const r = await executeStep(bs, context, executionId);
            branchRes.push(r);
            if (r.status === 'success') {
              context.steps[bs.id || bs.name || `branch_${idx}_${branchRes.length}`] = r;
            }
          }
          return { branch: branch.name || `branch_${idx}`, steps: branchRes };
        })
      );
      results.push({
        node: step.id || step.name || 'parallel',
        type: 'parallel',
        status: 'success',
        output: { branches: branchResults },
        started_at: parallelStartedAt,
        completed_at: new Date().toISOString(),
        latency_ms: Date.now() - parallelStart
      });
      continue;
    }

    if (step.type === 'loop') {
      const loopStart = Date.now();
      const loopStartedAt = new Date().toISOString();
      const maxIterations = step.max_iterations || 10;
      const loopResults: StepResult[] = [];
      let iteration = 0;
      for (iteration = 0; iteration < maxIterations; iteration++) {
        const conditionVal = renderTemplate(step.condition || 'false', context);
        if (!evaluateCondition(conditionVal)) break;

        const loopSteps = step.steps || [];
        for (const ls of loopSteps) {
          context.loop_iteration = iteration;
          const r = await executeStep(ls, context, executionId);
          loopResults.push(r);
          if (r.status === 'success') {
            context.steps[ls.id || ls.name || `loop_${iteration}_${loopResults.length}`] = r;
          }
        }
      }
      results.push({
        node: step.id || step.name || 'loop',
        type: 'loop',
        status: 'success',
        output: { iterations: iteration, loop_results: loopResults },
        started_at: loopStartedAt,
        completed_at: new Date().toISOString(),
        latency_ms: Date.now() - loopStart
      });
      continue;
    }

    if (step.type === 'condition') {
      const result = await executeStep(step, context, executionId);
      results.push(result);
      if (result.status === 'success') {
        const stepKey = step.id || step.name || `step_${results.length}`;
        context.steps[stepKey] = result;

        // 真正分支：根据条件结果选择then或else分支
        const isTrue = result.output?.condition_result;
        const branchSteps = isTrue ? (step.then || []) : (step.else || []);
        for (const branchStep of branchSteps) {
          const branchResult = await executeStep(branchStep, context, executionId);
          results.push(branchResult);
          if (branchResult.status === 'success') {
            const bk = branchStep.id || branchStep.name || `branch_${results.length}`;
            context.steps[bk] = branchResult;
          }
        }
      }
      continue;
    }

    // 普通步骤
    const result = await executeStep(step, context, executionId);
    results.push(result);
    if (result.status === 'success') {
      const stepKey = step.id || step.name || `step_${results.length}`;
      context.steps[stepKey] = result;
    }
  }
}

// 执行完整工作流
async function runWorkflow(agentDef: any, input: string): Promise<{ executionId: string; steps: StepResult[]; response: string; status: string }> {
  const executionId = `exec-${uuidv4().slice(0, 8)}`;
  const steps: StepResult[] = [];
  const context: Record<string, any> = { input, steps: {} };

  const workflowSteps = agentDef.spec?.workflow?.steps || [];
  await executeSteps(workflowSteps, context, executionId, steps);

  // 提取最终响应
  const lastLlmStep = [...steps].reverse().find(s => s.type === 'llm' && s.status === 'success');
  const response = lastLlmStep?.output || '工作流执行完成，无文本输出';
  const status = steps.every(s => s.status === 'success' || s.status === 'skipped') ? 'success' : 'partial_failure';

  // 保存执行记录到数据库
  await pool.query(
    `INSERT INTO workflow_executions (agent_name, execution_id, status, input, output, steps, completed_at, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
     ON CONFLICT (execution_id) DO UPDATE SET
       status = EXCLUDED.status,
       output = EXCLUDED.output,
       steps = EXCLUDED.steps,
       completed_at = EXCLUDED.completed_at,
       duration_ms = EXCLUDED.duration_ms`,
    [
      agentDef.metadata?.name || 'unknown',
      executionId,
      status,
      JSON.stringify({ input }),
      JSON.stringify({ response }),
      JSON.stringify(steps),
      steps.reduce((sum, s) => sum + (s.latency_ms || 0), 0)
    ]
  );

  return { executionId, steps, response, status };
}

// ── 创建执行 ──
app.post('/api/v1/executions', async (req: Request, res: Response) => {
  try {
    const { agent_name, input } = req.body;
    if (!agent_name || !input) {
      return res.status(400).json({ error: 'agent_name and input are required' });
    }

    const agentResp = await fetch(`${DEVKIT_API_URL}/api/v1/agents/${agent_name}`);
    if (!agentResp.ok) {
      return res.status(404).json({ error: `Agent '${agent_name}' not found` });
    }
    const agent = await agentResp.json();

    const result = await runWorkflow(agent.definition || agent, input);

    res.json({
      execution_id: result.executionId,
      status: result.status,
      response: result.response,
      steps: result.steps.map(s => ({
        node: s.node,
        type: s.type,
        status: s.status,
        latency_ms: s.latency_ms,
        error: s.error
      }))
    });
  } catch (err: any) {
    console.error('Execution error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── 查询执行列表（新增：支持分页、过滤、排序）──
app.get('/api/v1/executions', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;
    const agentName = req.query.agent_name as string;
    const status = req.query.status as string;
    const search = req.query.search as string;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 1;

    if (agentName) {
      where += ` AND agent_name = $${paramIdx++}`;
      params.push(agentName);
    }
    if (status) {
      where += ` AND status = $${paramIdx++}`;
      params.push(status);
    }
    if (search) {
      where += ` AND (agent_name ILIKE $${paramIdx} OR input::text ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    const countResult = await pool.query(`SELECT COUNT(*) FROM workflow_executions ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const queryParams = [...params, limit, offset];
    const result = await pool.query(
      `SELECT id, agent_name, execution_id, status, input, output, steps, completed_at, duration_ms, started_at
       FROM workflow_executions ${where}
       ORDER BY started_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      queryParams
    );

    res.json({
      executions: result.rows,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 执行统计（新增）──
app.get('/api/v1/executions/stats', async (_req: Request, res: Response) => {
  try {
    const totalResult = await pool.query(`SELECT COUNT(*) as total FROM workflow_executions`);
    const statusResult = await pool.query(`
      SELECT status, COUNT(*) as count FROM workflow_executions GROUP BY status
    `);
    const agentResult = await pool.query(`
      SELECT agent_name, COUNT(*) as count,
        AVG(duration_ms) as avg_duration,
        MAX(duration_ms) as max_duration
      FROM workflow_executions
      GROUP BY agent_name
      ORDER BY count DESC
      LIMIT 10
    `);
    const dailyResult = await pool.query(`
      SELECT DATE(started_at) as date, COUNT(*) as count
      FROM workflow_executions
      WHERE started_at > NOW() - INTERVAL '7 days'
      GROUP BY DATE(started_at)
      ORDER BY date DESC
    `);

    res.json({
      total: parseInt(totalResult.rows[0].total),
      by_status: statusResult.rows.reduce((acc: any, r: any) => { acc[r.status] = parseInt(r.count); return acc; }, {}),
      by_agent: agentResult.rows,
      daily: dailyResult.rows
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 查询单个执行 ──
app.get('/api/v1/executions/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM workflow_executions WHERE execution_id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Execution not found' });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 通过Gateway代理的执行入口 ──
app.post('/api/v1/agents/:name/execute', async (req: Request, res: Response) => {
  try {
    const { input } = req.body;
    if (!input) {
      return res.status(400).json({ error: 'input is required' });
    }

    const agentResp = await fetch(`${DEVKIT_API_URL}/api/v1/agents/${req.params.name}`);
    if (!agentResp.ok) {
      return res.status(404).json({ error: `Agent '${req.params.name}' not found` });
    }
    const agent = await agentResp.json();

    const result = await runWorkflow(agent.definition || agent, input);

    res.json({
      execution_id: result.executionId,
      status: result.status,
      response: result.response,
      steps: result.steps.map(s => ({
        node: s.node,
        type: s.type,
        status: s.status,
        latency_ms: s.latency_ms,
        error: s.error
      }))
    });
  } catch (err: any) {
    console.error('Execute error:', err);
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`⚙️ Orchestrator running on port ${PORT}`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    redis.disconnect();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
