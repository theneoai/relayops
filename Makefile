# Agent Platform MVP — Makefile
.PHONY: init up up-all down status health logs demo clean build

# 默认Compose文件
COMPOSE := docker compose

# ── 初始化 ──
init:
	@echo "🔧 Initializing Agent Platform MVP..."
	@bash scripts/init.sh

# ── 启动核心服务（不含Ollama和Grafana）──
up:
	$(COMPOSE) up -d
	@echo "🚀 Starting core services..."
	@sleep 3
	@$(MAKE) health

# ── 启动完整版（含Ollama本地LLM + Grafana）──
up-all:
	$(COMPOSE) --profile local-llm --profile observability up -d
	@echo "🚀 Starting full stack with Ollama and Grafana..."
	@sleep 5
	@$(MAKE) health
	@echo ""
	@echo "📊 Grafana: http://localhost:3001 (admin / $$(grep GRAFANA_PASSWORD .env | cut -d= -f2 || echo admin))"

# ── 停止 ──
down:
	$(COMPOSE) --profile local-llm --profile observability down

# ── 完全清理（含数据卷）──
clean:
	$(COMPOSE) --profile local-llm --profile observability down -v
	@docker volume prune -f

# ── 查看状态 ──
status:
	@echo "📦 Container Status:"
	@docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

# ── 健康检查 ──
health:
	@echo "🏥 Health Check:"
	@for svc in api-gateway devkit-api orchestrator litellm tool-service mcp-server flowise langfuse windmill postgres redis; do \
	  container=$$(docker compose ps -q $$svc 2>/dev/null); \
	  if [ -n "$$container" ]; then \
	    status=$$(docker inspect --format='{{.State.Health.Status}}' $$container 2>/dev/null || echo "unknown"); \
	    printf "  %-20s %s\n" "$$svc:" "$$status"; \
	  else \
	    printf "  %-20s %s\n" "$$svc:" "not running"; \
	  fi \
	done

# ── 查看日志 ──
logs:
	$(COMPOSE) logs -f --tail=100

# ── Flowise 专用命令 ──
flowise-up:
	$(COMPOSE) up -d flowise
	@echo "🎨 Flowise UI starting at http://localhost:3000"
	@echo "   Username: $$(grep FLOWISE_USERNAME .env 2>/dev/null | cut -d= -f2 || echo admin)"
	@echo "   Password: $$(grep FLOWISE_PASSWORD .env 2>/dev/null | cut -d= -f2 || echo changeme)"

flowise-logs:
	$(COMPOSE) logs -f flowise

# ── 构建镜像 ──
build:
	$(COMPOSE) build

# ── 快速Demo ──
demo:
	@echo ""
	@echo "🎯 Running MVP Demo..."
	@echo ""
	@echo "Step 1/4: Register example agent"
	@curl -s -X POST http://localhost:8000/api/v1/agents \
	  -H "Content-Type: application/json" \
	  -d @examples/agents/customer-service.json > /tmp/demo_register.json && \
	  echo "✅ Agent registered:" && cat /tmp/demo_register.json | head -c 500 && echo "..."
	@echo ""
	@echo "Step 2/4: List registered agents"
	@curl -s http://localhost:8000/api/v1/agents | head -c 500 && echo "..."
	@echo ""
	@echo "Step 3/4: Execute agent (query intent)"
	@curl -s -X POST http://localhost:8000/api/v1/agents/customer-service/execute \
	  -H "Content-Type: application/json" \
	  -d '{"input": "你好，我想查询订单"}' | tee /tmp/demo_execute.json | head -c 1000
	@echo ""
	@echo ""
	@echo "Step 4/4: Check execution status"
	@execution_id=$$(cat /tmp/demo_execute.json | grep -o '"execution_id":"[^"]*"' | cut -d'"' -f4); \
	if [ -n "$$execution_id" ]; then \
	  echo "Execution ID: $$execution_id"; \
	  curl -s "http://localhost:8000/api/v1/executions/$$execution_id" | head -c 800; \
	fi
	@echo ""
	@echo ""
	@echo "🎉 Demo complete!"
	@echo ""
	@echo "🎨 Flowise UI:    http://localhost:3000"
	@echo "📊 Langfuse:      http://localhost:3002"
	@echo "⚙️  Windmill:      http://localhost:8001"
	@echo "🔌 API Gateway:   http://localhost:8000"

# ── 拉取Ollama模型 ──
pull-model:
	@echo "📥 Pulling Ollama model (llama3.2)..."
	@docker exec -it relayops-ollama ollama pull llama3.2 || echo "Ollama not running, start with: make up-all"

# ── 测试各服务 ──
test-gateway:
	@curl -s http://localhost:8000/health | jq .

test-devkit:
	@curl -s http://localhost:8080/health | jq .

test-orchestrator:
	@curl -s http://localhost:8081/health | jq .

test-litellm:
	@curl -s http://localhost:4000/health | jq .

test-tools:
	@curl -s http://localhost:8083/health | jq .

test-mcp:
	@curl -s http://localhost:8084/health | jq .

test-ollama:
	@curl -s http://localhost:11434/api/tags | jq '.models[].name' 2>/dev/null || echo "Ollama not available"
