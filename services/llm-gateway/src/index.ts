import express, { Request, Response } from 'express';
import morgan from 'morgan';
import { Pool } from 'pg';

const app = express();
const PORT = parseInt(process.env.PORT || '8082');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:changeme@postgres:5432/agent_platform'
});

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

// ── 健康检查 ──
app.get('/health', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    // 尝试探测Ollama
    let ollamaStatus = 'unknown';
    try {
      const ollamaResp = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
      ollamaStatus = ollamaResp.ok ? 'available' : 'unavailable';
    } catch {
      ollamaStatus = 'unavailable';
    }
    res.json({ status: 'healthy', service: 'llm-gateway', ollama: ollamaStatus, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: 'Database unavailable' });
  }
});

// ── 模型列表 ──
app.get('/api/v1/llm/models', async (_req: Request, res: Response) => {
  const models = [
    { name: 'llama3.2', provider: 'ollama', description: '本地轻量级模型', status: 'active' },
    { name: 'llama3', provider: 'ollama', description: '本地标准模型', status: 'active' },
  ];
  // 如果有外部API密钥，添加外部模型
  if (process.env.OPENAI_API_KEY) {
    models.push({ name: 'gpt-4o', provider: 'openai', description: 'OpenAI最强模型', status: 'active' });
    models.push({ name: 'gpt-3.5-turbo', provider: 'openai', description: 'OpenAI性价比模型', status: 'active' });
  }
  res.json({ models });
});

// ── 对话接口 ──
app.post('/api/v1/llm/chat', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const { prompt, model, temperature = 0.7, max_tokens = 1024, execution_id } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const targetModel = model || OLLAMA_MODEL;
  let responseText = '';
  let provider = 'ollama';
  let tokens = { prompt: 0, completion: 0, total: 0 };
  let latency = 0;

  try {
    // 优先尝试 Ollama
    const ollamaStart = Date.now();
    const ollamaResp = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: targetModel,
        prompt: prompt,
        stream: false,
        options: {
          temperature: parseFloat(String(temperature)),
          num_predict: parseInt(String(max_tokens))
        }
      }),
      signal: AbortSignal.timeout(30000)
    });

    latency = Date.now() - ollamaStart;

    if (ollamaResp.ok) {
      const data = await ollamaResp.json();
      responseText = data.response || '';
      tokens = {
        prompt: data.prompt_eval_count || Math.ceil(prompt.length / 4),
        completion: data.eval_count || Math.ceil(responseText.length / 4),
        total: (data.prompt_eval_count || 0) + (data.eval_count || 0)
      };
      provider = 'ollama';
    } else {
      throw new Error(`Ollama returned ${ollamaResp.status}`);
    }
  } catch (err: any) {
    console.warn('Ollama call failed, using fallback:', err.message);
    
    // Fallback: Mock响应（MVP阶段保证可用性）
    provider = 'mock';
    latency = Date.now() - startTime;
    
    // 根据prompt内容生成mock响应
    const lowerPrompt = prompt.toLowerCase();
    if (lowerPrompt.includes('意图') || lowerPrompt.includes('intent')) {
      responseText = JSON.stringify({ intent: 'order_query', confidence: 0.92 });
    } else if (lowerPrompt.includes('退款') || lowerPrompt.includes('refund')) {
      responseText = '您好，关于退款申请，我们支持7天无理由退款。请提供您的订单号，我将为您查询退款进度。';
    } else if (lowerPrompt.includes('订单') || lowerPrompt.includes('order')) {
      responseText = '好的，我来帮您查询订单信息。请稍候...';
    } else {
      responseText = '您好，我已经收到您的问题，正在为您处理。根据我们的记录，您的问题可以通过以下方式解决：...';
    }
    
    tokens = {
      prompt: Math.ceil(prompt.length / 4),
      completion: Math.ceil(responseText.length / 4),
      total: Math.ceil((prompt.length + responseText.length) / 4)
    };
  }

  // 记录调用日志
  try {
    const costEstimate = provider === 'ollama' ? 0 : (tokens.total * 0.000002);
    await pool.query(
      `INSERT INTO llm_calls (execution_id, provider, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, cost_estimate, request, response)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        execution_id || null,
        provider,
        targetModel,
        tokens.prompt,
        tokens.completion,
        tokens.total,
        latency,
        costEstimate,
        JSON.stringify({ prompt, temperature, max_tokens }),
        JSON.stringify({ response: responseText })
      ]
    );
  } catch (dbErr) {
    console.error('Failed to log LLM call:', dbErr);
  }

  res.json({
    response: responseText,
    model: targetModel,
    provider,
    tokens,
    latency_ms: latency,
    cost_estimate: provider === 'ollama' ? 0 : (tokens.total * 0.000002)
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🧠 LLM Gateway running on port ${PORT}`);
  console.log(`   Ollama: ${OLLAMA_BASE_URL} (model: ${OLLAMA_MODEL})`);
});
