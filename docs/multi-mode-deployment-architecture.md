# 多形态部署架构设计：本地单机 ↔ 云上K8s

> **版本**: v1.0  
> **日期**: 2026-04-25  
> **目标**: 服务完全解耦，Docker Compose一键本地拉起，K8s联邦云上生产  

---

## 目录

1. [设计原则](#1-设计原则)
2. [服务拆分与边界](#2-服务拆分与边界)
3. [本地单机部署（Docker Compose）](#3-本地单机部署docker-compose)
4. [云上K8s部署](#4-云上k8s部署)
5. [配置管理统一](#5-配置管理统一)
6. [服务间通信契约](#6-服务间通信契约)
7. [快速启动指南](#7-快速启动指南)
8. [附录：Compose vs K8s 对照表](#8-附录compose-vs-k8s-对照表)

---

## 1. 设计原则

```
┌─────────────────────────────────────────────────────────────────────┐
│                        「一次构建，处处运行」                          │
├─────────────────────────────────────────────────────────────────────┤
│  1. 容器化优先    │  每个服务独立Dockerfile，无外部依赖假设            │
│  2. 配置外部化    │  12-Factor App，环境变量 + 配置文件挂载            │
│  3. 服务发现抽象  │  本地用Compose DNS，云上K8s Service，应用无感知     │
│  4. 存储可插拔    │  本地Volume，云上PVC/对象存储，统一接口层           │
│  5. 协议标准化    │  服务间HTTP/gRPC + 异步Kafka/NATS，无直接耦合       │
│  6. 镜像复用      │  同一镜像打多标签，本地/云上完全一致               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 服务拆分与边界

### 2.1 服务拓扑全景

```
┌─────────────────────────────────────────────────────────────────────┐
│                         统一流量入口                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │   Nginx     │  │   Kong      │  │  Envoy      │                 │
│  │  (本地)      │  │  (API网关)   │  │  (K8s Ingress)│               │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                 │
└─────────┼────────────────┼────────────────┼────────────────────────┘
          │                │                │
          └────────────────┴────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│                      核心服务层（Core Services）                       │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐│
│  │  api-gateway│  │  devkit-api │  │ orchestrator│  │  llm-gateway││
│  │  API网关     │  │  DevKit服务 │  │  编排中枢    │  │  LLM路由    ││
│  │  :8000      │  │  :8080      │  │  :8081      │  │  :8082      ││
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘│
│         │                │                │                │       │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐│
│  │ tool-service│  │  mcp-hub    │  │  sentinel   │  │  guardrail  ││
│  │ 工具服务     │  │ MCP注册中心 │  │  SRE哨兵    │  │ 安全卫士    ││
│  │  :8083      │  │  :8084      │  │  :8085      │  │  :8086      ││
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘│
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐│
│  │  dify-api   │  │  dify-web   │  │  dify-worker│  │  dify-db    ││
│  │  Dify API   │  │  Dify UI    │  │  Dify Worker│  │  Dify DB    ││
│  │  :5001      │  │  :3000      │  │  (Celery)   │  │  :5432      ││
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│                      基础设施服务层（Infra Services）                  │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐│
│  │  postgres   │  │   redis     │  │   kafka     │  │  milvus     ││
│  │  主数据库    │  │  缓存/队列   │  │  事件总线    │  │  向量库      ││
│  │  :5432      │  │  :6379      │  │  :9092      │  │  :19530     ││
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘│
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐│
│  │  minio      │  │  temporal   │  │  langfuse   │  │  prometheus ││
│  │  对象存储    │  │  工作流引擎  │  │  LLM可观测   │  │  监控采集    ││
│  │  :9000      │  │  :7233      │  │  :3000      │  │  :9090      ││
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘│
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │  grafana    │  │  jaeger     │  │  vault      │                 │
│  │  可视化      │  │  分布式追踪  │  │  密钥管理    │                 │
│  │  :3001      │  │  :16686     │  │  :8200      │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 服务职责与接口

| 服务名 | 职责 | 暴露端口 | 依赖服务 | 资源需求（本地/云上） |
|--------|------|----------|----------|----------------------|
| `api-gateway` | 统一入口、路由、限流、认证 | 8000 | 所有上游服务 | 0.5核256M / 2核1G×3 |
| `devkit-api` | YAML编译、组件管理、GitOps触发 | 8080 | postgres, redis, kafka | 0.5核512M / 2核2G×2 |
| `orchestrator` | 工作流状态机、Agent调度、HITL | 8081 | redis, kafka, temporal | 1核1G / 4核4G×3 |
| `llm-gateway` | 多模型路由、Fallback、成本追踪 | 8082 | redis, kafka | 0.5核256M / 2核1G×3 |
| `tool-service` | 通用API工具、RBAC、PII过滤 | 8083 | postgres, redis | 0.5核256M / 2核1G×2 |
| `mcp-hub` | MCP Server注册、健康检查、发现 | 8084 | redis, kafka | 0.5核256M / 1核512M×2 |
| `sentinel` | 监控采集、异常检测、自愈执行 | 8085 | kafka, prometheus | 1核1G / 4核4G×2 |
| `guardrail` | 内容安全、Prompt注入检测、审计 | 8086 | redis, kafka | 0.5核512M / 2核2G×2 |
| `dify-api` | Dify REST API Server | 5001 | dify-db, redis | 1核1G / 2核2G×3 |
| `dify-web` | Dify React前端 | 3000 | dify-api | 0.5核256M / 1核512M×2 |
| `dify-worker` | Dify异步任务（Celery） | - | dify-db, redis | 0.5核512M / 2核2G×2 |

### 2.3 解耦设计原则

**禁止直接耦合**：
- ❌ 服务间不允许直接数据库访问（除本服务所属DB）
- ❌ 不允许共享本地文件系统（必须通过对象存储/消息队列）
- ❌ 不允许硬编码服务地址（必须通过服务发现）

**强制异步边界**：
- ✅ 所有状态变更通过Kafka/NATS事件总线广播
- ✅ 长时任务通过Temporal工作流引擎编排
- ✅ 配置变更通过GitOps + 配置中心推送

---

## 3. 本地单机部署（Docker Compose）

### 3.1 一键启动架构

```bash
# 克隆项目
git clone https://github.com/enterprise/agent-platform.git
cd agent-platform

# 1. 自动生成所有配置文件和密钥
make init

# 2. 选择部署模式（自动检测环境）
make up          # 本地完整版（所有服务）
make up-core     # 仅核心服务（无监控/可观测性）
make up-dev      # 开发模式（热重载 + 本地LLM）
make up-all      # 完整版 + Dify全家桶
```

### 3.2 Compose文件分层设计

```
docker-compose/
├── docker-compose.yml              # 核心服务（所有环境共享）
├── docker-compose.infra.yml        # 基础设施（DB/Redis/Kafka等）
├── docker-compose.observability.yml # 监控可观测性（Prometheus/Grafana/Jaeger）
├── docker-compose.security.yml     # 安全服务（Vault/Guardrails）
├── docker-compose.dify.yml         # Dify全家桶（可选）
├── docker-compose.local.yml        # 本地开发覆盖（热重载/Volume映射）
└── docker-compose.override.yml     # 用户自定义覆盖（gitignore）
```

### 3.3 核心Compose配置

```yaml
# docker-compose.yml — 核心服务层
version: "3.8"

x-common-variables: &common-variables
  NODE_ENV: ${NODE_ENV:-development}
  LOG_LEVEL: ${LOG_LEVEL:-info}
  OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4317
  KAFKA_BROKERS: kafka:9092
  REDIS_URL: redis://redis:6379/0
  DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/agent_platform

services:
  # ─────────────────────────────────────────────────────────
  # API Gateway — 统一入口
  # ─────────────────────────────────────────────────────────
  api-gateway:
    image: ghcr.io/enterprise/agent-platform/api-gateway:${VERSION:-latest}
    container_name: api-gateway
    ports:
      - "8000:8000"
    environment:
      <<: *common-variables
      GATEWAY_UPSTREAMS: |
        {
          "devkit": "http://devkit-api:8080",
          "orchestrator": "http://orchestrator:8081",
          "llm": "http://llm-gateway:8082",
          "tools": "http://tool-service:8083",
          "mcp": "http://mcp-hub:8084",
          "sentinel": "http://sentinel:8085",
          "guardrail": "http://guardrail:8086",
          "dify": "http://dify-api:5001"
        }
      JWT_PUBLIC_KEY: /run/secrets/jwt-public-key
    secrets:
      - jwt-public-key
    networks:
      - agent-network
    depends_on:
      - devkit-api
      - orchestrator
      - llm-gateway
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8000/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped

  # ─────────────────────────────────────────────────────────
  # DevKit API — 代码驱动开发服务
  # ─────────────────────────────────────────────────────────
  devkit-api:
    image: ghcr.io/enterprise/agent-platform/devkit-api:${VERSION:-latest}
    container_name: devkit-api
    ports:
      - "8080:8080"
    environment:
      <<: *common-variables
      DIFY_BASE_URL: http://dify-api:5001
      DIFY_API_KEY: ${DIFY_API_KEY:-}
      COMPONENTS_DIR: /app/components
      GITOPS_ENABLED: "true"
      GITOPS_REPO_URL: ${GITOPS_REPO_URL:-}
      GITOPS_BRANCH: ${GITOPS_BRANCH:-main}
    volumes:
      - ./components:/app/components:ro
      - devkit-cache:/app/.cache
    networks:
      - agent-network
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      kafka:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8080/health"]
      interval: 15s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # ─────────────────────────────────────────────────────────
  # Orchestrator — 工作流编排中枢
  # ─────────────────────────────────────────────────────────
  orchestrator:
    image: ghcr.io/enterprise/agent-platform/orchestrator:${VERSION:-latest}
    container_name: orchestrator
    ports:
      - "8081:8081"
    environment:
      <<: *common-variables
      TEMPORAL_HOST: temporal:7233
      TEMPORAL_NAMESPACE: agent-platform
      LANGGRAPH_CHECKPOINTER: redis
      HITL_ENABLED: "true"
      HITL_TIMEOUT_SECONDS: "3600"
    networks:
      - agent-network
    depends_on:
      redis:
        condition: service_healthy
      temporal:
        condition: service_healthy
      kafka:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8081/health"]
      interval: 15s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # ─────────────────────────────────────────────────────────
  # LLM Gateway — 多模型路由
  # ─────────────────────────────────────────────────────────
  llm-gateway:
    image: ghcr.io/enterprise/agent-platform/llm-gateway:${VERSION:-latest}
    container_name: llm-gateway
    ports:
      - "8082:8082"
    environment:
      <<: *common-variables
      # 本地开发默认使用Ollama，生产环境使用云API
      LLM_PROVIDERS: |
        [
          {"name": "ollama", "base_url": "http://ollama:11434", "priority": 1, "models": ["llama3", "qwen2.5"]},
          {"name": "openai", "api_key": "${OPENAI_API_KEY:-}", "priority": 2},
          {"name": "anthropic", "api_key": "${ANTHROPIC_API_KEY:-}", "priority": 3}
        ]
      FALLBACK_ENABLED: "true"
      COST_TRACKING_ENABLED: "true"
    networks:
      - agent-network
    depends_on:
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8082/health"]
      interval: 15s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # ─────────────────────────────────────────────────────────
  # Tool Service — 通用工具API
  # ─────────────────────────────────────────────────────────
  tool-service:
    image: ghcr.io/enterprise/agent-platform/tool-service:${VERSION:-latest}
    container_name: tool-service
    ports:
      - "8083:8083"
    environment:
      <<: *common-variables
      PII_DETECTION_ENABLED: "true"
      PRESIDIO_ANALYZER_URL: http://guardrail:8086/pii
      RATE_LIMIT_RPS: "100"
      RBAC_ENABLED: "true"
    networks:
      - agent-network
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8083/health"]
      interval: 15s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # ─────────────────────────────────────────────────────────
  # MCP Hub — MCP Server注册中心
  # ─────────────────────────────────────────────────────────
  mcp-hub:
    image: ghcr.io/enterprise/agent-platform/mcp-hub:${VERSION:-latest}
    container_name: mcp-hub
    ports:
      - "8084:8084"
    environment:
      <<: *common-variables
      MCP_HEALTH_CHECK_INTERVAL: "30"
      MCP_SERVER_TIMEOUT: "10"
    networks:
      - agent-network
    depends_on:
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8084/health"]
      interval: 15s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # ─────────────────────────────────────────────────────────
  # Sentinel — SRE哨兵/运维Agent
  # ─────────────────────────────────────────────────────────
  sentinel:
    image: ghcr.io/enterprise/agent-platform/sentinel:${VERSION:-latest}
    container_name: sentinel
    ports:
      - "8085:8085"
    environment:
      <<: *common-variables
      PROMETHEUS_URL: http://prometheus:9090
      AUTOREMEDIATE_ENABLED: "true"
      AUTOREMEDIATE_MAX_RISK: "medium"
      SLACK_WEBHOOK_URL: ${SLACK_WEBHOOK_URL:-}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro  # 本地需要操作Docker
      - ./sentinel-rules:/app/rules:ro
    networks:
      - agent-network
    depends_on:
      kafka:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8085/health"]
      interval: 15s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # ─────────────────────────────────────────────────────────
  # Guardrail — 安全卫士
  # ─────────────────────────────────────────────────────────
  guardrail:
    image: ghcr.io/enterprise/agent-platform/guardrail:${VERSION:-latest}
    container_name: guardrail
    ports:
      - "8086:8086"
    environment:
      <<: *common-variables
      GUARDRAILS_CONFIG_PATH: /app/guardrails.yml
      AUDIT_LOG_RETENTION_DAYS: "90"
    volumes:
      - ./guardrails.yml:/app/guardrails.yml:ro
    networks:
      - agent-network
    depends_on:
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8086/health"]
      interval: 15s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # ─────────────────────────────────────────────────────────
  # Dify服务（可选子模块）
  # ─────────────────────────────────────────────────────────
  dify-api:
    image: langgenius/dify-api:${DIFY_VERSION:-1.0.0}
    container_name: dify-api
    ports:
      - "5001:5001"
    environment:
      MODE: api
      DB_USERNAME: postgres
      DB_PASSWORD: ${POSTGRES_PASSWORD}
      DB_HOST: postgres
      DB_PORT: 5432
      DB_DATABASE: dify
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_DB: 1
      SECRET_KEY: ${DIFY_SECRET_KEY}
    networks:
      - agent-network
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  dify-web:
    image: langgenius/dify-web:${DIFY_VERSION:-1.0.0}
    container_name: dify-web
    ports:
      - "3000:3000"
    environment:
      CONSOLE_API_URL: http://localhost:5001
      APP_API_URL: http://localhost:5001
    networks:
      - agent-network
    depends_on:
      - dify-api
    restart: unless-stopped

  dify-worker:
    image: langgenius/dify-api:${DIFY_VERSION:-1.0.0}
    container_name: dify-worker
    environment:
      MODE: worker
      DB_USERNAME: postgres
      DB_PASSWORD: ${POSTGRES_PASSWORD}
      DB_HOST: postgres
      DB_PORT: 5432
      DB_DATABASE: dify
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_DB: 1
      SECRET_KEY: ${DIFY_SECRET_KEY}
    networks:
      - agent-network
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

# ─────────────────────────────────────────────────────────
# 基础设施服务（通常放在 docker-compose.infra.yml）
# ─────────────────────────────────────────────────────────
  postgres:
    image: postgres:16-alpine
    container_name: postgres
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
      POSTGRES_DB: agent_platform
      POSTGRES_INITDB_ARGS: "--encoding=UTF-8 --locale=en_US.UTF-8"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./initdb:/docker-entrypoint-initdb.d:ro
    networks:
      - agent-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    networks:
      - agent-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped

  kafka:
    image: confluentinc/cp-kafka:7.6.0
    container_name: kafka
    ports:
      - "9092:9092"
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
      KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"
      CLUSTER_ID: agent-platform-kafka-cluster
    volumes:
      - kafka_data:/var/lib/kafka/data
    networks:
      - agent-network
    healthcheck:
      test: ["CMD", "kafka-broker-api-versions", "--bootstrap-server", "localhost:9092"]
      interval: 10s
      timeout: 10s
      retries: 10
    restart: unless-stopped

  temporal:
    image: temporalio/auto-setup:1.24.0
    container_name: temporal
    ports:
      - "7233:7233"
      - "8233:8233"
    environment:
      DB: postgres12
      DB_PORT: 5432
      POSTGRES_USER: postgres
      POSTGRES_PWD: ${POSTGRES_PASSWORD}
      POSTGRES_SEEDS: postgres
      DYNAMIC_CONFIG_FILE_PATH: config/dynamicconfig/development-sql.yaml
    networks:
      - agent-network
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "tctl", "--address", "temporal:7233", "cluster", "health"]
      interval: 10s
      timeout: 5s
      retries: 10
    restart: unless-stopped

  ollama:
    image: ollama/ollama:latest
    container_name: ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    networks:
      - agent-network
    profiles:
      - local-llm
    restart: unless-stopped

# ─────────────────────────────────────────────────────────
# 监控可观测性（通常放在 docker-compose.observability.yml）
# ─────────────────────────────────────────────────────────
  prometheus:
    image: prom/prometheus:v2.51.0
    container_name: prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus_data:/prometheus
    networks:
      - agent-network
    restart: unless-stopped

  grafana:
    image: grafana/grafana:10.4.0
    container_name: grafana
    ports:
      - "3001:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD:-admin}
      GF_INSTALL_PLUGINS: grafana-clock-panel,grafana-simple-json-datasource
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana/dashboards:/etc/grafana/provisioning/dashboards:ro
      - ./grafana/datasources:/etc/grafana/provisioning/datasources:ro
    networks:
      - agent-network
    restart: unless-stopped

  jaeger:
    image: jaegertracing/all-in-one:1.55
    container_name: jaeger
    ports:
      - "16686:16686"
      - "4317:4317"
      - "4318:4318"
    environment:
      COLLECTOR_OTLP_ENABLED: "true"
    networks:
      - agent-network
    restart: unless-stopped

  langfuse:
    image: langfuse/langfuse:2
    container_name: langfuse
    ports:
      - "3002:3000"
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/langfuse
      NEXTAUTH_SECRET: ${LANGFUSE_SECRET}
      SALT: ${LANGFUSE_SALT}
      NEXTAUTH_URL: http://localhost:3002
      TELEMETRY_ENABLED: "false"
    networks:
      - agent-network
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

# ─────────────────────────────────────────────────────────
# 卷和网络
# ─────────────────────────────────────────────────────────
volumes:
  postgres_data:
  redis_data:
  kafka_data:
  ollama_data:
  prometheus_data:
  grafana_data:
  devkit-cache:

networks:
  agent-network:
    driver: bridge
    name: agent-network
    ipam:
      config:
        - subnet: 172.28.0.0/16

secrets:
  jwt-public-key:
    file: ./secrets/jwt-public-key.pem
```

### 3.4 Makefile一键命令

```makefile
# Makefile — 统一入口
.PHONY: init up up-core up-dev up-all down status health logs

VERSION ?= latest
COMPOSE_FILES := -f docker-compose.yml -f docker-compose.infra.yml

# 初始化：生成密钥、配置文件
init:
	@echo "🔧 Initializing Agent Platform..."
	@mkdir -p secrets components sentinel-rules
	@chmod 700 secrets
	@test -f .env || cp .env.example .env
	@test -f secrets/jwt-private-key.pem || \
	  openssl genrsa -out secrets/jwt-private-key.pem 2048 && \
	  openssl rsa -in secrets/jwt-private-key.pem -pubout -out secrets/jwt-public-key.pem
	@sed -i.bak "s/JWT_SECRET=.*/JWT_SECRET=$$(openssl rand -hex 32)/" .env && rm -f .env.bak
	@echo "✅ Initialization complete. Edit .env to customize."

# 本地完整启动
up:
	docker compose $(COMPOSE_FILES) -f docker-compose.observability.yml up -d
	@echo "🚀 Agent Platform starting..."
	@sleep 5
	@$(MAKE) health

# 仅核心服务（快速启动）
up-core:
	docker compose $(COMPOSE_FILES) up -d api-gateway devkit-api orchestrator llm-gateway tool-service mcp-hub postgres redis kafka temporal
	@echo "🚀 Core services starting..."

# 开发模式（热重载 + 本地LLM）
up-dev:
	docker compose $(COMPOSE_FILES) -f docker-compose.local.yml -f docker-compose.observability.yml --profile local-llm up -d
	@echo "🚀 Dev mode with hot-reload and local LLM..."

# 完整版 + Dify
up-all:
	docker compose $(COMPOSE_FILES) -f docker-compose.observability.yml -f docker-compose.dify.yml up -d
	@echo "🚀 Full stack with Dify starting..."

# 停止所有
down:
	docker compose $(COMPOSE_FILES) -f docker-compose.observability.yml -f docker-compose.dify.yml -f docker-compose.local.yml down

# 查看状态
status:
	@docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

# 健康检查
health:
	@echo "🏥 Health Check:"
	@for svc in api-gateway devkit-api orchestrator llm-gateway tool-service mcp-hub sentinel guardrail postgres redis kafka temporal; do \
	  status=$$(docker inspect --format='{{.State.Health.Status}}' $$svc 2>/dev/null || echo "not found"); \
	  printf "  %-20s %s\n" "$$svc:" "$$status"; \
	done

# 查看日志
logs:
	docker compose logs -f --tail=100

# 完全清理（包括数据卷）
clean:
	docker compose $(COMPOSE_FILES) -f docker-compose.observability.yml -f docker-compose.dify.yml down -v
	@docker volume prune -f
```

---

## 4. 云上K8s部署

### 4.1 部署拓扑

```
┌─────────────────────────────────────────────────────────────────────┐
│                        K8s Cluster (Production)                     │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Ingress-NGINX / Istio Gateway                               │   │
│  │  • TLS终止 • 路由规则 • 速率限制 • WAF                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│  ┌───────────────────────────▼───────────────────────────────────┐ │
│  │  Namespace: agent-platform                                     │ │
│  │                                                                │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │ │
│  │  │api-gw   │ │devkit   │ │orch     │ │llm-gw   │ │tool-svc │ │ │
│  │  │Deployment│ │Deployment│ │Deployment│ │Deployment│ │Deployment│ │ │
│  │  │replicas:3│ │replicas:2│ │replicas:3│ │replicas:3│ │replicas:2│ │ │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐             │ │
│  │  │mcp-hub  │ │sentinel │ │guardrail│ │dify-api │             │ │
│  │  │Deployment│ │Deployment│ │Deployment│ │Deployment│             │ │
│  │  │replicas:2│ │replicas:2│ │replicas:2│ │replicas:3│             │ │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘             │ │
│  │                                                                │ │
│  │  HPA: CPU>70% or 自定义指标(QPS/Latency) 自动扩缩容              │ │
│  │  PDB: 确保滚动更新时最小可用副本数                               │ │
│  │  NetworkPolicy: 东西向流量最小权限                              │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              │                                       │
│  ┌───────────────────────────▼───────────────────────────────────┐ │
│  │  Namespace: agent-platform-data                                │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │ │
│  │  │PostgreSQL│ │Redis    │ │Kafka    │ │Milvus   │ │MinIO    │ │ │
│  │  │StatefulSet│ │StatefulSet│ │StatefulSet│ │StatefulSet│ │StatefulSet│ │ │
│  │  │(Patroni) │ │(Cluster)│ │(KRaft)  │ │(Cluster)│ │(Distributed)│ │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              │                                       │
│  ┌───────────────────────────▼───────────────────────────────────┐ │
│  │  Namespace: agent-platform-ops                                 │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │ │
│  │  │Prometheus│ │Grafana  │ │Jaeger   │ │Langfuse │ │ArgoCD   │ │ │
│  │  │(Operator)│ │         │ │         │ │         │ │         │ │ │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Helm Chart统一封装

```
helm/agent-platform/
├── Chart.yaml                    # Chart元数据
├── values.yaml                   # 默认配置（本地开发默认值）
├── values-production.yaml        # 生产覆盖配置
├── values-staging.yaml           # 预发布覆盖配置
├── templates/
│   ├── _helpers.tpl              # 通用模板函数
│   ├── configmap.yaml            # 应用配置
│   ├── secret.yaml               # 密钥（引用ExternalSecrets）
│   ├── ingress.yaml              # 入口路由
│   ├── networkpolicy.yaml        # 网络安全策略
│   ├── pdb.yaml                  # PodDisruptionBudget
│   │
│   ├── api-gateway/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── hpa.yaml
│   │   └── servicemonitor.yaml
│   ├── devkit-api/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── hpa.yaml
│   │   └── servicemonitor.yaml
│   ├── orchestrator/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── hpa.yaml
│   │   └── servicemonitor.yaml
│   ├── llm-gateway/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── hpa.yaml
│   │   └── servicemonitor.yaml
│   ├── tool-service/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── hpa.yaml
│   │   └── servicemonitor.yaml
│   ├── mcp-hub/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── hpa.yaml
│   │   └── servicemonitor.yaml
│   ├── sentinel/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── hpa.yaml
│   │   ├── rbac.yaml           # 需要K8s API权限
│   │   └── servicemonitor.yaml
│   ├── guardrail/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── hpa.yaml
│   │   └── servicemonitor.yaml
│   └── dify/
│       ├── api-deployment.yaml
│       ├── web-deployment.yaml
│       ├── worker-deployment.yaml
│       ├── service.yaml
│       └── hpa.yaml
│
├── charts/                       # 子Chart依赖
│   ├── postgresql-ha-*.tgz       # Patroni HA PostgreSQL
│   ├── redis-cluster-*.tgz       # Redis Cluster
│   ├── kafka-*.tgz               # Kafka (KRaft模式)
│   ├── milvus-*.tgz              # Milvus向量数据库
│   ├── minio-*.tgz               # MinIO对象存储
│   ├── temporal-*.tgz            # Temporal工作流引擎
│   ├── prometheus-*.tgz          # kube-prometheus-stack
│   ├── grafana-*.tgz             # Grafana（如需要独立）
│   ├── jaeger-*.tgz              # Jaegertracing
│   ├── langfuse-*.tgz            # Langfuse
│   ├── vault-*.tgz               # HashiCorp Vault
│   └── argo-cd-*.tgz             # ArgoCD GitOps
│
└── crds/                         # 自定义资源定义
```

### 4.3 values.yaml 核心配置

```yaml
# values.yaml — 默认配置（适合本地/开发）
global:
  imageRegistry: ghcr.io/enterprise/agent-platform
  imageTag: latest
  imagePullPolicy: IfNotPresent
  
  # 本地模式标记（影响服务发现、存储类等行为）
  localMode: true
  
  # 共享配置
  logLevel: info
  otelEnabled: true
  otelEndpoint: "http://jaeger-collector:4317"

# ─────────────────────────────────────────────────────────
# 核心服务配置
# ─────────────────────────────────────────────────────────
apiGateway:
  enabled: true
  replicas: 1
  service:
    type: NodePort
    port: 8000
    nodePort: 30080
  resources:
    requests:
      cpu: 500m
      memory: 256Mi
  ingress:
    enabled: false  # 本地用NodePort，云上启用Ingress
  hpa:
    enabled: false  # 本地不启用HPA

devkitApi:
  enabled: true
  replicas: 1
  service:
    port: 8080
  resources:
    requests:
      cpu: 500m
      memory: 512Mi
  persistence:
    components:
      enabled: true
      size: 1Gi
      storageClass: ""  # 本地用默认，云上指定

orchestrator:
  enabled: true
  replicas: 1
  service:
    port: 8081
  resources:
    requests:
      cpu: 1000m
      memory: 1Gi
  temporal:
    host: temporal-frontend:7233
    namespace: agent-platform

llmGateway:
  enabled: true
  replicas: 1
  service:
    port: 8082
  resources:
    requests:
      cpu: 500m
      memory: 256Mi
  providers:
    - name: ollama
      baseUrl: http://ollama:11434
      priority: 1
      models:
        - llama3
        - qwen2.5

toolService:
  enabled: true
  replicas: 1
  service:
    port: 8083
  resources:
    requests:
      cpu: 500m
      memory: 256Mi

mcpHub:
  enabled: true
  replicas: 1
  service:
    port: 8084
  resources:
    requests:
      cpu: 500m
      memory: 256Mi

sentinel:
  enabled: true
  replicas: 1
  service:
    port: 8085
  resources:
    requests:
      cpu: 1000m
      memory: 1Gi
  rbac:
    enabled: true  # 需要K8s API访问权限进行自愈操作
  autoremediate:
    enabled: true
    maxRisk: medium

guardrail:
  enabled: true
  replicas: 1
  service:
    port: 8086
  resources:
    requests:
      cpu: 500m
      memory: 512Mi

# ─────────────────────────────────────────────────────────
# Dify配置
# ─────────────────────────────────────────────────────────
dify:
  enabled: true
  api:
    replicas: 1
    image: langgenius/dify-api
    tag: "1.0.0"
  web:
    replicas: 1
    image: langgenius/dify-web
    tag: "1.0.0"
  worker:
    replicas: 1
    image: langgenius/dify-api
    tag: "1.0.0"

# ─────────────────────────────────────────────────────────
# 基础设施依赖（子Chart配置）
# ─────────────────────────────────────────────────────────
postgresql-ha:
  enabled: true
  postgresql:
    replicaCount: 1  # 本地1副本，生产3副本+Patroni
  persistence:
    size: 10Gi

redis-cluster:
  enabled: true
  cluster:
    nodes: 3
    replicas: 0  # 本地无副本，生产每主1从
  persistence:
    size: 2Gi

kafka:
  enabled: true
  replicaCount: 1  # 本地单节点，生产3节点KRaft
  persistence:
    size: 10Gi

temporal:
  enabled: true
  server:
    replicaCount: 1
  cassandra:
    enabled: false
  postgresql:
    enabled: true

milvus:
  enabled: false  # 本地可禁用，向量用pgvector替代

minio:
  enabled: true
  mode: standalone  # 本地单机，生产distributed
  persistence:
    size: 10Gi

# ─────────────────────────────────────────────────────────
# 可观测性
# ─────────────────────────────────────────────────────────
prometheus:
  enabled: true
  prometheus:
    prometheusSpec:
      retention: 7d  # 本地7天，生产30天+

grafana:
  enabled: true
  adminPassword: admin
  persistence:
    enabled: false  # 本地不持久化，生产启用PVC

jaeger:
  enabled: true
  storage:
    type: memory  # 本地内存，生产elasticsearch/badger

langfuse:
  enabled: true
```

### 4.4 生产覆盖配置

```yaml
# values-production.yaml — 生产环境覆盖
global:
  localMode: false
  imageTag: "v1.2.3"  # 固定版本
  imagePullPolicy: Always

# 所有核心服务：多副本 + HPA + PDB
apiGateway:
  replicas: 3
  service:
    type: ClusterIP
  hpa:
    enabled: true
    minReplicas: 3
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70
    targetMemoryUtilizationPercentage: 80
  pdb:
    enabled: true
    minAvailable: 2
  ingress:
    enabled: true
    className: nginx
    annotations:
      cert-manager.io/cluster-issuer: letsencrypt-prod
      nginx.ingress.kubernetes.io/rate-limit: "1000"
    hosts:
      - api.aidevops.example.com
    tls:
      - secretName: api-tls
        hosts:
          - api.aidevops.example.com

devkitApi:
  replicas: 2
  hpa:
    enabled: true
    minReplicas: 2
    maxReplicas: 6
  pdb:
    enabled: true
    minAvailable: 1

orchestrator:
  replicas: 3
  hpa:
    enabled: true
    minReplicas: 3
    maxReplicas: 10
  pdb:
    enabled: true
    minAvailable: 2

llmGateway:
  replicas: 3
  hpa:
    enabled: true
    minReplicas: 3
    maxReplicas: 10
  pdb:
    enabled: true
    minAvailable: 2
  providers:
    - name: openai
      apiKeyRef:
        name: llm-secrets
        key: openai-api-key
      priority: 1
    - name: anthropic
      apiKeyRef:
        name: llm-secrets
        key: anthropic-api-key
      priority: 2
    - name: azure-openai
      baseUrl: https://enterprise.openai.azure.com
      apiKeyRef:
        name: llm-secrets
        key: azure-api-key
      priority: 3

toolService:
  replicas: 2
  hpa:
    enabled: true
    minReplicas: 2
    maxReplicas: 8

mcpHub:
  replicas: 2
  hpa:
    enabled: true
    minReplicas: 2
    maxReplicas: 6

sentinel:
  replicas: 2
  hpa:
    enabled: true
    minReplicas: 2
    maxReplicas: 4
  rbac:
    enabled: true

guardrail:
  replicas: 2
  hpa:
    enabled: true
    minReplicas: 2
    maxReplicas: 6

# 基础设施：高可用模式
postgresql-ha:
  postgresql:
    replicaCount: 3
  persistence:
    storageClass: gp3-encrypted  # AWS EBS示例
    size: 100Gi

redis-cluster:
  cluster:
    nodes: 6  # 3主3从
    replicas: 1
  persistence:
    storageClass: gp3-encrypted
    size: 20Gi

kafka:
  replicaCount: 3
  persistence:
    storageClass: gp3-encrypted
    size: 500Gi

milvus:
  enabled: true
  cluster:
    enabled: true
  persistence:
    storageClass: gp3-encrypted

minio:
  mode: distributed
  replicas: 4
  persistence:
    storageClass: gp3-encrypted
    size: 500Gi

# 可观测性：长期存储
prometheus:
  prometheus:
    prometheusSpec:
      retention: 30d
      storageSpec:
        volumeClaimTemplate:
          spec:
            storageClassName: gp3-encrypted
            resources:
              requests:
                storage: 200Gi

grafana:
  persistence:
    enabled: true
    storageClassName: gp3-encrypted
    size: 10Gi

jaeger:
  storage:
    type: elasticsearch
    elasticsearch:
      nodeCount: 3
      persistence:
        size: 100Gi
```

### 4.5 K8s部署命令

```bash
# 1. 添加Helm仓库
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add jaegertracing https://jaegertracing.github.io/helm-charts
helm repo add langfuse https://langfuse.github.io/langfuse-k8s
helm repo update

# 2. 构建依赖
helm dependency build helm/agent-platform

# 3. 安装到K8s集群（预发布环境）
helm upgrade --install agent-platform ./helm/agent-platform \
  -n agent-platform --create-namespace \
  -f helm/agent-platform/values.yaml \
  -f helm/agent-platform/values-staging.yaml

# 4. 安装到生产环境
helm upgrade --install agent-platform ./helm/agent-platform \
  -n agent-platform --create-namespace \
  -f helm/agent-platform/values.yaml \
  -f helm/agent-platform/values-production.yaml \
  --wait --timeout 600s

# 5. 查看状态
kubectl get pods -n agent-platform
kubectl get svc -n agent-platform
kubectl get ingress -n agent-platform

# 6. 查看日志
kubectl logs -n agent-platform -l app.kubernetes.io/name=api-gateway --tail=100 -f

# 7. 扩缩容示例
kubectl scale deployment api-gateway --replicas=5 -n agent-platform

# 8. 卸载
helm uninstall agent-platform -n agent-platform
```

---

## 5. 配置管理统一

### 5.1 配置分层模型

```
配置来源优先级（高 → 低）：

1. 环境变量（ENV）              ← 敏感配置、动态配置
2. 配置文件挂载（ConfigMap）     ← 应用配置、规则文件
3. 配置中心（Vault/ETCD）        ← 密钥、证书、动态策略
4. 默认值（代码内置）            ← 开发默认值
```

### 5.2 本地 vs 云上配置差异

| 配置项 | 本地（Docker Compose） | 云上（K8s） |
|--------|------------------------|-------------|
| 服务发现 | Compose DNS名（`postgres`） | K8s Service名（`postgresql-ha.agent-platform-data`） |
| 存储 | Docker Named Volume | PVC + StorageClass |
| 密钥 | `.env`文件 + Docker Secrets | External Secrets Operator + Vault |
| 入口访问 | `localhost:8000` | Ingress + TLS证书 |
| 日志输出 | stdout（docker logs） | Fluent Bit / Vector → Loki/ES |
| 配置热更新 | 重启容器 | ConfigMap/Secret热挂载 + 应用热重载 |

### 5.3 统一配置模板

```yaml
# config/application.yml — 所有服务共享的配置模板
# 通过环境变量覆盖特定值

server:
  port: ${SERVER_PORT:-8080}
  shutdown: graceful

logging:
  level: ${LOG_LEVEL:-info}
  format: ${LOG_FORMAT:-json}  # 云上json，本地text

observability:
  otel:
    enabled: ${OTEL_ENABLED:-true}
    endpoint: ${OTEL_EXPORTER_OTLP_ENDPOINT:-http://jaeger:4317}
    service_name: ${OTEL_SERVICE_NAME:-unknown}
  metrics:
    enabled: true
    path: /metrics
    port: ${METRICS_PORT:-9090}
  tracing:
    enabled: true
    sampling_rate: ${TRACE_SAMPLING_RATE:-1.0}  # 本地100%，生产10%

messaging:
  kafka:
    brokers: ${KAFKA_BROKERS:-kafka:9092}
    consumer_group: ${KAFKA_CONSUMER_GROUP:-default}
    topics:
      agent_events: agent.platform.events
      workflow_commands: agent.platform.workflow.commands
      audit_logs: agent.platform.audit.logs

cache:
  redis:
    url: ${REDIS_URL:-redis://redis:6379/0}
    pool_size: ${REDIS_POOL_SIZE:-10}

database:
  primary:
    url: ${DATABASE_URL:-postgresql://postgres:changeme@postgres:5432/agent_platform}
    pool_size: ${DB_POOL_SIZE:-10}
    max_connections: ${DB_MAX_CONNECTIONS:-100}

security:
  jwt:
    public_key_path: ${JWT_PUBLIC_KEY_PATH:-/run/secrets/jwt-public-key}
    issuer: ${JWT_ISSUER:-agent-platform}
    audience: ${JWT_AUDIENCE:-agent-platform}
  guardrail:
    endpoint: ${GUARDRAIL_ENDPOINT:-http://guardrail:8086}
    timeout_ms: 5000
```

---

## 6. 服务间通信契约

### 6.1 同步通信（HTTP/gRPC）

```yaml
# OpenAPI规范示例：api-gateway 路由配置
openapi: 3.0.0
info:
  title: Agent Platform Gateway API
  version: 1.0.0

paths:
  /api/v1/agents:
    get:
      summary: 列出所有Agent
      x-route-to: devkit-api:8080
      x-timeout: 5s
      x-retries: 2
    post:
      summary: 创建Agent
      x-route-to: devkit-api:8080
      x-timeout: 30s
      x-auth: required

  /api/v1/workflows/{id}/execute:
    post:
      summary: 执行工作流
      x-route-to: orchestrator:8081
      x-timeout: 300s  # 长时任务
      x-async: true    # 异步返回execution_id

  /api/v1/llm/chat:
    post:
      summary: LLM对话
      x-route-to: llm-gateway:8082
      x-timeout: 60s
      x-streaming: true
      x-cost-tracking: true

  /api/v1/tools/{name}/invoke:
    post:
      summary: 调用工具
      x-route-to: tool-service:8083
      x-timeout: 30s
      x-mcp-discovery: true  # 支持MCP动态发现

  /api/v1/mcp/servers:
    get:
      summary: 列出MCP Server
      x-route-to: mcp-hub:8084
      x-timeout: 5s

  /api/v1/health:
    get:
      summary: 健康检查聚合
      x-aggregate: true  # 聚合所有下游服务状态
```

### 6.2 异步通信（Kafka Topic设计）

| Topic | 生产者 | 消费者 | 用途 |
|-------|--------|--------|------|
| `agent.platform.events` | 所有服务 | sentinel, langfuse | 业务事件总线 |
| `agent.platform.workflow.commands` | devkit-api, api-gateway | orchestrator | 工作流执行命令 |
| `agent.platform.workflow.results` | orchestrator | devkit-api, sentinel | 工作流执行结果 |
| `agent.platform.llm.requests` | orchestrator, tool-service | llm-gateway | LLM调用请求 |
| `agent.platform.llm.responses` | llm-gateway | orchestrator | LLM调用响应 |
| `agent.platform.audit.logs` | guardrail, api-gateway | sentinel, S3归档 | 审计日志 |
| `agent.platform.mcp.discovery` | mcp-hub | api-gateway | MCP服务变更事件 |
| `agent.platform.alerts` | sentinel | slack-webhook, pagerduty | 告警通知 |
| `agent.platform.remediations` | sentinel | sentinel-actor | 自愈执行指令 |

### 6.3 健康检查契约

所有服务必须实现统一健康检查端点：

```json
// GET /health
{
  "status": "healthy",        // healthy | degraded | unhealthy
  "version": "1.2.3",
  "timestamp": "2026-04-25T12:00:00Z",
  "checks": {
    "database": { "status": "pass", "latency_ms": 5 },
    "cache": { "status": "pass", "latency_ms": 2 },
    "messaging": { "status": "pass", "lag": 0 },
    "downstream": {
      "llm-gateway": { "status": "pass", "latency_ms": 45 }
    }
  }
}

// GET /ready  (K8s readinessProbe)
{
  "ready": true
}

// GET /live   (K8s livenessProbe)
{
  "alive": true
}
```

---

## 7. 快速启动指南

### 7.1 本地开发（5分钟启动）

```bash
# 1. 克隆仓库
git clone https://github.com/enterprise/agent-platform.git
cd agent-platform

# 2. 一键初始化（生成密钥、配置）
make init

# 3. 启动核心服务（约2分钟）
make up-core

# 4. 验证服务状态
make health

# 5. 访问服务
#   API Gateway:    http://localhost:8000
#   Dify UI:        http://localhost:3000
#   Grafana:        http://localhost:3001  (admin/admin)
#   Jaeger UI:      http://localhost:16686
#   Langfuse:       http://localhost:3002
```

### 7.2 本地完整版（10分钟启动，含可观测性）

```bash
# 启动全部服务（含监控、Dify、本地LLM）
make up-all

# 下载本地模型（可选）
docker exec -it ollama ollama pull llama3

# 运行Demo工作流
curl -X POST http://localhost:8000/api/v1/workflows/demo/execute \
  -H "Content-Type: application/json" \
  -d '{"input": "Hello Agent Platform"}'
```

### 7.3 云上生产部署

```bash
# 前置要求
# - K8s 1.28+ 集群
# - kubectl + helm 3.12+
# - cert-manager（TLS自动签发）
# - External Secrets Operator（密钥管理）

# 1. 创建命名空间
kubectl create namespace agent-platform
kubectl create namespace agent-platform-data

# 2. 配置密钥（通过ExternalSecrets或手动）
kubectl create secret generic llm-secrets \
  --from-literal=openai-api-key=$OPENAI_API_KEY \
  --from-literal=anthropic-api-key=$ANTHROPIC_API_KEY \
  -n agent-platform

# 3. 部署
helm upgrade --install agent-platform ./helm/agent-platform \
  -n agent-platform \
  -f helm/agent-platform/values-production.yaml \
  --wait --timeout 600s

# 4. 验证
kubectl get pods -n agent-platform
kubectl get ingress -n agent-platform

# 5. 获取访问地址
export API_URL=$(kubectl get ingress api-gateway -n agent-platform -o jsonpath='{.spec.rules[0].host}')
echo "API Gateway: https://$API_URL"
```

---

## 8. 附录：Compose vs K8s 对照表

| 能力 | Docker Compose（本地） | Kubernetes（云上） | 统一策略 |
|------|------------------------|-------------------|----------|
| **服务编排** | `docker-compose.yml` | Helm Chart / Raw YAML | 同一镜像，不同编排文件 |
| **服务发现** | Compose DNS | CoreDNS | 应用通过环境变量获取地址 |
| **负载均衡** | 无（单实例） | Service + Ingress | api-gateway统一入口 |
| **自动扩缩容** | 不支持 | HPA + VPA | 本地手动，云上自动 |
| **配置管理** | `.env` + Volume | ConfigMap + Secret | 统一YAML模板，不同渲染方式 |
| **密钥管理** | Docker Secrets | External Secrets + Vault | 应用统一从文件读取 |
| **持久化存储** | Named Volume | PVC + StorageClass | 应用抽象存储接口 |
| **网络隔离** | 单一Bridge网络 | NetworkPolicy | 生产启用，本地宽松 |
| **健康检查** | `healthcheck` | `liveness/readiness` Probe | 统一/health端点 |
| **日志收集** | `docker logs` | Fluent Bit + Loki/ES | 统一stdout输出 |
| **监控告警** | Prometheus本地 | kube-prometheus-stack | 统一指标端点 |
| **发布策略** | 重启容器 | RollingUpdate / Canary | 本地Blue/Green手动，云上Argo Rollouts |
| **成本优化** | 本地资源 | Spot实例 + Karpenter | 云上sentinel-agent自动优化 |

---

*本文档确保同一套代码、同一组镜像，通过不同的编排层（Compose vs K8s）支撑从本地开发到云上生产的全生命周期。*
