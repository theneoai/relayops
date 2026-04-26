# Agent Platform MVP

企业级 Agent Workflow 平台的最小可用产品（MVP）。支持 Docker Compose 一键启动，8 个核心服务 + 4 个基础设施/工具，可运行完整的 Agent 工作流。

---

## 快速开始（3 分钟）

```bash
# 1. 初始化（生成密钥和配置）
make init

# 2. 启动所有服务
make up

# 3. 验证健康状态
make health

# 4. 运行 Demo
make demo
```

---

## 架构概览

```
┌─────────────────────────────────────────────┐
│            API Gateway :8000                 │
│       统一入口 · 路由 · 健康聚合 · Web UI      │
└──────────────┬──────────────────────────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
┌───────┐ ┌────────┐ ┌──────────┐
│DevKit │ │Orche-  │ │ LiteLLM  │
│API    │ │strator │ │ Proxy    │
│:8080  │ │:8081   │ │ :4000    │
└───────┘ └────────┘ └──────────┘
    │          │          │
    └──────────┼──────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌─────────┐
│Tool Svc│ │MCP Svr │ │Windmill │
│ :8083  │ │ :8084  │ │ :8001   │
└────────┘ └────────┘ └─────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
┌─────────┐ ┌────────┐ ┌─────────┐
│PostgreSQL│ │ Redis  │ │Langfuse │
│ :5432   │ │ :6379  │ │ :3002   │
└─────────┘ └────────┘ └─────────┘
```

| 服务 | 端口 | 职责 |
|------|------|------|
| API Gateway | 8000 | 统一入口、请求路由、JWT认证（MVP可跳过）、健康聚合、Web UI |
| DevKit API | 8080 | Agent YAML/JSON 注册、知识库（pgvector 向量检索）、BullMQ 定时调度 |
| Orchestrator | 8081 | 顺序工作流执行引擎、状态Checkpoint、调用LLM和工具 |
| LiteLLM Proxy | 4000 | 统一LLM网关，多模型路由、Fallback、兼容OpenAI API |
| MCP Server | 8084 | MCP 工具协议标准化、工具注册与发现 |
| Tool Service | 8083 | 内置工具（天气/订单/汇率/邮件）、外部工具代理 |
| Langfuse | 3002 | LLM 可观测性，追踪调用链路、成本分析 |
| Windmill | 8001 | 工作流引擎，支持可视化编排与脚本执行 |
| Flowise | 3000 | 可视化LLM工作流编辑器 |
| PostgreSQL | 5432 | Agent定义、执行记录、审计日志、向量存储（pgvector） |
| Redis | 6379 | 会话缓存、执行状态Checkpoint、BullMQ 任务队列 |

---

## 手动验证流程

### 1. 注册 Agent

```bash
curl -X POST http://localhost:8000/api/v1/agents \
  -H "Content-Type: application/json" \
  -d @examples/agents/customer-service.json
```

### 2. 列出 Agent

```bash
curl http://localhost:8000/api/v1/agents | jq .
```

### 3. 执行工作流

```bash
curl -X POST http://localhost:8000/api/v1/agents/customer-service/execute \
  -H "Content-Type: application/json" \
  -d '{"input": "你好，我想查询订单"}' | jq .
```

**预期输出：**

```json
{
  "execution_id": "exec-xxxx",
  "status": "success",
  "response": "...",
  "steps": [
    { "node": "understand_intent", "type": "llm", "status": "success", "latency_ms": 15 },
    { "node": "query_order", "type": "tool", "status": "success", "latency_ms": 3 },
    { "node": "generate_response", "type": "llm", "status": "success", "latency_ms": 8 }
  ]
}
```

### 4. 查询执行详情

```bash
curl http://localhost:8000/api/v1/executions/exec-xxxx | jq .
```

### 5. 调用工具

```bash
curl -X POST http://localhost:8000/api/v1/tools/order_query/invoke \
  -H "Content-Type: application/json" \
  -d '{"order_id": "ORD-001"}' | jq .
```

### 6. LLM 对话

```bash
curl -X POST http://localhost:8000/api/v1/llm/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-relayops-master-key" \
  -d '{"model": "llama3.2", "messages": [{"role": "user", "content": "你好"}]}' | jq .
```

### 7. 知识库搜索

```bash
curl -X POST http://localhost:8000/api/v1/knowledge/search \
  -H "Content-Type: application/json" \
  -d '{"query": "退款政策", "limit": 5}' | jq .
```

---

## 常用命令

| 命令 | 作用 |
|------|------|
| `make init` | 初始化环境变量和密钥 |
| `make up` | 启动核心服务 |
| `make up-all` | 启动完整版（含 Ollama + Grafana） |
| `make down` | 停止服务 |
| `make health` | 查看所有服务健康状态 |
| `make logs` | 查看实时日志 |
| `make demo` | 运行端到端 Demo |
| `make clean` | 完全清理（含数据卷） |
| `make test-litellm` | 测试 LiteLLM Proxy |
| `make test-mcp` | 测试 MCP Server |

---

## 技术栈

- **运行时**: Node.js 20 + TypeScript + tsx
- **Web框架**: Express 4
- **数据库**: PostgreSQL 16 + pgvector 扩展
- **缓存/队列**: Redis 7 + BullMQ
- **LLM 网关**: LiteLLM Proxy（多模型路由、Fallback）
- **可观测性**: Langfuse（LLM 调用追踪）
- **工作流引擎**: Windmill + Flowise
- **工具协议**: MCP（Model Context Protocol）
- **部署**: Docker Compose（MVP），后续支持 K8s Helm

---

## 与 dify-proj / AIDevOps 的关系

本项目是上述两个项目的**下一代演进版本**：

- **保留**: DevKit YAML DSL 理念、MCP 工具生态、零侵入架构思想
- **升级**: 自研 LLM Gateway → LiteLLM Proxy，setInterval 调度 → BullMQ，PostgreSQL → pgvector
- **新增**: Langfuse 可观测性、Windmill 工作流引擎、原生向量检索

---

## 下一步演进

| 阶段 | 目标 |
|------|------|
| v0.3 | 多租户隔离、RBAC、Vault 密钥管理 |
| v0.4 | 引入 Kafka 事件总线、Sentinel 自治运维 |
| v0.5 | K8s Helm Chart、ArgoCD GitOps、金丝雀发布 |
| v1.0 | 生产级高可用、多活联邦、完整安全合规 |

---

*MVP v0.2 架构重构完成 ✅*
