import express, { Request, Response } from 'express';
import morgan from 'morgan';
import yaml from 'js-yaml';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const app = express();
const PORT = parseInt(process.env.PORT || '8080');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:changeme@postgres:5432/agent_platform'
});

// ── Redis连接（BullMQ + 缓存）──
const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://redis:6379/0', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

// ── BullMQ 队列定义 ──
const taskQueue = new Queue('agent-scheduler', { connection: redisConnection });

app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ limit: '10mb', type: 'application/yaml' }));

const LLM_GATEWAY_URL = process.env.LLM_GATEWAY_URL || 'http://litellm:4000';

// ═══════════════════════════════════════════════════════════
// pgvector 向量工具函数
// ═══════════════════════════════════════════════════════════

// 生成简单的词频向量（384维，无需外部embedding服务）
function textToEmbedding(text: string): number[] {
  const dim = 384;
  const vec = new Array(dim).fill(0);
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 1);
  for (const w of words) {
    let hash = 0;
    for (let i = 0; i < w.length; i++) hash = ((hash << 5) - hash) + w.charCodeAt(i);
    const idx = Math.abs(hash) % dim;
    vec[idx] += 1;
  }
  // L2归一化
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / norm);
}

function vecToSql(vec: number[]): string {
  return '[' + vec.map(v => v.toFixed(6)).join(',') + ']';
}

// ── 自动创建知识库表 ──
async function initKnowledgeTables() {
  // 文档表（带source/tags字段）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT,
      tags TEXT[],
      chunk_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // 分块表（带embedding向量字段）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id SERIAL PRIMARY KEY,
      document_id INTEGER REFERENCES knowledge_documents(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      embedding vector(384),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document ON knowledge_chunks(document_id)
  `);
  // pgvector HNSW索引（如果向量字段存在）
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding ON knowledge_chunks
      USING hnsw (embedding vector_cosine_ops)
    `);
  } catch (e: any) {
    if (!e.message?.includes('already exists')) console.log('HNSW index note:', e.message);
  }
}

// ── 文本分块 ──
function chunkText(text: string, maxChunkSize: number = 800, overlap: number = 100): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length <= maxChunkSize) {
      chunks.push(trimmed);
      continue;
    }
    const sentences = trimmed.match(/[^。！？.!?]+[。！？.!?]+/g) || [trimmed];
    let current = '';
    for (const sent of sentences) {
      if ((current + sent).length > maxChunkSize && current.length > 0) {
        chunks.push(current.trim());
        current = current.slice(-overlap) + sent;
      } else {
        current += sent;
      }
    }
    if (current.trim().length > 0) chunks.push(current.trim());
  }
  return chunks;
}

// ── 健康检查 ──
app.get('/health', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', service: 'devkit-api', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: 'Database unavailable' });
  }
});

// ── 注册Agent ──
app.post('/api/v1/agents', async (req: Request, res: Response) => {
  try {
    let definition: any;
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('yaml') || (typeof req.body === 'string' && req.body.trim().startsWith('apiVersion'))) {
      definition = yaml.load(req.body);
    } else {
      definition = req.body;
    }
    if (!definition?.metadata?.name) {
      return res.status(400).json({ error: 'Agent name is required in metadata.name' });
    }
    const name = definition.metadata.name;
    const version = definition.metadata.version || '1.0.0';
    const description = definition.metadata.description || '';
    const author = definition.metadata.author || 'anonymous';
    const labels = definition.metadata.labels || [];
    const result = await pool.query(
      `INSERT INTO agents (name, version, description, author, labels, definition, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       ON CONFLICT (name) DO UPDATE SET
         version = EXCLUDED.version,
         description = EXCLUDED.description,
         author = EXCLUDED.author,
         labels = EXCLUDED.labels,
         definition = EXCLUDED.definition,
         status = 'active',
         updated_at = NOW()
       RETURNING *`,
      [name, version, description, author, labels, JSON.stringify(definition)]
    );
    res.status(201).json({ message: 'Agent registered successfully', agent: result.rows[0] });
  } catch (err: any) {
    console.error('Register agent error:', err);
    res.status(500).json({ error: err.message || 'Failed to register agent' });
  }
});

// ── 列出Agent ──
app.get('/api/v1/agents', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, version, description, author, labels, status, definition, created_at, updated_at FROM agents ORDER BY updated_at DESC'
    );
    const agents = result.rows.map(row => {
      const def = row.definition || {};
      const spec = def.spec || {};
      return { ...row, model: spec.model || null, workflow: spec.workflow || null, tools: spec.tools || null, system_prompt: spec.system_prompt || null };
    });
    res.json({ agents, count: agents.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 获取单个Agent ──
app.get('/api/v1/agents/:name', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM agents WHERE name = $1', [req.params.name]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Agent not found' });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 删除Agent ──
app.delete('/api/v1/agents/:name', async (req: Request, res: Response) => {
  try {
    const name = req.params.name;
    await pool.query('DELETE FROM workflow_executions WHERE agent_name = $1', [name]);
    await pool.query('DELETE FROM agents WHERE name = $1', [name]);
    res.json({ message: 'Agent deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 知识库 API（pgvector增强版）
// ═══════════════════════════════════════════════════════════

// ── 上传文档（自动分块 + 生成embedding）──
app.post('/api/v1/knowledge/documents', async (req: Request, res: Response) => {
  try {
    const { title, content, source, tags } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'title and content are required' });

    const docResult = await pool.query(
      `INSERT INTO knowledge_documents (title, content, source, tags, chunk_count) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [title, content, source || null, tags || [], 0]
    );
    const docId = docResult.rows[0].id;

    const chunks = chunkText(content);
    for (let i = 0; i < chunks.length; i++) {
      const embedding = textToEmbedding(chunks[i]);
      await pool.query(
        `INSERT INTO knowledge_chunks (document_id, content, chunk_index, embedding) VALUES ($1, $2, $3, $4)`,
        [docId, chunks[i], i, vecToSql(embedding)]
      );
    }
    await pool.query('UPDATE knowledge_documents SET chunk_count = $1 WHERE id = $2', [chunks.length, docId]);

    res.status(201).json({ message: 'Document uploaded and chunked successfully', document: { ...docResult.rows[0], chunk_count: chunks.length } });
  } catch (err: any) {
    console.error('Upload document error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── 列出文档 ──
app.get('/api/v1/knowledge/documents', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;
    const countResult = await pool.query('SELECT COUNT(*) FROM knowledge_documents');
    const total = parseInt(countResult.rows[0].count);
    const result = await pool.query(
      `SELECT id, title, source, tags, chunk_count, created_at FROM knowledge_documents ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ documents: result.rows, pagination: { page, limit, total, total_pages: Math.ceil(total / limit) } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 获取单个文档 ──
app.get('/api/v1/knowledge/documents/:id', async (req: Request, res: Response) => {
  try {
    const docResult = await pool.query('SELECT * FROM knowledge_documents WHERE id = $1', [req.params.id]);
    if (docResult.rows.length === 0) return res.status(404).json({ error: 'Document not found' });
    const chunksResult = await pool.query(
      'SELECT id, content, chunk_index, created_at FROM knowledge_chunks WHERE document_id = $1 ORDER BY chunk_index', [req.params.id]
    );
    res.json({ document: docResult.rows[0], chunks: chunksResult.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 删除文档 ──
app.delete('/api/v1/knowledge/documents/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM knowledge_documents WHERE id = $1', [req.params.id]);
    res.json({ message: 'Document deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 混合搜索（全文 + 向量语义）──
app.post('/api/v1/knowledge/search', async (req: Request, res: Response) => {
  try {
    const { query, limit = 5, document_id, use_vector = true } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });
    const searchLimit = Math.min(20, Math.max(1, limit));
    const cleanQuery = query.trim();

    let results: any[] = [];

    // 1. 向量语义搜索（如果启用pgvector，使用参数化查询避免字符串插值）
    if (use_vector) {
      try {
        const queryVec = vecToSql(textToEmbedding(cleanQuery));
        const vecSql = document_id
          ? `SELECT kc.id, kc.document_id, kd.title, kc.content, kc.chunk_index,
                    1 - (kc.embedding <=> $1::vector) AS score
             FROM knowledge_chunks kc
             JOIN knowledge_documents kd ON kc.document_id = kd.id
             WHERE kc.document_id = $2
             ORDER BY kc.embedding <=> $1::vector
             LIMIT $3`
          : `SELECT kc.id, kc.document_id, kd.title, kc.content, kc.chunk_index,
                    1 - (kc.embedding <=> $1::vector) AS score
             FROM knowledge_chunks kc
             JOIN knowledge_documents kd ON kc.document_id = kd.id
             ORDER BY kc.embedding <=> $1::vector
             LIMIT $2`;
        const vecParams = document_id ? [queryVec, document_id, searchLimit] : [queryVec, searchLimit];
        const vecResult = await pool.query(vecSql, vecParams);
        results = vecResult.rows.map(r => ({ ...r, score: parseFloat(r.score)?.toFixed(4), source: 'vector' }));
      } catch (vecErr: any) {
        console.log('Vector search fallback:', vecErr.message);
      }
    }

    // 2. 如果向量搜索结果不足，补充全文搜索
    if (results.length < searchLimit) {
      const tsquery = cleanQuery.split(/\s+/).filter(Boolean).join(' & ');
      const ftsSql = document_id
        ? `SELECT kc.id, kc.document_id, kd.title, kc.content, kc.chunk_index,
                  ts_rank(to_tsvector('simple', kc.content), to_tsquery('simple', $2)) AS score
           FROM knowledge_chunks kc
           JOIN knowledge_documents kd ON kc.document_id = kd.id
           WHERE kc.document_id = $1
             AND to_tsvector('simple', kc.content) @@ to_tsquery('simple', $2)
           ORDER BY score DESC
           LIMIT $3`
        : `SELECT kc.id, kc.document_id, kd.title, kc.content, kc.chunk_index,
                  ts_rank(to_tsvector('simple', kc.content), to_tsquery('simple', $1)) AS score
           FROM knowledge_chunks kc
           JOIN knowledge_documents kd ON kc.document_id = kd.id
           WHERE to_tsvector('simple', kc.content) @@ to_tsquery('simple', $1)
           ORDER BY score DESC
           LIMIT $2`;
      const ftsParams = document_id ? [document_id, tsquery, searchLimit] : [tsquery, searchLimit];
      const ftsResult = await pool.query(ftsSql, ftsParams);
      for (const row of ftsResult.rows) {
        if (!results.find(r => r.id === row.id)) {
          results.push({ ...row, score: parseFloat(row.score)?.toFixed(4), source: 'fts' });
        }
      }
    }

    res.json({ query, results: results.slice(0, searchLimit), count: results.length });
  } catch (err: any) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── RAG问答（使用混合检索 + LiteLLM）──
app.post('/api/v1/knowledge/ask', async (req: Request, res: Response) => {
  try {
    const { question, document_id, top_k = 3 } = req.body;
    if (!question) return res.status(400).json({ error: 'question is required' });

    // 1. 混合检索（向量优先，参数化查询）
    const queryVec = vecToSql(textToEmbedding(question));
    let searchResult: any;
    try {
      const vecSql = document_id
        ? `SELECT kc.content FROM knowledge_chunks kc WHERE kc.document_id = $2 ORDER BY kc.embedding <=> $1::vector LIMIT $3`
        : `SELECT kc.content FROM knowledge_chunks kc ORDER BY kc.embedding <=> $1::vector LIMIT $2`;
      searchResult = await pool.query(vecSql, document_id ? [queryVec, document_id, top_k] : [queryVec, top_k]);
    } catch {
      const tsquery = question.split(/\s+/).filter(Boolean).join(' & ');
      const ftsSql = document_id
        ? `SELECT kc.content FROM knowledge_chunks kc WHERE kc.document_id = $1 AND to_tsvector('simple', kc.content) @@ to_tsquery('simple', $2) ORDER BY ts_rank(to_tsvector('simple', kc.content), to_tsquery('simple', $2)) DESC LIMIT $3`
        : `SELECT kc.content FROM knowledge_chunks kc WHERE to_tsvector('simple', kc.content) @@ to_tsquery('simple', $1) ORDER BY ts_rank(to_tsvector('simple', kc.content), to_tsquery('simple', $1)) DESC LIMIT $2`;
      searchResult = await pool.query(ftsSql, document_id ? [document_id, tsquery, top_k] : [tsquery, top_k]);
    }

    if (searchResult.rows.length === 0) {
      return res.json({ question, answer: '未在知识库中找到相关信息。', sources: [] });
    }

    const context = searchResult.rows.map((r: any, i: number) => `[${i + 1}] ${r.content}`).join('\n\n');
    const prompt = `基于以下知识库内容回答问题。如果知识库中没有相关信息，请明确说明。\n\n知识库内容：\n${context}\n\n用户问题：${question}\n\n请用中文回答，并注明信息来源编号（如 [1][2]）。`;

    // 2. 调用LLM（通过LiteLLM Proxy）
    const llmResp = await fetch(`${LLM_GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer sk-relayops-master-key' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.3 })
    });
    const llmData = await llmResp.json();

    res.json({
      question,
      answer: llmData.choices?.[0]?.message?.content || '生成回答失败',
      sources: searchResult.rows.map((r: any, i: number) => ({ index: i + 1, content: r.content.slice(0, 200) + '...' }))
    });
  } catch (err: any) {
    console.error('RAG ask error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 定时任务 API（BullMQ增强版）
// ═══════════════════════════════════════════════════════════

// ── BullMQ Worker：执行定时任务 ──
const taskWorker = new Worker('agent-scheduler', async (job) => {
  const { agent_name, input, taskId } = job.data;
  console.log(`[BullMQ] Executing scheduled task #${taskId} -> ${agent_name}`);
  try {
    const resp = await fetch(`http://orchestrator:8081/api/v1/agents/${agent_name}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input })
    });
    const result = await resp.json();
    // 更新任务运行统计
    await pool.query('UPDATE scheduled_tasks SET last_run_at = NOW(), run_count = run_count + 1, success_count = success_count + 1 WHERE id = $1', [taskId]);
    return { success: true, result };
  } catch (err: any) {
    await pool.query('UPDATE scheduled_tasks SET last_run_at = NOW(), run_count = run_count + 1, fail_count = fail_count + 1 WHERE id = $1', [taskId]);
    throw err;
  }
}, { connection: redisConnection });

taskWorker.on('completed', (job) => console.log(`[BullMQ] Job ${job.id} completed`));
taskWorker.on('failed', (job, err) => console.error(`[BullMQ] Job ${job?.id} failed:`, err.message));

// ── 创建任务 ──
app.post('/api/v1/scheduler/tasks', async (req: Request, res: Response) => {
  try {
    const { name, agent_name, input, schedule_type, schedule_config, enabled = true } = req.body;
    if (!name || !agent_name || !input || !schedule_type) {
      return res.status(400).json({ error: 'name, agent_name, input, schedule_type are required' });
    }
    // 存入数据库
    const result = await pool.query(
      `INSERT INTO scheduled_tasks (name, agent_name, input, schedule_type, schedule_config, enabled, run_count, success_count, fail_count)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 0) RETURNING *`,
      [name, agent_name, JSON.stringify(input), schedule_type, JSON.stringify(schedule_config || {}), enabled]
    );
    const task = result.rows[0];

    // 注册到BullMQ
    if (enabled) {
      if (schedule_type === 'interval' && schedule_config?.minutes) {
        await taskQueue.add(task.name, { agent_name, input, taskId: task.id }, {
          repeat: { every: schedule_config.minutes * 60 * 1000 },
          jobId: `task-${task.id}`
        });
      } else if (schedule_type === 'daily' && schedule_config?.hour !== undefined) {
        const cron = `${schedule_config.minute || 0} ${schedule_config.hour} * * *`;
        await taskQueue.add(task.name, { agent_name, input, taskId: task.id }, {
          repeat: { cron },
          jobId: `task-${task.id}`
        });
      }
    }
    res.status(201).json({ task });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 列出任务 ──
app.get('/api/v1/scheduler/tasks', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM scheduled_tasks ORDER BY created_at DESC');
    res.json({ tasks: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 获取单个任务 ──
app.get('/api/v1/scheduler/tasks/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM scheduled_tasks WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 启停任务 ──
app.patch('/api/v1/scheduler/tasks/:id/toggle', async (req: Request, res: Response) => {
  try {
    const current = await pool.query('SELECT * FROM scheduled_tasks WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    const task = current.rows[0];
    const newEnabled = req.body.enabled !== undefined ? req.body.enabled : !task.enabled;

    await pool.query('UPDATE scheduled_tasks SET enabled = $1, updated_at = NOW() WHERE id = $2', [newEnabled, req.params.id]);

    // 同步BullMQ重复任务
    const jobId = `task-${task.id}`;
    if (newEnabled) {
      const config = task.schedule_config || {};
      if (task.schedule_type === 'interval' && config.minutes) {
        await taskQueue.add(task.name, { agent_name: task.agent_name, input: task.input, taskId: task.id }, {
          repeat: { every: config.minutes * 60 * 1000 }, jobId
        });
      } else if (task.schedule_type === 'daily' && config.hour !== undefined) {
        const cron = `${config.minute || 0} ${config.hour} * * *`;
        await taskQueue.add(task.name, { agent_name: task.agent_name, input: task.input, taskId: task.id }, {
          repeat: { cron }, jobId
        });
      }
    } else {
      // 移除BullMQ重复任务
      const repeatableJobs = await taskQueue.getRepeatableJobs();
      const target = repeatableJobs.find(j => j.id === jobId || j.name === task.name);
      if (target) await taskQueue.removeRepeatableByKey(target.key);
    }

    res.json({ id: req.params.id, enabled: newEnabled });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 删除任务 ──
app.delete('/api/v1/scheduler/tasks/:id', async (req: Request, res: Response) => {
  try {
    const current = await pool.query('SELECT name FROM scheduled_tasks WHERE id = $1', [req.params.id]);
    if (current.rows.length > 0) {
      const repeatableJobs = await taskQueue.getRepeatableJobs();
      const target = repeatableJobs.find(j => j.id === `task-${req.params.id}` || j.name === current.rows[0].name);
      if (target) await taskQueue.removeRepeatableByKey(target.key);
    }
    await pool.query('DELETE FROM scheduled_tasks WHERE id = $1', [req.params.id]);
    res.json({ message: 'Task deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 启动时自动导入预设Agent
// ═══════════════════════════════════════════════════════════

async function seedAgents() {
  const seedDir = process.env.AGENT_SEED_DIR || '/app/examples/agents';
  if (!fs.existsSync(seedDir)) {
    console.log(`📭 Seed directory not found: ${seedDir}, skipping auto-import`);
    return;
  }
  const files = fs.readdirSync(seedDir).filter(f => f.endsWith('.json') || f.endsWith('.yml') || f.endsWith('.yaml'));
  if (files.length === 0) { console.log('📭 No seed agent files found'); return; }
  console.log(`🌱 Auto-importing ${files.length} preset agents from ${seedDir}...`);
  let imported = 0, skipped = 0;
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(seedDir, file), 'utf-8');
      let definition: any;
      if (file.endsWith('.json')) definition = JSON.parse(content);
      else definition = yaml.load(content);
      if (!definition?.metadata?.name) { skipped++; continue; }
      const name = definition.metadata.name;
      const version = definition.metadata.version || '1.0.0';
      const description = definition.metadata.description || '';
      const author = definition.metadata.author || 'platform';
      const labels = definition.metadata.labels || [];
      await pool.query(
        `INSERT INTO agents (name, version, description, author, labels, definition, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')
         ON CONFLICT (name) DO UPDATE SET
           version = EXCLUDED.version, description = EXCLUDED.description, author = EXCLUDED.author,
           labels = EXCLUDED.labels, definition = EXCLUDED.definition, status = 'active', updated_at = NOW()`,
        [name, version, description, author, labels, JSON.stringify(definition)]
      );
      console.log(`   ✅ Imported: ${name}`);
      imported++;
    } catch (err: any) {
      console.error(`   ❌ Failed to import ${file}:`, err.message);
      skipped++;
    }
  }
  console.log(`🌱 Auto-import complete: ${imported} imported, ${skipped} skipped`);
}

// ── 初始化定时任务表（兼容BullMQ）──
async function initSchedulerTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id SERIAL PRIMARY KEY,
      name VARCHAR(128) NOT NULL,
      agent_name VARCHAR(128) NOT NULL,
      input JSONB NOT NULL,
      schedule_type VARCHAR(32) NOT NULL,
      schedule_config JSONB DEFAULT '{}',
      enabled BOOLEAN NOT NULL DEFAULT true,
      run_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      fail_count INTEGER NOT NULL DEFAULT 0,
      last_run_at TIMESTAMP,
      next_run_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🔧 DevKit API running on port ${PORT}`);
  try {
    await initKnowledgeTables();
    await initSchedulerTables();
    console.log('📚 Knowledge base tables initialized (with pgvector)');
    console.log('⏰ Scheduler tables initialized (with BullMQ)');
  } catch (err: any) {
    console.error('Failed to init tables:', err.message);
  }
  setTimeout(seedAgents, 2000);
});

async function shutdown() {
  server.close(async () => {
    await taskWorker.close();
    await taskQueue.close();
    redisConnection.disconnect();
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
