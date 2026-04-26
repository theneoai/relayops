# Agent Workflow平台：用户指南 & 运维手册 & 架构分层详解

> **版本**: v1.0  
> **日期**: 2026-04-25  
> **读者**: 终端用户 / 运维工程师 / 架构师  

---

## 目录

1. [第一部分：用户怎么使用工作流](#第一部分用户怎么使用工作流)
2. [第二部分：运维怎么部署和维护](#第二部分运维怎么部署和维护)
3. [第三部分：各层的作用和分工](#第三部分各层的作用和分工)

---

## 第一部分：用户怎么使用工作流

### 1.1 平台面向的三类用户

```
┌─────────────────────────────────────────────────────────────────────┐
│                        用户角色全景                                   │
├─────────────────┬─────────────────┬─────────────────────────────────┤
│   业务运营者      │   AI应用开发者   │        平台工程师               │
│  (Business Ops)  │  (AI Developer) │      (Platform Engineer)        │
├─────────────────┼─────────────────┼─────────────────────────────────┤
│ • 使用现成Agent  │ • 开发新Agent   │ • 管理基础设施                  │
│ • 配置业务规则   │ • 编排Workflow  │ • 监控平台健康                  │
│ • 查看数据报表   │ • 对接外部系统  │ • 容量规划                      │
│ • 审批关键操作   │ • 调试Prompt    │ • 安全合规                      │
├─────────────────┼─────────────────┼─────────────────────────────────┤
│ 主要界面:        │ 主要界面:        │ 主要界面:                       │
│ Dify UI / 聊天   │ Web IDE / CLI   │ K8s Dashboard / Grafana        │
│ 机器人 / 报表    │ / VS Code插件   │ / 运维控制台                    │
└─────────────────┴─────────────────┴─────────────────────────────────┘
```

### 1.2 业务运营者使用场景：一句话启动工作流

#### 场景A：智能客服机器人

```
┌─────────────────────────────────────────────────────────────────────┐
│  用户（客服主管）操作步骤                                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Step 1: 打开平台 → 进入「应用市场」                                  │
│          ┌─────────────────────────────────────────┐               │
│          │  📚 应用市场                              │               │
│          │  ┌─────────┐ ┌─────────┐ ┌─────────┐   │               │
│          │  │智能客服  │ │代码审查  │ │内容创作  │   │               │
│          │  │  🤖    │ │  💻    │ │  ✍️    │   │               │
│          │  │[一键部署]│ │[一键部署]│ │[一键部署]│   │               │
│          │  └─────────┘ └─────────┘ └─────────┘   │               │
│          └─────────────────────────────────────────┘               │
│                                                                     │
│  Step 2: 点击「智能客服」→ 「一键部署」                               │
│          → 系统自动完成：                                             │
│            • 创建Agent实例                                           │
│            • 绑定知识库（上传FAQ文档）                                 │
│            • 配置微信公众号/钉钉/飞书接入                              │
│            • 启用Guardrails内容过滤                                  │
│                                                                     │
│  Step 3: 上传企业知识库文档（PDF/Word/网页）                           │
│          → 系统自动：                                                │
│            • 文档解析 → 分块 → 向量化 → 存入Milvus                    │
│            • 建立索引（约2-5分钟，取决于文档量）                        │
│                                                                     │
│  Step 4: 配置业务规则（可视化界面，无需代码）                           │
│          ┌─────────────────────────────────────────┐               │
│          │  客服Agent配置                           │               │
│          │  ─────────────────────────────────────  │               │
│          │  工作时间:  7×24小时                     │               │
│          │  转人工条件: 情绪负面 > 0.8              │               │
│          │            或 涉及退款 > ¥1000           │               │
│          │            或 连续3轮未解决              │               │
│          │  知识库:   ✅ 产品FAQ  ✅ 售后政策        │               │
│          │  禁用词:   政治/暴力/歧视                │               │
│          │  ─────────────────────────────────────  │               │
│          │  [💾 保存配置]  [▶️ 启动服务]            │               │
│          └─────────────────────────────────────────┘               │
│                                                                     │
│  Step 5: 启动服务 → 获得接入二维码/ webhook地址                       │
│          → 客户开始咨询，Agent自动应答                                │
│                                                                     │
│  Step 6: 日常运营                                                    │
│          • 查看对话记录和满意度报表                                    │
│          • 处理Agent标记的「需人工介入」会话                            │
│          • 根据反馈优化知识库（上传新文档/修正答案）                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 场景B：自动化内容创作流水线

```yaml
# 用户视角：这是一个配置好的Workflow模板
# 用户只需要改几个参数，不用关心底层实现

workflow: "weekly-newsletter"
name: "每周产品通讯"

# 用户配置（业务运营者填写）
inputs:
  topic: "AI产品本周更新"           # ← 用户填主题
  style: "轻松活泼"                  # ← 用户选风格
  target_audience: "企业客户"        # ← 用户选受众
  channels:                        # ← 用户勾选发布渠道
    - wechat_official              #    ✅ 微信公众号
    - feishu_group                 #    ✅ 飞书群
    # - dingtalk                  #    ⬜ 钉钉（未勾选）

# 系统自动执行的工作流（用户可见进度条）
steps:
  1. 抓取数据源:       "从产品数据库提取本周更新"     [░░░░░░░░░░] 0%
  2. 生成文章大纲:     "AI生成5个章节大纲"            [████████░░] 80%
  3. 撰写正文:         "生成1500字产品通讯"           [░░░░░░░░░░] 等待中
  4. 生成配图:         "AI生成封面图+3张插图"         [░░░░░░░░░░] 等待中
  5. 人工审核:         "发送给@张经理审核"            [░░░░░░░░░░] 等待中
  6. 发布到微信公众号:  "自动排版+定时发布"            [░░░░░░░░░░] 等待中
  7. 发布到飞书群:     "自动@全体成员推送"            [░░░░░░░░░░] 等待中
  8. 生成数据报告:     "统计阅读量/转发量"            [░░░░░░░░░░] 等待中

# 用户操作按钮
actions:
  - "⏸️ 暂停"      # 任何步骤可暂停
  - "👤 立即人工审核" # 跳过等待，立即进入审核
  - "❌ 取消"       # 终止整个工作流
```

### 1.3 AI应用开发者使用场景：代码驱动开发

#### 场景C：从零开发一个财务对账Agent

```bash
# 开发者小张需要开发一个自动对账Agent
# 他的工作流程：

# Step 1: 打开终端，使用DevKit CLI创建Agent
agent-platform-cli create agent finance-reconciliation \
  --template financial \
  --description "自动从ERP和银行系统抓取数据，执行对账，生成差异报告"

# → 系统自动生成脚手架：
#   agents/finance-reconciliation/
#   ├── agent.yml           # Agent定义（模型/工具/提示词）
#   ├── workflow.yml        # 对账流程定义
#   ├── tools/
#   │   ├── erp-connector.yml    # ERP系统API
#   │   └── bank-api.yml         # 银行API
#   ├── prompts/
#   │   ├── system.md            # 系统提示词
#   │   └── reconciliation.md    # 对账逻辑提示词
#   └── tests/
#       └── reconciliation.spec.yml  # 测试用例

# Step 2: 编辑Agent定义（YAML声明式）
cat > agents/finance-reconciliation/agent.yml << 'EOF'
apiVersion: agent.platform/v1
kind: Agent
metadata:
  name: finance-reconciliation
  version: "1.0.0"
  author: zhangsan@company.com
  labels:
    - finance
    - reconciliation
    - automated

spec:
  # 模型配置
  model:
    provider: openai
    name: gpt-4o
    temperature: 0.2      # 财务场景低温度，确定性高
    max_tokens: 4000

  # 系统提示词（引用外部文件）
  system_prompt: |
    你是一名资深财务对账专家。你的任务是：
    1. 从ERP系统读取当期应收数据
    2. 从银行系统读取实际到账数据
    3. 执行三方对账（订单-发票-银行流水）
    4. 识别差异项并分类（时间差/金额差/遗漏/重复）
    5. 生成对账报告，标记需人工复核项
    
    规则：
    - 金额差异>¥1000必须人工复核
    - 未匹配项>5%必须人工复核
    - 不得修改原始数据，只能标记和建议

  # 工具绑定（MCP协议）
  tools:
    - ref: mcp-erp.query_receivables
      alias: query_erp
      description: "查询ERP应收数据"
      
    - ref: mcp-bank.query_transactions
      alias: query_bank
      description: "查询银行交易流水"
      
    - ref: mcp-email.send_report
      alias: send_email
      description: "发送对账报告邮件"

  # 记忆配置
  memory:
    type: conversation
    window_size: 20
    knowledge_bases:
      - ref: finance-policies
        top_k: 3

  # 安全护栏
  guardrails:
    - type: pii_filter
      config:
        mask_fields: [bank_account, id_card]
    - type: content_filter
      config:
        blocked_categories: [financial_advice]  # 禁止给出投资建议
    - type: output_validator
      config:
        schema: "schemas/reconciliation-report.json"
        required_fields: [matched_amount, unmatched_items, risk_flags]

  # 人工介入配置
  human_in_the_loop:
    triggers:
      - condition: "difference_amount > 1000"
        action: pause_and_notify
        approvers: ["finance-manager@company.com"]
        timeout: 24h
      - condition: "unmatched_rate > 0.05"
        action: pause_and_notify
        approvers: ["finance-manager@company.com"]
        timeout: 24h
    
  # 调度配置（定时执行）
  schedule:
    cron: "0 9 * * 1"    # 每周一早9点自动执行
    timezone: "Asia/Shanghai"
EOF

# Step 3: 本地测试（模拟运行，不调用真实API）
agent-platform-cli test finance-reconciliation \
  --mock-all \
  --input "{""month"": ""2026-03"", ""company_id"": ""ENT-001""}"

# → 输出：
# [TEST] 加载Agent: finance-reconciliation v1.0.0
# [TEST] 模拟ERP查询:  receivables=¥1,234,567.89 (mock)
# [TEST] 模拟银行查询: transactions=¥1,230,000.00 (mock)
# [TEST] 执行对账逻辑...
# [TEST] 结果: 差异¥4,567.89, 未匹配项3个, 风险等级: LOW
# [TEST] 输出验证: ✅ 通过 (所有必填字段存在)
# [TEST] HITL检查: ✅ 无需人工介入 (差异<¥1000)
# [TEST] 总耗时: 2.3s
# [TEST] 预估成本: $0.004 (OpenAI GPT-4o)
# 
# ✅ 测试通过 (5/5 assertions passed)

# Step 4: 部署到预发布环境
agent-platform-cli deploy finance-reconciliation \
  --env staging \
  --dry-run          # 先预览变更

agent-platform-cli deploy finance-reconciliation \
  --env staging      # 正式部署

# → 系统自动：
#   • 编译YAML → 平台内部格式
#   • 注册到Agent Registry
#   • 绑定工具权限
#   • 创建定时任务（CronJob）
#   • 启动健康检查

# Step 5: 预发布验证
agent-platform-cli run finance-reconciliation \
  --env staging \
  --input "{""month"": ""2026-03"", ""company_id"": ""ENT-001""}"

# Step 6: 生产发布（经过审批）
agent-platform-cli deploy finance-reconciliation \
  --env production \
  --require-approval    # 触发审批流程

# → 通知 finance-manager@company.com 审批
# → 审批通过后自动金丝雀发布（5% → 25% → 100%）
```

### 1.4 用户工作流的完整生命周期

```
┌─────────────────────────────────────────────────────────────────────┐
│                    用户工作流生命周期（从0到生产）                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  【构思阶段】                                                         │
│  用户: "我们需要一个自动处理客户退款的Agent"                           │
│       │                                                            │
│       ▼                                                            │
│  ┌─────────────────────────────────────────┐                       │
│  │ Agent Architect（架构师Agent）           │                       │
│  │ • 分析需求 → 推荐Workflow模式            │                       │
│  │ • 选择模型 → 推荐GPT-4o（需要推理能力）   │                       │
│  │ • 识别工具 → 需要ERP+支付+邮件系统       │                       │
│  │ • 评估风险 → 涉及资金，必须HITL          │                       │
│  └─────────────────────────────────────────┘                       │
│       │                                                            │
│       ▼                                                            │
│  【开发阶段】                                                         │
│  开发者使用CLI/Web IDE创建Agent                                       │
│  → YAML定义 + 提示词工程 + 工具对接                                   │
│  → 本地Mock测试（零成本）                                             │
│  → 迭代优化（Prompt版本对比）                                         │
│       │                                                            │
│       ▼                                                            │
│  【验证阶段】                                                         │
│  ┌─────────────────────────────────────────┐                       │
│  │ 自动化测试矩阵                           │                       │
│  │ • 单元测试: 单个节点逻辑验证             │                       │
│  │ • 集成测试: 工具调用链路验证             │                       │
│  │ • 混沌测试: 模拟工具超时/异常返回        │                       │
│  │ • 安全测试: Prompt注入/PII泄露检测       │                       │
│  │ • 成本测试: Token用量是否符合预期        │                       │
│  └─────────────────────────────────────────┘                       │
│       │                                                            │
│       ▼                                                            │
│  【部署阶段】                                                         │
│  → 提交代码 → Git触发CI/CD                                           │
│  → 构建镜像 → 安全扫描 → 推送到仓库                                   │
│  → 预发布部署 → 冒烟测试 → 负载测试                                   │
│  → 生产审批 → 金丝雀发布（自动/人工）                                  │
│       │                                                            │
│       ▼                                                            │
│  【运行阶段】                                                         │
│  ┌─────────────────────────────────────────┐                       │
│  │ 生产环境运行                             │                       │
│  │ • 7×24执行定时任务或事件触发             │                       │
│  │ • 实时监控：延迟/P99/错误率/Token成本     │                       │
│  │ • 自动告警：异常时通知开发者+业务方       │                       │
│  │ • HITL介入：高风险操作暂停等待审批        │                       │
│  └─────────────────────────────────────────┘                       │
│       │                                                            │
│       ▼                                                            │
│  【优化阶段】                                                         │
│  → 查看Langfuse追踪 → 识别瓶颈节点                                   │
│  → A/B测试不同Prompt版本 → 选择效果更好的                              │
│  → 收集业务反馈 → 迭代Agent配置                                       │
│  → 版本升级 → 重复部署流程                                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 第二部分：运维怎么部署和维护

### 2.1 运维团队的分工

```
┌─────────────────────────────────────────────────────────────────────┐
│                      运维团队分工模型                                  │
├──────────────────┬──────────────────┬────────────────────────────────┤
│   SRE (平台运维)  │   DevOps (发布)   │      SecOps (安全)             │
├──────────────────┼──────────────────┼────────────────────────────────┤
│ • K8s集群管理     │ • CI/CD流水线     │ • 密钥管理 (Vault)             │
│ • 容量规划       │ • 镜像构建/签名   │ • 安全扫描 (SAST/DAST)         │
│ • 监控告警       │ • 金丝雀发布     │ • 合规审计                     │
│ • 故障响应       │ • 配置管理       │ • 入侵检测                     │
│ • 成本优化       │ • GitOps同步     │ • 漏洞响应                     │
├──────────────────┼──────────────────┼────────────────────────────────┤
│ 工具:            │ 工具:            │ 工具:                          │
│ Prometheus/Grafana│ ArgoCD/GitHub   │ Falco/OPA/Vault                │
│ K9s/kubectl      │ Actions         │ Trivy/Checkov                  │
└──────────────────┴──────────────────┴────────────────────────────────┘
```

### 2.2 部署流程：从代码到生产

#### 第一步：环境准备（一次性）

```bash
# SRE操作

# 1. 准备K8s集群
export ENV=production
 eksctl create cluster \
   --name agent-platform-${ENV} \
   --region ap-southeast-1 \
   --node-type m6i.2xlarge \
   --nodes-min 3 --nodes-max 20

# 2. 安装核心运维组件
helm repo add jetstack https://charts.jetstack.io
helm repo add external-secrets https://charts.external-secrets.io
helm repo update

# 安装cert-manager（自动TLS证书）
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set installCRDs=true

# 安装External Secrets（对接云密钥管理服务）
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets --create-namespace

# 安装Ingress-NGINX
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace

# 3. 配置密钥（生产环境）
# 在AWS Secrets Manager中创建:
#   /agent-platform/production/openai-api-key
#   /agent-platform/production/postgres-password
#   /agent-platform/production/jwt-private-key

# 4. 创建ExternalSecret映射
kubectl apply -f - <<EOF
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: aws-secrets-manager
spec:
  provider:
    aws:
      service: SecretsManager
      region: ap-southeast-1
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets-sa
            namespace: external-secrets
---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: agent-platform-secrets
  namespace: agent-platform
spec:
  refreshInterval: 1h
  secretStoreRef:
    kind: ClusterSecretStore
    name: aws-secrets-manager
  target:
    name: agent-platform-secrets
    creationPolicy: Owner
  data:
    - secretKey: openai-api-key
      remoteRef:
        key: /agent-platform/production/openai-api-key
    - secretKey: postgres-password
      remoteRef:
        key: /agent-platform/production/postgres-password
EOF
```

#### 第二步：日常部署（每次发布）

```bash
# DevOps操作

# 1. 开发者提交代码 → 触发GitHub Actions
# .github/workflows/deploy.yml 自动执行：

┌─────────────────────────────────────────────────────────────────────┐
│  CI/CD流水线（全自动）                                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Stage 1: 代码质量                                                   │
│  ├── Lint & Format    ✅ 通过                                       │
│  ├── 单元测试         ✅ 覆盖率82% (>80%门槛)                        │
│  ├── 秘密扫描         ✅ 未发现泄露                                 │
│  └── 依赖漏洞扫描     ✅ 0高危                                      │
│                                                                     │
│  Stage 2: 构建制品                                                   │
│  ├── 多架构镜像构建   ✅ amd64 + arm64                              │
│  ├── SBOM生成         ✅ SPDX-JSON                                  │
│  ├── 镜像签名         ✅ Cosign + 密钥                              │
│  └── 推送到仓库       ✅ ghcr.io/enterprise/...:v1.2.3              │
│                                                                     │
│  Stage 3: 安全扫描                                                   │
│  ├── SAST (CodeQL)    ✅ 0高危                                      │
│  ├── 容器扫描 (Trivy) ✅ 0可修复漏洞                                │
│  └── IaC扫描 (Checkov)✅ 0违规                                      │
│                                                                     │
│  Stage 4: 预发布部署                                                 │
│  ├── Helm部署到Staging ✅                                           │
│  ├── 冒烟测试         ✅ API全通                                    │
│  ├── 负载测试(k6)     ✅ P99=320ms (<500ms门槛)                     │
│  └── 混沌测试         ✅ 单Pod杀，自动恢复<30s                       │
│                                                                     │
│  Stage 5: 生产发布（需审批）                                          │
│  ├── 创建发布工单     ✅ 通知 @sre-oncall                            │
│  ├── 人工审批         ✅ @sre-lead 已批准                            │
│  ├── 金丝雀发布       🔄 5% → 25% → 50% → 100%                     │
│  │   Argo Rollouts自动监控指标，异常自动回滚                         │
│  └── 发布后验证       ✅ synthetic monitor全绿                      │
│                                                                     │
│  ✅ 发布完成 v1.2.3 → production                                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

# 2. 人工确认（仅高危变更）
# 在ArgoCD界面点击「Sync」或Slack中点击「Approve」

# 3. 验证生产状态
kubectl argo rollouts status agent-platform-api-gateway -n agent-platform
# Expected: Healthy
```

#### 第三步：日常维护操作手册

```bash
# ==================== 运维日常命令速查 ====================

# ── 查看整体健康 ──
make k8s-status                    # 自定义脚本，聚合所有服务状态
# 输出示例：
# SERVICE          PODS    READY    CPU    MEM    STATUS
# api-gateway      3/3     100%     45%    60%    ✅ Healthy
# orchestrator     3/3     100%     62%    78%    ✅ Healthy
# llm-gateway      3/3     100%     30%    45%    ✅ Healthy
# sentinel         2/2     100%     25%    40%    ✅ Healthy
# postgresql-ha    3/3     100%     15%    55%    ✅ Healthy (Leader: pod-0)

# ── 查看日志 ──
# 单个服务
kubectl logs -n agent-platform -l app=api-gateway --tail=500 -f

# 全平台聚合（使用Stern）
stern -n agent-platform 'api-gateway|orchestrator|llm-gateway' --tail=100

# 错误日志聚合（使用Loki）
# 在Grafana中查询：
# {namespace="agent-platform"} |= "ERROR" | json | line_format "{{.service}}: {{.message}}"

# ── 扩容操作 ──
# 手动扩容（应对突发流量）
kubectl scale deployment api-gateway --replicas=10 -n agent-platform

# 调整HPA上下限
kubectl patch hpa api-gateway -n agent-platform --type='json' \
  -p='[{"op": "replace", "path": "/spec/maxReplicas", "value":20}]'

# ── 故障排查 ──
# 1. Pod启动失败
kubectl describe pod -n agent-platform -l app=orchestrator
kubectl get events -n agent-platform --sort-by='.lastTimestamp' | tail -20

# 2. 服务间调用失败
# 检查服务发现
kubectl get svc -n agent-platform
# 检查网络策略
kubectl get networkpolicy -n agent-platform

# 3. 数据库性能问题
# 连接池监控
kubectl exec -n agent-platform-data postgresql-ha-0 -- \
  psql -U postgres -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"

# 4. LLM调用异常
# 查看Langfuse追踪
open https://langfuse.aidevops.example.com
# 搜索：trace_id=xxx 或 错误类型=timeout/rate_limit

# ── 备份操作 ──
# 数据库备份
kubectl create job -n agent-platform-data manual-backup-$(date +%s) \
  --from=cronjob/postgresql-backup

# 对象存储备份（跨区域复制已自动启用，此为手动触发）
mc mirror s3/agent-platform-primary s3/agent-platform-dr

# ── 密钥轮换 ──
# 1. 在Vault/AWS Secrets Manager中更新密钥
# 2. 触发ExternalSecret刷新
kubectl annotate externalsecret agent-platform-secrets -n agent-platform \
  force-sync=$(date +%s)
# 3. 滚动重启应用
kubectl rollout restart deployment -n agent-platform

# ── 混沌工程（每月执行） ──
# 杀死一个api-gateway Pod，验证自愈
kubectl delete pod -n agent-platform -l app=api-gateway --grace-period=0
# 预期：HPA在30秒内创建新Pod，Ingress自动摘除故障端点，总影响<5s

# 模拟网络分区
# 使用Litmus Chaos
kubectl apply -f chaos/network-partition-orchestrator.yaml
# 预期：sentinel检测到orchestrator失联，触发告警，workflow任务自动转移到备用节点

# ── 成本报告 ──
# 生成上月资源使用报告
kubectl cost --historical --window=monthly -n agent-platform
# 输出示例：
# NAMESPACE        CPU($)    MEM($)    STORAGE($)    TOTAL($)
# agent-platform   $1,234    $567      $89           $1,890
```

### 2.3 故障响应SOP（标准操作流程）

```
┌─────────────────────────────────────────────────────────────────────┐
│                    P1故障响应流程（生产不可用）                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  T+0min  [告警触发]                                                  │
│  ├── Prometheus Alertmanager → Slack #incidents + PagerDuty页面      │
│  └── Sentinel自动诊断启动                                            │
│                                                                     │
│  T+1min  [自动诊断]                                                  │
│  ├── Sentinel查询：最近5分钟内的异常指标                              │
│  ├── 关联分析：是否伴随发布/配置变更？                                 │
│  └── 根因定位：api-gateway Pod OOMKilled（内存溢出）                  │
│                                                                     │
│  T+2min  [自动修复尝试]                                               │
│  ├── 策略：内存溢出 → 自动扩容内存限制 + 滚动重启                     │
│  ├── 执行：kubectl patch deployment api-gateway ...                   │
│  └── 监控：观察新Pod启动状态                                          │
│                                                                     │
│  T+3min  [验证恢复]                                                  │
│  ├── 健康检查：/health 返回200                                        │
│  ├── 业务验证：synthetic monitor通过                                  │
│  └── 关闭告警                                                        │
│                                                                     │
│  T+5min  [通知与记录]                                                │
│  ├── Slack通知："P1故障已自动修复：api-gateway OOM，已扩容重启"        │
│  └── 生成Post-Mortem草稿：时间线、根因、修复动作                      │
│                                                                     │
│  T+24h   [复盘优化]                                                  │
│  └── SRE团队审查：为什么内存会溢出？是否需要调整默认资源限制？          │
│      → 更新Helm values-production.yaml默认值                          │
│      → 提交PR → 合并 → 自动部署                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 第三部分：各层的作用和分工

### 3.1 七层架构全景

```
用户视角
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 7: 体验层 (Experience)                                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐│
│  │   Web IDE   │  │   CLI工具   │  │   ChatOps   │  │   开放API   ││
│  │  (React)    │  │  (Go/TS)   │  │(Slack/钉钉) │  │  (GraphQL)  ││
│  │             │  │             │  │             │  │             ││
│  │ • 可视化编排 │  │ • devkit-cli│  │ • @Agent    │  │ • 第三方集成 ││
│  │ • 拖拽Workflow│ │ • 本地测试  │  │   触发工作流 │  │ • Webhook   ││
│  │ • 实时监控板 │  │ • Git集成   │  │ • 审批通知   │  │ • SDK       ││
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘│
├─────────────────────────────────────────────────────────────────────┤
│  Layer 6: 接入层 (Gateway)                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  API Gateway (Kong/Envoy)                                    │   │
│  │  • 统一入口: 所有流量经过此处                                  │   │
│  │  • 认证鉴权: JWT验证 + RBAC权限检查                            │   │
│  │  • 流量治理: 限流/熔断/重试/超时                               │   │
│  │  • 路由分发: /api/v1/agents → devkit-api:8080                │   │
│  │  • 灰度控制: 按Header/Cookie/百分比路由到不同版本               │   │
│  │  • 日志记录: 全量请求日志 → Kafka → 审计                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 5: 应用层 (Application)                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐│
│  │  DevKit API │  │Orchestrator │  │  LLM Gateway│  │  Tool Svc   ││
│  │  开发者服务  │  │  编排中枢    │  │  模型路由   │  │  工具服务   ││
│  │             │  │             │  │             │  │             ││
│  │ 职责:       │  │ 职责:       │  │ 职责:       │  │ 职责:       ││
│  │ • Agent CRUD│  │ • 工作流执行 │  │ • 多模型接入 │  │ • API工具托管││
│  │ • YAML编译  │  │ • 状态机管理 │  │ • Fallback  │  │ • PII过滤   ││
│  │ • 版本管理  │  │ • 定时调度  │  │ • 成本追踪  │  │ • 权限控制   ││
│  │ • GitOps触发│  │ • HITL协调  │  │ • 流式输出  │  │ • 速率限制   ││
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘│
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │   MCP Hub   │  │   Sentinel  │  │  Guardrail  │                 │
│  │ MCP注册中心  │  │  SRE哨兵    │  │  安全卫士   │                 │
│  │             │  │             │  │             │                 │
│  │ 职责:       │  │ 职责:       │  │ 职责:       │                 │
│  │ • Server注册│  │ • 监控采集  │  │ • 输入过滤  │                 │
│  │ • 健康检查  │  │ • 异常检测  │  │ • 输出审计  │                 │
│  │ • 动态发现  │  │ • 自动修复  │  │ • 合规检查  │                 │
│  │ • 负载均衡  │  │ • 告警通知  │  │ • 威胁阻断  │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘                 │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 4: 编排引擎层 (Orchestration Engine)                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  LangGraph State Machine + Temporal Durable Execution         │   │
│  │                                                              │   │
│  │  LangGraph: 负责「怎么做」—— 确定性的状态流转                   │   │
│  │  • 定义Workflow图结构（节点=步骤，边=条件）                    │   │
│  │  • 管理状态快照（每一步的中间结果）                            │   │
│  │  • 支持循环、分支、并行、人工介入断点                           │   │
│  │                                                              │   │
│  │  Temporal: 负责「可靠执行」—— 永不丢失的任务                    │   │
│  │  • 持久化工作流状态（崩溃后可恢复）                            │   │
│  │  • 定时任务调度（Cron/延迟/重复）                              │   │
│  │  • 子工作流编排（可组合复杂流程）                              │   │
│  │                                                              │   │
│  │  协作方式:                                                    │   │
│  │  LangGraph生成执行计划 → Temporal Worker执行 → 结果回写         │   │
│  └─────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 3: 智能层 (Intelligence)                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐│
│  │  LLM Router │  │   RAG引擎   │  │   记忆系统   │  │ 模型评估   ││
│  │  模型路由器  │  │  检索增强   │  │  上下文管理  │  │  A/B测试   ││
│  │             │  │             │  │             │  │             ││
│  │ 职责:       │  │ 职责:       │  │ 职责:       │  │ 职责:       ││
│  │ • 请求分发  │  │ • 文档解析  │  │ • 对话历史  │  │ • Prompt版本││
│  │ • 故障转移  │  │ • 向量索引  │  │ • 长期记忆  │  │   对比      ││
│  │ • 成本路由  │  │ • 混合检索  │  │ • 跨会话关联│  │ • 质量评分  ││
│  │ • Token统计 │  │ • 重排序    │  │ • 知识图谱  │  │ • 自动回滚  ││
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘│
├─────────────────────────────────────────────────────────────────────┤
│  Layer 2: 基础设施服务层 (Infrastructure Services)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐│
│  │ PostgreSQL  │  │    Redis    │  │    Kafka    │  │   Milvus    ││
│  │  关系数据库  │  │   缓存队列   │  │   事件总线   │  │   向量库     ││
│  │             │  │             │  │             │  │             ││
│  │ 存储:       │  │ 用途:       │  │ 用途:       │  │ 用途:       ││
│  │ • Agent定义 │  │ • 会话缓存  │  │ • 事件驱动  │  │ • 文档向量  ││
│  │ • 执行记录  │  │ • 限流计数  │  │ • 异步解耦  │  │ • 语义检索  ││
│  │ • 审计日志  │  │ • 分布式锁  │  │ • 流处理    │  │ • 相似度计算││
│  │ • 用户权限  │  │ • 状态共享  │  │ • 日志聚合  │  │             ││
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘│
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │    MinIO    │  │   Temporal  │  │   Vault     │                 │
│  │  对象存储    │  │  工作流引擎  │  │  密钥管理    │                 │
│  │             │  │             │  │             │                 │
│  │ 存储:       │  │ 用途:       │  │ 用途:       │                 │
│  │ • 文档文件  │  │ • 任务调度  │  │ • 密钥存储  │                 │
│  │ • 生成结果  │  │ • 状态持久化│  │ • 动态凭据  │                 │
│  │ • 模型Artifact│ │ • 超时管理  │  │ • 证书签发  │                 │
│  │ • 备份归档  │  │ • 重试补偿  │  │ • 访问审计  │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘                 │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 1: 基础设施层 (Infrastructure)                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐│
│  │ K8s Cluster │  │  Container  │  │   Network   │  │   Storage   ││
│  │  容器编排    │  │   Runtime   │  │    Mesh     │  │   Class     ││
│  │             │  │             │  │             │  │             ││
│  │ • Deployment│  │ • containerd│  │ • Istio     │  │ • EBS/gp3   ││
│  │ • StatefulSet│ │ • gVisor    │  │ • Cilium    │  │ • NFS/EFS   ││
│  │ • HPA/VPA   │  │  (沙箱)     │  │ • mTLS      │  │ • S3/OSS    ││
│  │ • NetworkPolicy│ • 镜像签名  │  │ • 流量镜像  │  │ • 快照备份  ││
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 每层详细分工与数据流

#### Layer 7 体验层：用户的「手和眼」

```
职责：让用户能方便地使用平台能力，不管用户是技术还是非技术背景

┌─────────────────────────────────────────────────────────────────────┐
│  Web IDE（面向开发者）                                                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  左侧: 文件树（Agent定义/Workflow/工具/测试）                  │   │
│  │  中间: YAML编辑器（语法高亮/Schema校验/自动补全）              │   │
│  │  右侧: 可视化画布（Workflow图实时渲染）                        │   │
│  │  底部: 终端（CLI命令/日志输出/调试信息）                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  技术实现: React + Monaco Editor + ReactFlow + WebSocket            │
├─────────────────────────────────────────────────────────────────────┤
│  CLI工具（面向高级开发者）                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  $ agent-platform-cli create agent my-agent                  │   │
│  │  $ agent-platform-cli test my-agent --mock-all               │   │
│  │  $ agent-platform-cli deploy my-agent --env production       │   │
│  │  $ agent-platform-cli logs my-agent --follow                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  技术实现: Go/TypeScript + Cobra/Commander + gRPC客户端              │
├─────────────────────────────────────────────────────────────────────┤
│  ChatOps（面向业务运营者）                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  用户在Slack输入:                                            │   │
│  │  @AgentPlatform 启动客服Agent                                 │   │
│  │  @AgentPlatform 本周对账报告                                  │   │
│  │  @AgentPlatform 批准发布 finance-reconciliation v1.2.3       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  技术实现: Slack Bot / 钉钉机器人 / 企业微信 → 调用平台API           │
├─────────────────────────────────────────────────────────────────────┤
│  开放API（面向第三方系统集成）                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  企业ERP系统调用:                                            │   │
│  │  POST /api/v1/agents/finance-reconciliation/execute         │   │
│  │  Header: Authorization: Bearer <token>                      │   │
│  │  Body: {"month": "2026-03", "company_id": "ENT-001"}        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  技术实现: GraphQL + REST + gRPC + OpenAPI Spec + SDK生成           │
└─────────────────────────────────────────────────────────────────────┘
```

#### Layer 6 接入层：流量的「海关和交警」

```
职责：所有外部流量必须经过这里，负责安全检查和流量调度

流入流量处理流程：
┌─────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ 客户端   │───→│  WAF防火墙   │───→│ JWT认证/RBAC │───→│  速率限制   │
│         │    │ • SQL注入过滤│    │ • Token校验  │    │ • 全局QPS   │
│         │    │ • XSS过滤   │    │ • 权限检查   │    │ • 用户级QPS │
│         │    │ • Bot检测   │    │ • 租户隔离   │    │ • 成本限额  │
└─────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                                                          │
                               ┌──────────────────────────┘
                               ▼
                    ┌─────────────────────┐
                    │    路由决策引擎      │
                    │ • /api/v1/agents/* → devkit-api    │
                    │ • /api/v1/workflows/* → orchestrator│
                    │ • /api/v1/llm/* → llm-gateway      │
                    │ • /api/v1/tools/* → tool-service   │
                    │ • /webhooks/* → event-processor    │
                    └─────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
              ┌─────────┐          ┌─────────┐
              │ 灰度路由 │          │ 版本路由 │
              │ 5%→v2   │          │ Header  │
              │ 95%→v1  │          │ x-version│
              └─────────┘          └─────────┘
```

**关键设计决策**：
- 为什么用Kong/Envoy而不是Nginx？→ 需要动态路由、插件生态（认证/限流/日志）、多协议支持
- 为什么所有流量统一入口？→ 集中安全策略、统一审计、简化客户端

#### Layer 5 应用层：业务的「手脚和大脑」

```
这一层是平台的核心，每个服务对应一个明确的业务域

┌─────────────────────────────────────────────────────────────────────┐
│  DevKit API（开发者服务域）                                           │
│  ─────────────────────────────────────────────────────────────────  │
│  输入: YAML/JSON 格式的Agent/Workflow定义                             │
│  处理:                                                               │
│    1. 解析YAML → AST（抽象语法树）                                    │
│    2. 语义校验 → 检查引用完整性/类型匹配                              │
│    3. 编译转换 → 生成平台内部执行格式                                  │
│    4. 版本管理 → Git存储 + 语义化版本                                 │
│    5. GitOps触发 → 推送变更到配置仓库                                  │
│  输出: 已注册的Agent定义，可被Orchestrator执行                         │
│  协作: 接收Layer 7的CLI/Web IDE请求，写入Layer 2的PostgreSQL           │
├─────────────────────────────────────────────────────────────────────┤
│  Orchestrator（编排执行域）                                           │
│  ─────────────────────────────────────────────────────────────────  │
│  输入: 执行命令（启动Workflow/Agent/定时任务）                          │
│  处理:                                                               │
│    1. 加载Workflow定义 → 构建执行图                                   │
│    2. 初始化状态 → 从Checkpoint恢复（如有）                           │
│    3. 逐步执行 → 调用LLM/工具/人工介入                                │
│    4. 状态持久化 → 每步完成后保存状态                                 │
│    5. 异常处理 → 重试/降级/人工介入                                   │
│  输出: 执行结果/中间状态/审计日志                                      │
│  协作: 调用LLM Gateway推理，调用Tool Service执行工具，发送事件到Kafka   │
├─────────────────────────────────────────────────────────────────────┤
│  LLM Gateway（模型路由域）                                            │
│  ─────────────────────────────────────────────────────────────────  │
│  输入: Prompt + 模型参数                                              │
│  处理:                                                               │
│    1. 路由选择 → 根据成本/延迟/质量策略选择Provider                    │
│    2. 请求封装 → 适配不同Provider的API格式                            │
│    3. 流式处理 → SSE/Chunked响应                                      │
│    4. Fallback → 主Provider失败时自动切换                             │
│    5. 成本记录 → Token用量 → Langfuse                                 │
│  输出: LLM响应 + 元数据（模型/Token/延迟/成本）                        │
│  协作: 接收Orchestrator请求，回写结果到Kafka                           │
├─────────────────────────────────────────────────────────────────────┤
│  Tool Service（工具执行域）                                           │
│  ─────────────────────────────────────────────────────────────────  │
│  输入: 工具调用请求（函数名+参数）                                     │
│  处理:                                                               │
│    1. 权限校验 → 检查调用者是否有权调用该工具                          │
│    2. PII检测 → 扫描参数中的敏感信息                                  │
│    3. 限流检查 → 防止工具被过度调用                                   │
│    4. 执行调用 → HTTP/API/DB操作                                      │
│    5. 结果脱敏 → 再次PII扫描后返回                                    │
│  输出: 工具执行结果                                                   │
│  协作: 被Orchestrator调用，调用外部API，记录审计日志                    │
├─────────────────────────────────────────────────────────────────────┤
│  MCP Hub（工具发现域）                                                │
│  ─────────────────────────────────────────────────────────────────  │
│  输入: MCP Server注册信息 / 工具发现请求                               │
│  处理:                                                               │
│    1. Server注册 → 验证MCP协议兼容性                                  │
│    2. 健康检查 → 定期Ping所有注册Server                               │
│    3. 工具发现 → 动态获取工具列表和Schema                              │
│    4. 负载均衡 → 多个实例时分发请求                                    │
│  输出: 可用工具目录                                                   │
│  协作: 被Tool Service和Orchestrator查询，管理MCP Server生命周期         │
├─────────────────────────────────────────────────────────────────────┤
│  Sentinel（运维智能域）                                               │
│  ─────────────────────────────────────────────────────────────────  │
│  输入: Prometheus指标 / Kafka事件 / 告警通知                           │
│  处理:                                                               │
│    1. 指标采集 → 拉取/推送Prometheus数据                              │
│    2. 异常检测 → 时序模型识别偏离正常模式                              │
│    3. 根因分析 → 关联变更/日志/追踪                                   │
│    4. 修复决策 → 评估自动修复风险                                      │
│    5. 执行修复 → 调用K8s API或发送命令                                │
│  输出: 告警通知 / 修复动作 / 报告                                     │
│  协作: 读取Layer 1的K8s API，发送通知到Slack，记录到PostgreSQL         │
├─────────────────────────────────────────────────────────────────────┤
│  Guardrail（安全治理域）                                              │
│  ─────────────────────────────────────────────────────────────────  │
│  输入: LLM请求/响应 / 文件上传                                        │
│  处理:                                                               │
│    1. 内容过滤 → 涉政/涉暴/歧视检测                                   │
│    2. Prompt注入检测 → 识别越狱/提示词攻击                             │
│    3. PII识别 → 身份证/银行卡/手机号脱敏                              │
│    4. 输出校验 → Schema校验/事实性检查                                │
│    5. 审计记录 → 完整输入输出不可变存储                                │
│  输出: 净化后的请求/响应 + 审计记录                                    │
│  协作: 被API Gateway调用（请求时），被Tool Service调用（响应时）        │
└─────────────────────────────────────────────────────────────────────┘
```

#### Layer 4 编排引擎层：执行的「骨架和肌肉」

```
为什么需要两个引擎？

LangGraph = 「指挥官」— 决定「做什么」和「顺序」
Temporal = 「工程兵」— 确保「不管发生什么，任务一定完成」

┌─────────────────────────────────────────────────────────────────────┐
│                    LangGraph: 状态机编排                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Workflow定义（以客服机器人为例）:                                    │
│                                                                     │
│      ┌─────────┐      ┌─────────┐      ┌─────────┐               │
│      │  Start  │─────→│ 理解意图 │─────→│ 检索知识 │               │
│      └─────────┘      └─────────┘      └────┬────┘               │
│                                               │                     │
│                    ┌──────────────────────────┘                     │
│                    │                                                 │
│                    ▼                                                 │
│              ┌─────────┐                                             │
│              │ 生成回答 │                                             │
│              └────┬────┘                                             │
│                   │                                                  │
│         ┌────────┴────────┐                                          │
│         │                 │                                          │
│    ┌────▼────┐      ┌────▼────┐                                     │
│    │ 满意度高 │      │ 满意度低 │                                     │
│    │ 直接结束 │      │ 转人工   │                                     │
│    └─────────┘      └─────────┘                                     │
│                                                                     │
│  LangGraph职责:                                                     │
│  • 构建上述有向图                                                    │
│  • 维护当前状态（用户在哪个节点）                                      │
│  • 处理条件分支（满意度>0.7?）                                        │
│  • 支持人工介入断点（在"转人工"前暂停）                                │
│  • 状态序列化（每步保存到Redis/DB）                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    Temporal: 持久化执行                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  场景：一个Workflow需要执行30分钟，中间可能：                          │
│    • 服务重启                                                        │
│    • 网络中断                                                        │
│    • LLM API超时                                                     │
│    • 需要等待人工审批（可能等几小时）                                  │
│                                                                     │
│  Temporal保证:                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Worker进程崩溃 → 新Worker自动接管，从上次状态继续           │   │
│  │  活动执行失败 → 按策略重试（指数退避，最多10次）              │   │
│  │  长时间等待 → 状态持久化到DB，不占内存                        │   │
│  │  定时任务 → Cron表达式精确调度，错过自动补偿                   │   │
│  │  子工作流 → 可组合复杂流程，独立失败不影响父流程               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Temporal架构:                                                      │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐                      │
│  │  Client │────→│  Server │←────│  Worker │                      │
│  │ (提交任务)│     │ (调度/持久化)│     │ (执行任务)│                      │
│  └─────────┘     └────┬────┘     └─────────┘                      │
│                       │                                            │
│                  ┌────▼────┐                                       │
│                  │PostgreSQL│  ← 所有状态持久化到这里               │
│                  │(可见性DB)│                                       │
│                  └─────────┘                                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

协作模式：
  LangGraph生成「执行计划图」→ 提交给Temporal Server
  Temporal调度Worker执行每个节点 → 调用Layer 5服务
  执行结果返回LangGraph → 决定下一个节点
```

#### Layer 3 智能层：思考的「大脑」

```
┌─────────────────────────────────────────────────────────────────────┐
│  LLM Router（模型路由）                                               │
├─────────────────────────────────────────────────────────────────────┤
│  为什么需要路由？不是直接调用OpenAI吗？                                 │
│                                                                     │
│  企业场景需要：                                                      │
│  • 成本控制: GPT-4做复杂推理，GPT-3.5做简单任务，本地模型做测试        │
│  • 高可用: OpenAI挂了自动切Anthropic，再挂切Azure，再挂用本地模型      │
│  • 数据主权: 敏感数据走本地模型，一般数据走云API                       │
│  • 合规要求: 某些行业必须用国产模型（通义/文心/DeepSeek）               │
│                                                                     │
│  路由策略示例：                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  if task.complexity == "high" and data.sensitivity == "low": │   │
│  │      provider = "openai/gpt-4o"  # 最强能力                   │   │
│  │  elif task.complexity == "low":                               │   │
│  │      provider = "openai/gpt-3.5-turbo"  # 成本优先            │   │
│  │  elif data.sensitivity == "high":                             │   │
│  │      provider = "local/llama3"  # 数据不出域                  │   │
│  │  else:                                                        │   │
│  │      provider = "deepseek-chat"  # 性价比优选                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  RAG引擎（检索增强生成）                                              │
├─────────────────────────────────────────────────────────────────────┤
│  处理流程：                                                          │
│  文档上传 → 解析(PDF/Word/HTML) → 分块(Chunk) → 向量化(Embedding)    │
│     → 存入Milvus → 检索时计算相似度 → 取Top-K → 拼接到Prompt         │
│                                                                     │
│  为什么不用简单关键词搜索？                                           │
│  • 用户问"怎么退款" → 文档写"退货流程" → 语义匹配而非字面匹配          │
│  • 支持跨语言（中文问，英文文档也能检索）                              │
│  • 理解同义词和上下文                                                 │
├─────────────────────────────────────────────────────────────────────┤
│  记忆系统（上下文管理）                                               │
├─────────────────────────────────────────────────────────────────────┤
│  三层记忆架构：                                                      │
│                                                                     │
│  工作记忆（Working Memory）                                          │
│  ├── 存储: Redis                                                    │
│  ├── 内容: 当前对话的最近N轮                                         │
│  └── 用途: 让Agent知道"用户刚才说了什么"                              │
│                                                                     │
│  长期记忆（Long-term Memory）                                        │
│  ├── 存储: PostgreSQL + Milvus                                      │
│  ├── 内容: 用户偏好、历史决策、业务知识                               │
│  └── 用途: "张总喜欢简洁的回答，不要啰嗦"                              │
│                                                                     │
│  情景记忆（Episodic Memory）                                         │
│  ├── 存储: PostgreSQL                                               │
│  ├── 内容: 过去的任务执行记录、成功/失败案例                           │
│  └── 用途: "上次类似的对账差异是因为汇率更新延迟导致的"                  │
└─────────────────────────────────────────────────────────────────────┘
```

#### Layer 2 基础设施服务层：数据的「仓库和邮局」

```
每个组件的选择理由：

PostgreSQL（主数据库）
├── 为什么不用MySQL？ → JSONB支持更好（存储Agent定义/Workflow图）
├── 为什么不用MongoDB？ → ACID事务保证数据一致性，关系查询更成熟
└── 高可用 → Patroni + etcd自动选主，同步复制保证RPO=0

Redis（缓存/队列/状态）
├── 缓存 → 减少LLM重复调用（相同Prompt直接返回缓存结果）
├── 队列 → 限流计数器、分布式锁
├── 状态 → LangGraph Checkpoint快速读写
└── 高可用 → Redis Cluster 3主3从，自动故障转移

Kafka（事件总线）
├── 为什么不用RabbitMQ？ → 更高吞吐（10万+ msg/s），持久化更强
├── 用途 → 服务间异步解耦、审计日志流、监控事件流
└── 架构 → KRaft模式（无Zookeeper），3节点集群

Milvus（向量数据库）
├── 为什么不用pgvector？ → 十亿级向量检索性能更优，分布式支持
├── 用途 → RAG文档向量、语义搜索、相似度匹配
└── 架构 → 读写分离，多个Query Node并行检索

MinIO（对象存储）
├── 为什么不用直接S3？ → 可私有部署，API兼容S3，统一接口
├── 用途 → 文档文件、生成结果、备份归档、模型Artifact
└── 架构 → 分布式纠删码，4节点起步

Temporal（工作流引擎）
├── 为什么不用自建Cron？ → 需要持久化、重试、可视化、多语言SDK
├── 用途 → 长时Workflow、定时任务、补偿事务
└── 架构 → Server集群 + PostgreSQL持久化 + 多个Worker

Vault（密钥管理）
├── 为什么不用K8s Secret？ → 动态密钥、自动轮换、访问审计
├── 用途 → API密钥、数据库密码、TLS证书、加密密钥
└── 架构 → HA模式（3节点Raft），自动解封
```

#### Layer 1 基础设施层：运行的「土地和道路」

```
K8s Cluster（容器编排）
├── 为什么用K8s？ → 行业标准，生态成熟，多云一致
├── 核心能力：
│   ├── Deployment → 无状态服务（api-gateway/devkit-api等）
│   ├── StatefulSet → 有状态服务（postgresql/redis/kafka）
│   ├── HPA → 自动水平扩缩容（CPU/Memory/自定义指标）
│   ├── VPA → 自动垂直扩缩容（调整Pod资源限制）
│   ├── NetworkPolicy → 东西向流量隔离（最小权限）
│   └── PDB → 滚动更新时保证最小可用副本
└── 扩展：Karpenter自动节点伸缩，Spot实例节省成本

Container Runtime（容器运行时）
├── containerd → 标准容器运行时
├── gVisor → 安全沙箱（运行不可信代码，如用户提交的自定义工具）
└── 镜像签名 → Cosign验证镜像未被篡改

Service Mesh（服务网格）
├── 为什么用Istio/Cilium？ → 无需修改应用代码获得mTLS、流量治理
├── 能力：
│   ├── mTLS → 服务间通信自动加密
│   ├── Traffic Mirroring → 生产流量复制到预发布用于测试
│   ├── Circuit Breaker → 自动熔断故障服务
│   └── Canary Traffic → 按百分比灰度流量
└── 可观测性 → 自动生成服务拓扑图、延迟热力图

Storage Class（存储类）
├── 本地 → docker volume（开发）
├── 云上 → EBS gp3（高性能块存储，数据库用）
├── 共享 → EFS/NFS（多Pod共享存储）
└── 对象 → S3/MinIO（文件/备份/归档）
```

### 3.3 跨层数据流示例：一次完整的Workflow执行

```
场景：用户通过Web IDE触发一个「客服Agent回答用户问题」的Workflow

┌─────────────────────────────────────────────────────────────────────┐
│  时序图：跨层协作完整流程                                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  用户        Layer7    Layer6    Layer5      Layer4     Layer3     │
│   │           │         │         │           │          │        │
│   │ 点击"测试" │         │         │           │          │        │
│   │──────────→│         │         │           │          │        │
│   │           │ POST /api/v1/agents/customer-service/execute       │
│   │           │────────→│         │           │          │        │
│   │           │         │ JWT校验 │           │          │        │
│   │           │         │ RBAC检查│           │          │        │
│   │           │         │────────→│           │          │        │
│   │           │         │         │ 加载Agent定义           │        │
│   │           │         │         │ 从PostgreSQL读取        │        │
│   │           │         │         │──────────→│          │        │
│   │           │         │         │           │ 构建Workflow图      │
│   │           │         │         │           │ Start → 理解意图   │
│   │           │         │         │           │───────────────────→│
│   │           │         │         │           │          │ LLM调用 │
│   │           │         │         │           │          │ Router │
│   │           │         │         │           │          │────────│
│   │           │         │         │           │          │ 选择GPT-4o
│   │           │         │         │           │          │ 调用OpenAI
│   │           │         │         │           │          │←───────│
│   │           │         │         │           │          │ 返回意图分类
│   │           │         │         │           │←───────────────────│
│   │           │         │         │           │ 状态更新: 节点1完成  │
│   │           │         │         │           │ 保存Checkpoint到Redis│
│   │           │         │         │           │───────────────────→│
│   │           │         │         │           │          │ RAG检索 │
│   │           │         │         │           │          │ 查询Milvus
│   │           │         │         │           │          │「退款流程」
│   │           │         │         │           │          │←───────│
│   │           │         │         │           │          │ Top-3文档
│   │           │         │         │           │←───────────────────│
│   │           │         │         │           │ 状态更新: 节点2完成  │
│   │           │         │         │           │───────────────────→│
│   │           │         │         │           │          │ LLM生成回答
│   │           │         │         │           │          │ (Prompt+检索结果)
│   │           │         │         │           │          │←───────│
│   │           │         │         │           │ 回答生成完成         │
│   │           │         │         │ 调用Guardrail检查输出           │
│   │           │         │         │──────────→│          │        │
│   │           │         │         │           │          │ 内容过滤
│   │           │         │         │           │          │ PII脱敏
│   │           │         │         │←──────────│          │        │
│   │           │         │         │ 检查通过   │          │        │
│   │           │         │         │ 记录审计日志 → Kafka            │
│   │           │         │         │──────────→│          │        │
│   │           │         │         │ 返回结果给Gateway               │
│   │           │         │←────────│         │           │          │
│   │           │←────────│         │         │           │          │
│   │ 显示回答   │         │         │           │          │        │
│   │←──────────│         │         │           │          │        │
│   │           │         │         │           │          │        │
│   │           │         │         │           │ Temporal │ 异步保存│
│   │           │         │         │           │ Worker   │ 执行记录│
│   │           │         │         │           │──────────│→PostgreSQL
│   │           │         │         │           │          │        │
│   │           │         │         │ Sentinel │ 监控指标 │        │
│   │           │         │         │←─────────│ 延迟50ms │        │
│   │           │         │         │ 正常范围 │ Token 234│        │
│   │           │         │         │ 无需告警 │ 成本$0.003│       │
│   │           │         │         │          │          │        │
└─────────────────────────────────────────────────────────────────────┘

完整流程涉及：
• Layer 7 (Web IDE) → 用户发起请求
• Layer 6 (Gateway) → 认证/路由/限流
• Layer 5 (Orchestrator + LLM Gateway + Tool Service + Guardrail) → 业务逻辑
• Layer 4 (LangGraph + Temporal) → 状态管理和可靠执行
• Layer 3 (LLM Router + RAG + Memory) → 智能推理
• Layer 2 (PostgreSQL + Redis + Kafka + Milvus) → 数据持久化和检索
• Layer 1 (K8s) → 底层资源调度
```

---

## 总结速查表

| 维度 | 关键要点 |
|------|----------|
| **用户使用** | 业务运营者用Web UI/聊天机器人，开发者用CLI/YAML，都通过统一API访问 |
| **运维部署** | 本地`make up`一键启动，云上`helm install`一键生产部署，ArgoCD自动同步 |
| **运维维护** | Prometheus监控+Sentinel自治修复+混沌工程定期验证，P1故障3分钟内自动恢复 |
| **Layer 7** | 体验层：Web IDE/CLI/ChatOps/API，让人方便使用 |
| **Layer 6** | 接入层：Gateway统一入口，负责安全/路由/限流 |
| **Layer 5** | 应用层：8个核心业务服务，各自负责开发/编排/推理/工具/运维/安全 |
| **Layer 4** | 编排引擎：LangGraph决定流程，Temporal保证可靠执行 |
| **Layer 3** | 智能层：LLM路由/RAG/记忆，让Agent能思考 |
| **Layer 2** | 基础设施服务：DB/Cache/Message/Vector/Storage/Vault，存数据和传消息 |
| **Layer 1** | 基础设施：K8s/容器/网络/存储，提供运行环境 |

---

*本文档旨在让不同角色的读者都能理解平台的运作方式：用户知道怎么用，运维知道怎么管，架构师知道怎么设计。*
