# Agent Platform MVP — 使用手册

> **目标**: 让任何人在 5 分钟内从零开始运行第一个 Agent 工作流  
> **前置**: 已安装 Docker + Docker Compose + Make  

---

## 目录

1. [第一次启动](#1-第一次启动)
2. [核心概念](#2-核心概念)
3. [使用流程：注册 → 执行 → 查看](#3-使用流程注册--执行--查看)
4. [高级操作](#4-高级操作)
5. [自定义开发：创建你自己的 Agent](#5-自定义开发创建你自己的-agent)
6. [服务单独调用](#6-服务单独调用)
7. [常见问题](#7-常见问题)
8. [关闭与清理](#8-关闭与清理)

---

## 1. 第一次启动

### 步骤 1：进入项目目录

```bash
cd /Users/lucas/Documents/Projects/relayops
```

### 步骤 2：初始化（仅需一次）

```bash
make init
```

**作用**：
- 从 `.env.example` 创建 `.env`
- 自动生成 JWT 密钥
- 自动生成 PostgreSQL 密码
- 自动生成 Grafana 密码
- 自动生成 Langfuse 加密密钥

**输出示例**：
```
🔧 Initializing Agent Platform MVP...
✅ Created .env from template
✅ Generated JWT_SECRET
✅ Generated PostgreSQL password
✅ Generated Grafana password: 8a9dff320a0d5490
✅ Generated Langfuse encryption key

🎉 Initialization complete!
```

### 步骤 3：启动服务

```bash
make up
```

**作用**：启动 10 个容器（7 个业务服务 + PostgreSQL + Redis + Flowise）

**首次启动耗时**：约 30-60 秒（需要拉取镜像）

**输出示例**：
```
🚀 Starting core services...
🏥 Health Check:
  api-gateway:         healthy
  devkit-api:          healthy
  orchestrator:        healthy
  litellm:             starting
  tool-service:        healthy
  mcp-server:          healthy
  flowise:             healthy
  langfuse:            running
  windmill:            running
  postgres:            healthy
  redis:               healthy
```

> 如果显示 `starting`，等待 10 秒后重试 `make health`

### 步骤 4：验证所有服务

```bash
# 检查核心服务是否响应
for port in 8000 8080 8081 8083 8084; do
  echo -n "Port $port: "
  curl -s http://localhost:$port/health | jq -r '.status'
done
```

**预期输出**：
```
Port 8000: healthy
Port 8080: healthy
Port 8081: healthy
Port 8083: healthy
Port 8084: healthy
```

---

## 2. 核心概念

### 三个核心对象

```
┌─────────────────────────────────────────────────────────────┐
│  Agent（智能体）                                              │
│  ├── 定义：模型配置 + 系统提示词 + 工具列表 + 工作流定义         │
│  ├── 存储：PostgreSQL 的 agents 表                            │
│  └── 操作：注册 / 查询 / 更新 / 删除                           │
├─────────────────────────────────────────────────────────────┤
│  Workflow（工作流）                                           │
│  ├── 定义：顺序执行的步骤列表（LLM节点 / 工具节点 / 条件节点）    │
│  ├── 执行：Orchestrator 顺序执行每个步骤                        │
│  └── 状态：running / success / partial_failure / failed        │
├─────────────────────────────────────────────────────────────┤
│  Execution（执行记录）                                         │
│  ├── 定义：一次工作流运行的完整记录                              │
│  ├── 存储：PostgreSQL 的 workflow_executions 表                │
│  └── 内容：输入 / 输出 / 每步耗时 / 错误信息                      │
└─────────────────────────────────────────────────────────────┘
```

### 数据流

```
用户输入 ──→ API Gateway ──→ Orchestrator
                              │
                              ├─→ LiteLLM Proxy ──→ Ollama（本地模型）
                              │
                              ├─→ MCP Server ──→ Tool Service ──→ 天气/订单/汇率工具
                              │
                              └─→ 保存结果到 PostgreSQL
```

---

## 3. 使用流程：注册 → 执行 → 查看

### 3.1 注册一个 Agent

平台自带了一个示例 Agent（`examples/agents/customer-service.json`），可以直接注册：

```bash
curl -X POST http://localhost:8000/api/v1/agents \
  -H "Content-Type: application/json" \
  -d @examples/agents/customer-service.json
```

**预期输出**：
```json
{
  "message": "Agent registered successfully",
  "agent": {
    "id": "2d84a66c-76ce-4cab-9255-62c966b1d0d6",
    "name": "customer-service",
    "version": "1.0.0",
    "status": "active"
  }
}
```

**同时也支持 YAML 格式注册**：

```bash
curl -X POST http://localhost:8000/api/v1/agents \
  -H "Content-Type: application/yaml" \
  --data-binary @examples/agents/customer-service.yml
```

### 3.2 查看已注册的 Agent

```bash
curl http://localhost:8000/api/v1/agents | jq .
```

**预期输出**：
```json
{
  "agents": [
    {
      "name": "customer-service",
      "version": "1.0.0",
      "description": "智能客服Agent...",
      "status": "active"
    }
  ],
  "count": 1
}
```

查看单个 Agent 的完整定义：

```bash
curl http://localhost:8000/api/v1/agents/customer-service | jq .
```

### 3.3 执行 Agent 工作流

```bash
curl -X POST http://localhost:8000/api/v1/agents/customer-service/execute \
  -H "Content-Type: application/json" \
  -d '{"input": "你好，我想查询订单"}'
```

**预期输出**：
```json
{
  "execution_id": "exec-c310ba38",
  "status": "success",
  "response": "您好，关于您的订单查询...",
  "steps": [
    {
      "node": "understand_intent",
      "type": "llm",
      "status": "success",
      "latency_ms": 15
    },
    {
      "node": "query_order",
      "type": "tool",
      "status": "success",
      "latency_ms": 3
    },
    {
      "node": "generate_response",
      "type": "llm",
      "status": "success",
      "latency_ms": 8
    }
  ]
}
```

**执行过程解析**：

| 步骤 | 类型 | 做什么 | 耗时 |
|------|------|--------|------|
| `understand_intent` | LLM | 分析用户输入，判断意图（退款/订单查询/投诉） | ~15ms |
| `query_order` | Tool | 调用订单查询工具，获取订单信息 | ~3ms |
| `generate_response` | LLM | 根据意图和查询结果，生成回复 | ~8ms |

### 3.4 查看执行详情

```bash
# 用返回的 execution_id 查询
curl http://localhost:8000/api/v1/executions/exec-c310ba38 | jq .
```

**预期输出**：
```json
{
  "execution_id": "exec-c310ba38",
  "agent_name": "customer-service",
  "status": "success",
  "input": {"input": "你好，我想查询订单"},
  "output": {"response": "..."},
  "steps": [
    {
      "node": "understand_intent",
      "type": "llm",
      "status": "success",
      "output": "{\"intent\":\"order_query\",\"confidence\":0.92}",
      "latency_ms": 15
    }
  ],
  "duration_ms": 26,
  "created_at": "2026-04-25T04:46:44.123Z"
}
```

### 3.5 一键运行 Demo

```bash
make demo
```

**作用**：自动执行完整的注册 → 列出 → 执行 → 查询流程

---

## 4. 高级操作

### 4.1 查看所有执行历史

```bash
curl http://localhost:8000/api/v1/executions | jq .
```

> MVP 中 Orchestrator 没有暴露列出所有 executions 的接口，需要直接查询数据库：

```bash
docker exec relayops-postgres psql -U postgres -d agent_platform -c \
  "SELECT execution_id, agent_name, status, duration_ms, created_at FROM workflow_executions ORDER BY created_at DESC LIMIT 10;"
```

### 4.2 查看 LLM 调用记录

**方式一：Langfuse UI**
打开 http://localhost:3002 查看可视化追踪

**方式二：直接查询数据库**
```bash
docker exec relayops-postgres psql -U postgres -d agent_platform -c \
  "SELECT provider, model, total_tokens, latency_ms, cost_estimate, created_at FROM llm_calls ORDER BY created_at DESC LIMIT 10;"
```

### 4.3 查看审计日志

```bash
docker exec relayops-postgres psql -U postgres -d agent_platform -c \
  "SELECT event_type, actor, resource_type, action, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 10;"
```

### 4.4 知识库向量搜索

```bash
# 上传文档
curl -X POST http://localhost:8000/api/v1/knowledge/documents \
  -H "Content-Type: application/json" \
  -d '{"title": "退款政策", "content": "7天内可无理由退款..."}'

# 向量语义搜索
curl -X POST http://localhost:8000/api/v1/knowledge/search \
  -H "Content-Type: application/json" \
  -d '{"query": "怎么退货", "use_vector": true, "limit": 5}' | jq .
```

### 4.5 定时任务调度（BullMQ）

```bash
# 创建定时任务
curl -X POST http://localhost:8000/api/v1/scheduler/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "agent_name": "customer-service",
    "input": {"task": "daily_report"},
    "schedule": "0 9 * * *",
    "name": "daily-customer-report"
  }'

# 查看任务队列
curl http://localhost:8000/api/v1/scheduler/jobs | jq .
```

---

## 5. 自定义开发：创建你自己的 Agent

### 5.1 编写 Agent 定义

创建文件 `my-agent.json`：

```json
{
  "apiVersion": "agent.platform/v1",
  "kind": "Agent",
  "metadata": {
    "name": "weather-assistant",
    "version": "1.0.0",
    "description": "天气查询助手",
    "author": "your-name"
  },
  "spec": {
    "model": {
      "provider": "ollama",
      "name": "llama3.2",
      "temperature": 0.5
    },
    "system_prompt": "你是一个天气助手。根据用户查询的城市，调用天气工具获取信息，然后用友好的语气告诉用户。",
    "workflow": {
      "type": "sequential",
      "steps": [
        {
          "id": "get_weather",
          "type": "tool",
          "name": "获取天气",
          "tool": "weather_query",
          "inputs": { "city": "{{input}}" }
        },
        {
          "id": "reply",
          "type": "llm",
          "name": "生成回复",
          "prompt": "用户查询城市：{{input}}\n天气数据：{{steps.get_weather.output}}\n请生成友好的天气播报。"
        }
      ]
    }
  }
}
```

### 5.2 注册并执行

```bash
# 注册
curl -X POST http://localhost:8000/api/v1/agents \
  -H "Content-Type: application/json" \
  -d @my-agent.json

# 执行
curl -X POST http://localhost:8000/api/v1/agents/weather-assistant/execute \
  -d '{"input": "北京"}'
```

### 5.3 Agent 定义字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `metadata.name` | ✅ | Agent唯一标识（kebab-case） |
| `metadata.version` | ✅ | 语义化版本 |
| `metadata.description` | ❌ | 描述 |
| `spec.model.provider` | ✅ | `ollama` 或 `openai` |
| `spec.model.name` | ✅ | 模型名，如 `llama3.2` |
| `spec.model.temperature` | ❌ | 创造性程度，0-1 |
| `spec.system_prompt` | ✅ | 系统提示词 |
| `spec.workflow.steps` | ✅ | 工作流步骤数组 |
| `spec.workflow.steps[].type` | ✅ | `llm` / `tool` / `condition` / `pass` |
| `spec.workflow.steps[].prompt` | 条件 | LLM 节点需要，支持 `{{input}}` 和 `{{steps.xxx.output}}` 模板 |
| `spec.workflow.steps[].tool` | 条件 | Tool 节点需要，工具名 |
| `spec.workflow.steps[].inputs` | 条件 | Tool 节点需要，输入参数 |

---

## 6. 服务单独调用

### 6.1 直接调用 LLM（通过 LiteLLM）

```bash
curl -X POST http://localhost:8000/api/v1/llm/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-relayops-master-key" \
  -d '{
    "model": "llama3.2",
    "messages": [{"role": "user", "content": "请用一句话介绍自己"}],
    "temperature": 0.7
  }' | jq .
```

**预期输出**：
```json
{
  "id": "chatcmpl-xxx",
  "model": "ollama/llama3.2",
  "choices": [{
    "message": {"role": "assistant", "content": "你好！我是你的AI助手..."}
  }]
}
```

> 如果启动了 Ollama（`make up-all`），会返回真实模型响应；否则 LiteLLM 返回 echo fallback

### 6.2 直接调用工具

```bash
# 查询天气（Mock数据）
curl -X POST http://localhost:8000/api/v1/tools/weather_query/invoke \
  -d '{"city": "上海"}' | jq .

# 查询订单（Mock数据）
curl -X POST http://localhost:8000/api/v1/tools/order_query/invoke \
  -d '{"order_id": "ORD-12345"}' | jq .

# 查询汇率
curl -X POST http://localhost:8000/api/v1/tools/exchange_rate/invoke \
  -d '{"from": "CNY", "to": "USD"}' | jq .

# 发送邮件（Mock）
curl -X POST http://localhost:8000/api/v1/tools/send_email/invoke \
  -d '{"to": "user@example.com", "subject": "测试", "body": "这是一封测试邮件"}' | jq .
```

### 6.3 查看可用工具列表

```bash
curl http://localhost:8000/api/v1/tools | jq .
```

### 6.4 访问管理界面

| 界面 | 地址 | 说明 |
|------|------|------|
| Web UI | http://localhost:8000/app/ | Agent 管理控制台 |
| Flowise | http://localhost:3000 | 可视化LLM工作流 |
| Langfuse | http://localhost:3002 | LLM 可观测性 |
| Windmill | http://localhost:8001 | 工作流引擎 |

---

## 7. 常见问题

### Q1: `make up` 后服务显示 `unhealthy`

**原因**：首次启动时服务需要时间初始化数据库连接  
**解决**：等待 10-30 秒后重试 `make health`，或直接 curl 测试：

```bash
curl http://localhost:8000/health
curl http://localhost:8080/health
```

### Q2: 执行 Agent 返回 `Agent not found`

**原因**：Agent 未注册或名称拼写错误  
**解决**：先注册，注意名称大小写和连字符：

```bash
# 查看已注册列表
curl http://localhost:8000/api/v1/agents | jq '.agents[].name'
```

### Q3: LLM 调用返回 Echo 而不是真实模型

**原因**：Ollama 未启动或模型未下载  
**解决**：

```bash
# 启动完整版（含 Ollama）
make up-all

# 下载模型（首次需要）
make pull-model

# 或手动执行
docker exec -it relayops-ollama ollama pull llama3.2
```

### Q4: 如何查看服务日志？

```bash
# 所有服务日志
make logs

# 单个服务日志
docker logs relayops-orchestrator -f --tail=100
docker logs relayops-litellm -f --tail=100
```

### Q5: 修改代码后如何生效？

所有服务的源码通过 Docker Volume 挂载，**重启对应服务即可**：

```bash
# 修改了 orchestrator 代码
docker compose restart orchestrator

# 或重启全部
docker compose restart
```

### Q6: 数据库连接失败

**原因**：PostgreSQL 初始化脚本只在首次创建 Volume 时执行  
**解决**：如果修改了 `initdb/01-schema.sql`，需要重新创建 Volume：

```bash
make clean
make up
```

---

## 8. 关闭与清理

### 停止服务（保留数据）

```bash
make down
```

> 数据保存在 Docker Volume 中，下次 `make up` 可以恢复

### 完全清理（删除所有数据）

```bash
make clean
```

> ⚠️ 这会删除 PostgreSQL 和 Redis 的所有数据！

### 查看资源占用

```bash
docker stats --no-stream relayops-api-gateway relayops-orchestrator relayops-postgres
```

---

## 下一步

- **接入真实 LLM**: 在 `.env` 中设置 `OPENAI_API_KEY`，LiteLLM 会自动路由
- **开发新工具**: 在 `services/tool-service/src/index.ts` 的 `BUILT_IN_TOOLS` 中添加
- **接入 Ollama**: `make up-all` 启动本地模型，零 API 成本
- **阅读架构设计**: `docs/` 目录下有完整的产品架构和技术架构文档
