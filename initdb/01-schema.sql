-- Agent Platform MVP — 数据库初始化
-- 创建必要的数据库和表

-- 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- pgvector 向量扩展（用于语义检索）
CREATE EXTENSION IF NOT EXISTS vector;

-- Agent 注册表
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(128) UNIQUE NOT NULL,
    version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    description TEXT,
    author VARCHAR(128),
    labels TEXT[],
    -- Agent 定义（JSON格式，对应YAML编译后）
    definition JSONB NOT NULL,
    -- 状态
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    -- 元数据
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workflow 执行记录
CREATE TABLE IF NOT EXISTS workflow_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_name VARCHAR(128) NOT NULL REFERENCES agents(name),
    execution_id VARCHAR(64) UNIQUE NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'running',
    input JSONB,
    output JSONB,
    steps JSONB DEFAULT '[]',
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER
);

-- 知识库文档（增强版：支持向量检索）
-- 注意：devkit-api 运行时也会执行 CREATE TABLE IF NOT EXISTS，以 SERIAL 主键覆盖；
-- 此处与运行时建表保持一致，均采用 SERIAL 整型主键。
CREATE TABLE IF NOT EXISTS knowledge_documents (
    id SERIAL PRIMARY KEY,
    title VARCHAR(256) NOT NULL,
    content TEXT NOT NULL,
    source VARCHAR(128),
    tags TEXT[],
    chunk_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 知识库文档分块（向量版）
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    -- pgvector 向量字段（384维，适配常见embedding模型）
    embedding vector(384),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(document_id, chunk_index)
);

-- 定时任务表（BullMQ集成，与 devkit-api 运行时建表保持一致）
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
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 向量索引（HNSW，高性能近似最近邻搜索）
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding ON knowledge_chunks
    USING hnsw (embedding vector_cosine_ops);

-- 全文搜索索引（保留原有能力）
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_fts ON knowledge_chunks
    USING gin(to_tsvector('simple', content));

-- 工具注册表（MCP标准化）
CREATE TABLE IF NOT EXISTS tools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(128) UNIQUE NOT NULL,
    description TEXT,
    -- MCP协议字段
    mcp_enabled BOOLEAN NOT NULL DEFAULT false,
    mcp_schema JSONB,
    -- 传统HTTP调用字段（向后兼容）
    endpoint VARCHAR(256),
    method VARCHAR(16) NOT NULL DEFAULT 'POST',
    input_schema JSONB,
    output_schema JSONB,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- LLM 调用记录（成本追踪）
CREATE TABLE IF NOT EXISTS llm_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    execution_id VARCHAR(64),
    provider VARCHAR(64) NOT NULL,
    model VARCHAR(64) NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER,
    cost_estimate NUMERIC(10,6),
    request JSONB,
    response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 审计日志
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(64) NOT NULL,
    actor VARCHAR(128),
    resource_type VARCHAR(64),
    resource_id VARCHAR(128),
    action VARCHAR(64),
    payload JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_executions_agent ON workflow_executions(agent_name);
CREATE INDEX IF NOT EXISTS idx_executions_status ON workflow_executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_created ON workflow_executions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_execution ON llm_calls(execution_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event ON audit_logs(event_type, created_at DESC);

-- 插入示例工具：天气查询
INSERT INTO tools (name, description, endpoint, method, input_schema, output_schema)
VALUES (
    'weather_query',
    '查询指定城市的天气',
    'http://tool-service:8083/tools/weather/query',
    'POST',
    '{"type":"object","properties":{"city":{"type":"string","description":"城市名"}},"required":["city"]}',
    '{"type":"object","properties":{"temperature":{"type":"number"},"condition":{"type":"string"},"humidity":{"type":"number"}}}'
)
ON CONFLICT (name) DO NOTHING;

-- 插入示例工具：订单查询
INSERT INTO tools (name, description, endpoint, method, input_schema, output_schema)
VALUES (
    'order_query',
    '查询订单信息',
    'http://tool-service:8083/tools/order/query',
    'POST',
    '{"type":"object","properties":{"order_id":{"type":"string","description":"订单号"}},"required":["order_id"]}',
    '{"type":"object","properties":{"order_id":{"type":"string"},"status":{"type":"string"},"amount":{"type":"number"},"created_at":{"type":"string"}}}'
)
ON CONFLICT (name) DO NOTHING;

-- 更新时间触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
