# Flowise 集成指南

## 快速开始

Flowise 已作为服务运行在 http://localhost:3000

1. 打开 http://localhost:3000
2. 登录（admin / changeme）
3. 在左侧菜单点击 **Marketplaces** → 导入预设工作流
4. 或直接创建新 Chatflow

## 配置自定义工具调用平台 Agent

### 步骤1：创建 Custom Tool

进入 **Tools** → **Create Tool**，填写：

- **Tool Name**: `Agent Platform`
- **Description**: `Execute agents from Agent Platform backend`
- **JS Code**:

```javascript
const executeAgent = async (agentName, input) => {
    const res = await fetch(`http://api-gateway:8000/api/v1/agents/${agentName}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input })
    });
    const data = await res.json();
    return data.response || JSON.stringify(data);
};

module.exports = { executeAgent };
```

### 步骤2：在 Chatflow 中使用

1. 创建新 **Chatflow**
2. 拖拽 **Custom Tool** 节点到画布
3. 选择刚才创建的 `Agent Platform` tool
4. 参数：
   - `agentName`: 输入你想调用的 Agent 名称（如 `customer-service`）
   - `input`: 连接上一个节点的输出（如用户输入）
5. 连接 **Chat Input** → **Custom Tool** → **LLM** → **Chat Output**
6. 保存并运行

## 可用 Agent 列表

启动后自动导入，可通过 API 查看：

```bash
curl http://localhost:8000/api/v1/agents
```

| Agent 名称 | 用途 |
|-----------|------|
| `customer-service` | 智能客服 |
| `weather-assistant` | 天气查询 |
| `email-writer` | 邮件撰写 |
| `code-reviewer` | 代码审查 |
| `data-analyzer` | 数据分析 |
| `translator` | 智能翻译 |
| `summarizer` | 文本摘要 |

## 连接本地 Ollama 模型

1. 确保 Ollama 运行：`make up-all`（含 local-llm profile）
2. 在 Flowise Credentials 中添加 **ChatOllama**：
   - Base URL: `http://ollama:11434`
   - Model: `llama3.2`
3. 在 Chatflow 中使用 ChatOllama 节点替代 OpenAI
