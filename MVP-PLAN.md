# MVP 实现计划 v0.2

## 目标
在当前目录 `relayops/` 下构建一个**可运行的最小可用产品**，实现：
1. Docker Compose 一键拉起所有服务（`make up`）
2. 通过 API Gateway 创建一个 Agent（YAML/JSON定义）
3. 触发该 Agent 执行一个简单工作流（理解意图 → 调用工具 → LLM生成回答）
4. 全链路可观测（日志 + 健康检查端点 + Langfuse）
5. 知识库向量检索（pgvector）
6. 定时任务调度（BullMQ）

## MVP 服务范围（7个服务 + 4个基础设施/工具）

| 服务 | 端口 | 核心能力 | 技术栈 |
|------|------|----------|--------|
| api-gateway | 8000 | 统一入口、路由、健康聚合、Web UI | Node.js + Express |
| devkit-api | 8080 | Agent 注册、知识库（pgvector）、BullMQ 调度 | Node.js + Express + js-yaml |
| orchestrator | 8081 | 顺序工作流执行、状态管理、调用LLM和工具 | Node.js + Express |
| litellm | 4000 | 统一LLM网关、多模型路由、Fallback | LiteLLM Proxy |
| mcp-server | 8084 | MCP 工具协议标准化 | Node.js + Express |
| tool-service | 8083 | 通用工具注册、执行 | Node.js + Express |
| flowise | 3000 | 可视化LLM工作流编辑器 | Flowise |
| postgres | 5432 | 主数据存储 + 向量扩展 | pgvector/pgvector:pg16 |
| redis | 6379 | 缓存、会话、BullMQ队列 | redis:7-alpine |
| langfuse | 3002 | LLM可观测性追踪 | Langfuse |
| windmill | 8001 | 工作流引擎 | Windmill |

## 刻意省略（后续迭代加入）
- Kafka → 服务间直接 HTTP 调用（MVP足够）
- Temporal → 内存状态机 + Redis 持久化（MVP足够）
- Milvus → 用 PostgreSQL pgvector 插件（MVP足够）
- Sentinel/Guardrail 独立服务 → 作为中间件内嵌到 API Gateway（MVP足够）
- Vault → .env 环境变量（MVP足够）
- ArgoCD/K8s → Docker Compose（MVP足够）

## 文件结构

```
relayops/
├── Makefile                          # 统一命令入口
├── docker-compose.yml                # 本地一键编排
├── .env.example                      # 环境变量模板
├── scripts/
│   └── init.sh                       # 初始化密钥和配置
├── initdb/
│   └── 01-schema.sql                 # 数据库初始化脚本（含pgvector）
├── config/
│   ├── litellm/
│   │   └── config.yaml               # LiteLLM代理配置
│   ├── langfuse/
│   │   └── .env                      # Langfuse环境配置
│   └── windmill/
│       └── ...                       # Windmill配置
├── examples/
│   └── agents/
│       └── customer-service.json     # 示例Agent定义
├── ui/                               # Web管理界面
│   └── app.js
└── services/
    ├── api-gateway/
    │   ├── Dockerfile
    │   ├── package.json
    │   └── src/index.ts
    ├── devkit-api/
    │   ├── Dockerfile
    │   ├── package.json
    │   └── src/index.ts              # 含BullMQ队列和pgvector向量搜索
    ├── orchestrator/
    │   ├── Dockerfile
    │   ├── package.json
    │   └── src/index.ts
    ├── mcp-server/
    │   ├── Dockerfile
    │   ├── package.json
    │   └── src/index.ts
    ├── tool-service/
    │   ├── Dockerfile
    │   ├── package.json
    │   └── src/index.ts
    └── llm-gateway/                  # 已废弃，由LiteLLM替代
        └── ...
```

## Demo 验证流程

```bash
# 1. 初始化
make init

# 2. 启动
make up

# 3. 注册示例Agent
curl -X POST http://localhost:8000/api/v1/agents \
  -H "Content-Type: application/json" \
  -d @examples/agents/customer-service.json

# 4. 查看已注册Agent
curl http://localhost:8000/api/v1/agents

# 5. 触发Agent执行
curl -X POST http://localhost:8000/api/v1/agents/customer-service/execute \
  -H "Content-Type: application/json" \
  -d '{"input": "你好，我想退款"}'

# 6. 知识库搜索
curl -X POST http://localhost:8000/api/v1/knowledge/search \
  -H "Content-Type: application/json" \
  -d '{"query": "退款", "use_vector": true}'

# 7. 查看健康状态
make health

# 8. 访问Web UI
open http://localhost:8000/app/
```

## 里程碑

- [x] 计划制定
- [x] 项目脚手架创建
- [x] 基础设施（PostgreSQL/pgvector + Redis）可启动
- [x] API Gateway 可路由
- [x] DevKit API 可注册Agent、知识库检索、BullMQ调度
- [x] Orchestrator 可执行顺序Workflow
- [x] LiteLLM Proxy 可调用Ollama（含Fallback）
- [x] MCP Server 工具标准化
- [x] Tool Service 可执行工具
- [x] Langfuse 可观测性接入
- [x] Windmill 工作流引擎部署
- [x] Flowise 可视化编辑器
- [x] 端到端 Demo 跑通

---

*MVP v0.2 完成 ✅*
