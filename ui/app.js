// ── RelayOps Web UI ──
const API_BASE = window.location.origin;

// API 客户端
const api = {
  async get(path) {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  async patch(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  async delete(path) {
    const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
};

// 状态
let currentPage = 'dashboard';
let agents = [];
let metrics = null;

// ── 工具函数 ──
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN');
}

function timeAgo(iso) {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

function tagClass(status) {
  if (status === 'success' || status === 'pass' || status === true || status === 'enabled') return 'tag-success';
  if (status === 'partial_failure' || status === 'warning') return 'tag-warning';
  if (status === 'fail' || status === 'error' || status === 'failed' || status === false || status === 'disabled') return 'tag-danger';
  return 'tag-default';
}

function statusText(status) {
  const map = { success: '成功', partial_failure: '部分失败', fail: '失败', error: '错误', pass: '通过', enabled: '启用', disabled: '禁用' };
  return map[status] || status;
}

// ── 路由 ──
function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  const titles = {
    dashboard: '仪表盘',
    agents: 'Agent管理',
    knowledge: '知识库',
    tasks: '定时任务',
    executions: '执行历史',
    tools: '工具服务'
  };
  document.getElementById('page-title').textContent = titles[page] || page;
  renderPage(page);
}

function renderPage(page) {
  const container = document.getElementById('page-content');
  container.innerHTML = '<div class="loading"><div class="spinner"></div> 加载中...</div>';

  switch (page) {
    case 'dashboard': renderDashboard(container); break;
    case 'agents': renderAgents(container); break;
    case 'knowledge': renderKnowledge(container); break;
    case 'tasks': renderTasks(container); break;
    case 'executions': renderExecutions(container); break;
    case 'tools': renderTools(container); break;
    default: container.innerHTML = '<div class="empty-state">页面不存在</div>';
  }
}

// ── Dashboard ──
async function renderDashboard(container) {
  try {
    const [metricsData, agentsData, execsData] = await Promise.all([
      api.get('/metrics').catch(() => null),
      api.get('/api/v1/agents').catch(() => ({ agents: [] })),
      api.get('/api/v1/executions?limit=5').catch(() => ({ executions: [] }))
    ]);

    metrics = metricsData;
    agents = agentsData.agents || [];
    const adAgents = agents.filter(a => a.name.startsWith('ad-'));
    const successCount = metrics?.executions?.by_status?.success || 0;
    const totalExecs = metrics?.executions?.total || 0;
    const successRate = totalExecs > 0 ? Math.round((successCount / totalExecs) * 100) : 0;
    const services = metrics?.services || [];
    const serviceHealth = services.length;

    container.innerHTML = `
      <div class="page-section">
        <div class="card-grid">
          <div class="card">
            <div class="card-header">
              <span class="card-title">Agent总数</span>
            </div>
            <div class="card-value accent">${agents.length}</div>
            <div class="card-sub">${adAgents.length} 个自动驾驶专用Agent</div>
          </div>
          <div class="card">
            <div class="card-header">
              <span class="card-title">总执行次数</span>
            </div>
            <div class="card-value info">${totalExecs}</div>
            <div class="card-sub">成功率 ${successRate}%</div>
          </div>
          <div class="card">
            <div class="card-header">
              <span class="card-title">后端服务</span>
            </div>
            <div class="card-value success">${serviceHealth}</div>
            <div class="card-sub">个服务运行中</div>
          </div>
          <div class="card">
            <div class="card-header">
              <span class="card-title">工具数量</span>
            </div>
            <div class="card-value warning">${metrics?.tools?.total || 0}</div>
            <div class="card-sub">个内置工具可用</div>
          </div>
        </div>

        <div class="table-container">
          <div class="table-header">
            <span class="table-title">🚗 自动驾驶Agent概览</span>
            <button class="btn btn-primary btn-sm" onclick="navigate('agents')">查看全部</button>
          </div>
          <table>
            <thead>
              <tr><th>Agent名称</th><th>描述</th><th>工作流</th><th>标签</th></tr>
            </thead>
            <tbody>
              ${adAgents.map(a => `
                <tr>
                  <td><strong>${escapeHtml(a.name)}</strong></td>
                  <td>${escapeHtml(a.description || '-')}</td>
                  <td><span class="tag tag-accent">${a.workflow?.type || 'sequential'}</span></td>
                  <td>${(a.labels || []).map(l => `<span class="tag tag-default">${escapeHtml(l)}</span>`).join(' ')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="table-container">
          <div class="table-header">
            <span class="table-title">🕐 最近执行记录</span>
            <button class="btn btn-primary btn-sm" onclick="navigate('executions')">查看全部</button>
          </div>
          <table>
            <thead>
              <tr><th>ID</th><th>Agent</th><th>状态</th><th>耗时</th><th>时间</th></tr>
            </thead>
            <tbody>
              ${(execsData.executions || []).map(e => `
                <tr>
                  <td><code>${e.id?.slice(0,8) || '-'}</code></td>
                  <td>${escapeHtml(e.agent_name || '-')}</td>
                  <td><span class="tag ${tagClass(e.status)}">${statusText(e.status)}</span></td>
                  <td>${e.duration_ms || 0}ms</td>
                  <td>${timeAgo(e.started_at)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

// ── Agents ──
async function renderAgents(container) {
  try {
    const data = await api.get('/api/v1/agents');
    agents = data.agents || [];
    const filter = (new URLSearchParams(window.location.search)).get('filter') || '';
    const filtered = filter ? agents.filter(a => a.name.includes(filter) || (a.description || '').includes(filter)) : agents;
    const adCount = agents.filter(a => a.name.startsWith('ad-')).length;

    container.innerHTML = `
      <div class="page-section">
        <div class="table-container">
          <div class="table-header">
            <span class="table-title">🤖 Agent列表 (${filtered.length}) · 自动驾驶专用 ${adCount} 个</span>
            <div class="table-actions">
              <div class="search-box">
                <span class="search-icon">🔍</span>
                <input type="text" id="agent-search" placeholder="搜索Agent..." value="${escapeHtml(filter)}">
              </div>
            </div>
          </div>
          <table>
            <thead>
              <tr><th>名称</th><th>描述</th><th>模型</th><th>工作流</th><th>步骤数</th><th>标签</th><th>操作</th></tr>
            </thead>
            <tbody>
              ${filtered.map(a => {
                const steps = a.workflow?.steps?.length || 0;
                const isAD = a.name.startsWith('ad-');
                return `
                <tr>
                  <td>
                    <strong>${escapeHtml(a.name)}</strong>
                    ${isAD ? '<span class="tag tag-accent" style="margin-left:6px">AD</span>' : ''}
                  </td>
                  <td>${escapeHtml(a.description || '-')}</td>
                  <td>${escapeHtml(a.model?.name || 'default')}</td>
                  <td><span class="tag tag-info">${a.workflow?.type || '-'}</span></td>
                  <td>${steps}</td>
                  <td>${(a.labels || []).slice(0,3).map(l => `<span class="tag tag-default">${escapeHtml(l)}</span>`).join(' ')}</td>
                  <td>
                    <button class="btn btn-primary btn-sm" onclick="runAgent('${escapeHtml(a.name)}')">▶ 执行</button>
                    <button class="btn btn-sm" onclick="viewAgent('${escapeHtml(a.name)}')">详情</button>
                  </td>
                </tr>
              `}).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('agent-search')?.addEventListener('input', (e) => {
      const url = new URL(window.location);
      if (e.target.value) url.searchParams.set('filter', e.target.value);
      else url.searchParams.delete('filter');
      window.history.replaceState({}, '', url);
      renderAgents(container);
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

function viewAgent(name) {
  const agent = agents.find(a => a.name === name);
  if (!agent) return;
  const steps = agent.workflow?.steps || [];
  showModal(`Agent详情: ${agent.name}`, `
    <div class="detail-section">
      <div class="detail-section-title">基本信息</div>
      <p><strong>名称:</strong> ${escapeHtml(agent.name)}</p>
      <p><strong>描述:</strong> ${escapeHtml(agent.description || '-')}</p>
      <p><strong>作者:</strong> ${escapeHtml(agent.author || '-')}</p>
      <p><strong>版本:</strong> ${escapeHtml(agent.version || '1.0.0')}</p>
      <p><strong>标签:</strong> ${(agent.labels || []).map(l => `<span class="tag tag-default">${escapeHtml(l)}</span>`).join(' ')}</p>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">模型配置</div>
      <pre>${escapeHtml(JSON.stringify(agent.model || {}, null, 2))}</pre>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">工作流 (${agent.workflow?.type || '-'}) · ${steps.length} 个步骤</div>
      <div class="timeline">
        ${steps.map((s, i) => `
          <div class="timeline-item">
            <div class="timeline-dot ${s.type === 'condition' ? 'warning' : 'success'}"></div>
            <div class="timeline-content">
              <div class="timeline-title">${i+1}. ${escapeHtml(s.name || s.id)} <span class="tag tag-info">${s.type}</span></div>
              <div class="timeline-meta">ID: ${escapeHtml(s.id)}</div>
              ${s.tool ? `<div class="timeline-meta">工具: ${escapeHtml(s.tool)}</div>` : ''}
              ${s.condition ? `<div class="timeline-meta">条件: ${escapeHtml(s.condition)}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    ${agent.system_prompt ? `
    <div class="detail-section">
      <div class="detail-section-title">系统提示词</div>
      <pre>${escapeHtml(agent.system_prompt)}</pre>
    </div>
    ` : ''}
    ${agent.tools?.length ? `
    <div class="detail-section">
      <div class="detail-section-title">工具列表</div>
      <pre>${escapeHtml(JSON.stringify(agent.tools, null, 2))}</pre>
    </div>
    ` : ''}
  `, `
    <button class="btn" onclick="closeModal()">关闭</button>
    <button class="btn btn-primary" onclick="closeModal(); runAgent('${escapeHtml(name)}')">执行</button>
  `);
}

function runAgent(name) {
  showModal(`执行 Agent: ${name}`, `
    <div class="form-group">
      <label class="form-label">输入内容</label>
      <textarea id="agent-input" placeholder="请输入任务描述..."></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">上下文 (可选JSON)</label>
      <textarea id="agent-context" placeholder='{"key": "value"}' style="min-height:60px"></textarea>
    </div>
    <div id="run-result" style="display:none;margin-top:16px;">
      <div class="detail-section">
        <div class="detail-section-title">执行结果</div>
        <pre id="run-result-content"></pre>
      </div>
    </div>
  `, `
    <button class="btn" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" id="run-btn" onclick="doRunAgent('${escapeHtml(name)}')">开始执行</button>
  `);
}

async function doRunAgent(name) {
  const btn = document.getElementById('run-btn');
  const input = document.getElementById('agent-input').value;
  const contextStr = document.getElementById('agent-context').value;
  const resultDiv = document.getElementById('run-result');
  const resultContent = document.getElementById('run-result-content');

  if (!input.trim()) { alert('请输入输入内容'); return; }

  btn.disabled = true;
  btn.textContent = '执行中...';

  try {
    const body = { input, context: {} };
    if (contextStr.trim()) {
      try { body.context = JSON.parse(contextStr); } catch {}
    }
    const res = await api.post(`/api/v1/agents/${name}/execute`, body);
    resultDiv.style.display = 'block';
    resultContent.textContent = JSON.stringify(res, null, 2);
    btn.textContent = '执行完成';
    btn.disabled = false;
  } catch (err) {
    resultDiv.style.display = 'block';
    resultContent.textContent = '错误: ' + err.message;
    btn.textContent = '重试';
    btn.disabled = false;
  }
}


// ── Knowledge ──
async function renderKnowledge(container) {
  try {
    const docsData = await api.get('/api/v1/knowledge/documents').catch(() => ({ documents: [] }));
    const docs = docsData.documents || [];
    const adDocs = docs.filter(d => (d.title || '').includes('autonomous') || (d.tags || []).some(t => t.includes('autonomous')));

    container.innerHTML = `
      <div class="page-section">
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px;">
          <div class="card">
            <div class="card-header">
              <span class="card-title">🔍 知识库搜索</span>
            </div>
            <div class="form-group">
              <input type="text" id="kb-search-input" placeholder="输入关键词搜索文档...">
            </div>
            <button class="btn btn-primary" onclick="searchKnowledge()" style="width:100%">搜索</button>
            <div id="kb-search-results" style="margin-top:16px;"></div>
          </div>
          <div class="card">
            <div class="card-header">
              <span class="card-title">💬 RAG 智能问答</span>
            </div>
            <div class="form-group">
              <textarea id="kb-ask-input" placeholder="输入问题，例如：OTA升级失败如何回滚？"></textarea>
            </div>
            <button class="btn btn-primary" onclick="askKnowledge()" style="width:100%">提问</button>
            <div id="kb-ask-result" style="margin-top:16px;"></div>
          </div>
        </div>

        <div class="table-container">
          <div class="table-header">
            <span class="table-title">📚 知识库文档 (${docs.length})</span>
          </div>
          <table>
            <thead>
              <tr><th>ID</th><th>标题</th><th>来源</th><th>分块数</th><th>标签</th><th>创建时间</th></tr>
            </thead>
            <tbody>
              ${docs.map(d => `
                <tr>
                  <td>${d.id}</td>
                  <td><strong>${escapeHtml(d.title || '-')}</strong></td>
                  <td>${escapeHtml(d.source || '-')}</td>
                  <td>${d.chunk_count || 0}</td>
                  <td>${(d.tags || []).map(t => `<span class="tag tag-default">${escapeHtml(t)}</span>`).join(' ')}</td>
                  <td>${formatDate(d.created_at)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

async function searchKnowledge() {
  const input = document.getElementById('kb-search-input').value.trim();
  const resultsDiv = document.getElementById('kb-search-results');
  if (!input) return;
  resultsDiv.innerHTML = '<div class="loading"><div class="spinner"></div> 搜索中...</div>';
  try {
    const res = await api.post('/api/v1/knowledge/search', { query: input, limit: 5 });
    const results = res.results || [];
    resultsDiv.innerHTML = results.length ? results.map((r, i) => `
      <div style="padding:10px; background:var(--bg-primary); border-radius:6px; margin-bottom:8px;">
        <div style="font-weight:500; margin-bottom:4px;">#${i+1} 文档ID: ${r.document_id || r.id}</div>
        <div style="font-size:13px; color:var(--text-secondary); line-height:1.5;">${escapeHtml((r.content || r.chunk_content || '-').slice(0, 200))}...</div>
      </div>
    `).join('') : '<div style="color:var(--text-muted)">未找到相关结果</div>';
  } catch (err) {
    resultsDiv.innerHTML = `<div style="color:var(--danger)">搜索失败: ${escapeHtml(err.message)}</div>`;
  }
}

async function askKnowledge() {
  const input = document.getElementById('kb-ask-input').value.trim();
  const resultDiv = document.getElementById('kb-ask-result');
  if (!input) return;
  resultDiv.innerHTML = '<div class="loading"><div class="spinner"></div> 思考中...</div>';
  try {
    const res = await api.post('/api/v1/knowledge/ask', { question: input, top_k: 3 });
    resultDiv.innerHTML = `
      <div style="padding:14px; background:var(--bg-primary); border-radius:8px;">
        <div style="font-weight:600; margin-bottom:10px; color:var(--accent);">💡 回答</div>
        <div style="line-height:1.7; white-space:pre-wrap;">${escapeHtml(res.answer || '无回答')}</div>
        ${res.sources?.length ? `
          <div style="margin-top:12px; padding-top:12px; border-top:1px solid var(--border);">
            <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;">参考来源</div>
            ${res.sources.map(s => `<div style="font-size:12px; color:var(--text-secondary);">· ${escapeHtml(s.title || s.document_id || '-')}</div>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  } catch (err) {
    resultDiv.innerHTML = `<div style="color:var(--danger)">问答失败: ${escapeHtml(err.message)}</div>`;
  }
}

// ── Tasks ──
async function renderTasks(container) {
  try {
    const data = await api.get('/api/v1/scheduler/tasks');
    const tasks = data.tasks || [];
    const adTasks = tasks.filter(t => (t.agent_name || '').startsWith('ad-'));

    container.innerHTML = `
      <div class="page-section">
        <div class="table-container">
          <div class="table-header">
            <span class="table-title">⏰ 定时任务 (${tasks.length}) · 自动驾驶相关 ${adTasks.length} 个</span>
          </div>
          <table>
            <thead>
              <tr><th>ID</th><th>名称</th><th>Agent</th><th>类型</th><th>配置</th><th>状态</th><th>运行次数</th><th>操作</th></tr>
            </thead>
            <tbody>
              ${tasks.map(t => {
                const isAD = (t.agent_name || '').startsWith('ad-');
                const config = t.schedule_type === 'daily'
                  ? `每天 ${String(t.schedule_config?.hour||0).padStart(2,'0')}:${String(t.schedule_config?.minute||0).padStart(2,'0')}`
                  : `每 ${t.schedule_config?.minutes || t.interval_minutes || '-'} 分钟`;
                return `
                <tr>
                  <td>${t.id}</td>
                  <td><strong>${escapeHtml(t.name)}</strong>${isAD ? '<span class="tag tag-accent" style="margin-left:6px">AD</span>' : ''}</td>
                  <td>${escapeHtml(t.agent_name || '-')}</td>
                  <td><span class="tag tag-info">${t.schedule_type}</span></td>
                  <td>${config}</td>
                  <td><span class="tag ${tagClass(t.enabled)}">${t.enabled ? '启用' : '禁用'}</span></td>
                  <td>${t.run_count || 0} / ${t.success_count || 0} 成功</td>
                  <td>
                    <button class="btn btn-sm ${t.enabled ? 'btn-danger' : 'btn-success'}" onclick="toggleTask(${t.id}, ${!t.enabled})">${t.enabled ? '禁用' : '启用'}</button>
                  </td>
                </tr>
              `}).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

async function toggleTask(id, enable) {
  try {
    await api.patch(`/api/v1/scheduler/tasks/${id}/toggle`, { enabled: enable });
    renderTasks(document.getElementById('page-content'));
  } catch (err) {
    alert('操作失败: ' + err.message);
  }
}

// ── Executions ──
let execPage = 1;
let execAgentFilter = '';

async function renderExecutions(container, page = 1) {
  try {
    execPage = page;
    const limit = 10;
    const offset = (page - 1) * limit;
    let url = `/api/v1/executions?limit=${limit}&offset=${offset}`;
    if (execAgentFilter) url += `&agent_name=${encodeURIComponent(execAgentFilter)}`;

    const data = await api.get(url);
    const execs = data.executions || [];
    const total = data.total || execs.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    container.innerHTML = `
      <div class="page-section">
        <div class="table-container">
          <div class="table-header">
            <span class="table-title">📋 执行历史 (${total} 条)</span>
            <div class="table-actions">
              <div class="search-box">
                <span class="search-icon">🔍</span>
                <input type="text" id="exec-filter" placeholder="过滤Agent..." value="${escapeHtml(execAgentFilter)}">
              </div>
            </div>
          </div>
          <table>
            <thead>
              <tr><th>ID</th><th>Agent</th><th>状态</th><th>耗时</th><th>步骤</th><th>时间</th><th>操作</th></tr>
            </thead>
            <tbody>
              ${execs.map(e => `
                <tr>
                  <td><code>${e.id?.slice(0,12) || '-'}</code></td>
                  <td>${escapeHtml(e.agent_name || '-')}</td>
                  <td><span class="tag ${tagClass(e.status)}">${statusText(e.status)}</span></td>
                  <td>${e.duration_ms || 0}ms</td>
                  <td>${(e.steps || []).length}</td>
                  <td>${formatDate(e.started_at)}</td>
                  <td>
                    <button class="btn btn-sm" onclick="viewExecution('${e.id}')">详情</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="pagination">
            <button class="btn btn-sm" onclick="renderExecutions(document.getElementById('page-content'), ${page-1})" ${page<=1?'disabled':''}>上一页</button>
            <span style="color:var(--text-secondary);font-size:13px;">第 ${page} / ${totalPages} 页</span>
            <button class="btn btn-sm" onclick="renderExecutions(document.getElementById('page-content'), ${page+1})" ${page>=totalPages?'disabled':''}>下一页</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('exec-filter')?.addEventListener('change', (ev) => {
      execAgentFilter = ev.target.value;
      renderExecutions(container, 1);
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

async function viewExecution(id) {
  try {
    const e = await api.get(`/api/v1/executions/${id}`);
    const steps = e.steps || [];
    showModal(`执行详情: ${e.id?.slice(0,16)}`, `
      <div class="detail-section">
        <p><strong>Agent:</strong> ${escapeHtml(e.agent_name || '-')}</p>
        <p><strong>状态:</strong> <span class="tag ${tagClass(e.status)}">${statusText(e.status)}</span></p>
        <p><strong>耗时:</strong> ${e.duration_ms || 0}ms</p>
        <p><strong>开始时间:</strong> ${formatDate(e.started_at)}</p>
        <p><strong>结束时间:</strong> ${formatDate(e.completed_at)}</p>
        ${e.input ? `<p><strong>输入:</strong> <pre style="margin-top:8px">${escapeHtml(typeof e.input === 'string' ? e.input : JSON.stringify(e.input, null, 2))}</pre></p>` : ''}
      </div>
      <div class="detail-section">
        <div class="detail-section-title">执行步骤 (${steps.length})</div>
        <div class="timeline">
          ${steps.map(s => `
            <div class="timeline-item">
              <div class="timeline-dot ${s.status === 'success' ? 'success' : s.status === 'error' ? 'danger' : 'warning'}"></div>
              <div class="timeline-content">
                <div class="timeline-title">${escapeHtml(s.node)} <span class="tag tag-info">${s.type}</span></div>
                <div class="timeline-meta">状态: ${s.status} · 耗时: ${s.latency_ms || 0}ms</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      ${e.response ? `
      <div class="detail-section">
        <div class="detail-section-title">响应内容</div>
        <pre>${escapeHtml(typeof e.response === 'string' ? e.response : JSON.stringify(e.response, null, 2))}</pre>
      </div>
      ` : ''}
    `, `<button class="btn" onclick="closeModal()">关闭</button>`);
  } catch (err) {
    alert('加载详情失败: ' + err.message);
  }
}

// ── Tools ──
async function renderTools(container) {
  try {
    const data = await api.get('/api/v1/tools');
    const tools = (data.tools || []).concat(data.built_in || []);
    const builtIn = data.built_in || [];
    const custom = data.tools || [];

    container.innerHTML = `
      <div class="page-section">
        <div class="card-grid">
          <div class="card">
            <div class="card-header"><span class="card-title">内置工具</span></div>
            <div class="card-value accent">${builtIn.length}</div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">自定义工具</span></div>
            <div class="card-value info">${custom.length}</div>
          </div>
        </div>

        <div class="table-container">
          <div class="table-header">
            <span class="table-title">🛠️ 工具列表 (${tools.length})</span>
          </div>
          <table>
            <thead>
              <tr><th>名称</th><th>描述</th><th>类型</th><th>参数</th><th>操作</th></tr>
            </thead>
            <tbody>
              ${tools.map(t => `
                <tr>
                  <td><strong>${escapeHtml(t.name)}</strong></td>
                  <td>${escapeHtml(t.description || '-')}</td>
                  <td><span class="tag ${t.source === 'built_in' || t.is_builtin ? 'tag-accent' : 'tag-info'}">${t.source === 'built_in' || t.is_builtin ? '内置' : '自定义'}</span></td>
                  <td><pre style="font-size:11px">${escapeHtml(JSON.stringify(t.inputs || t.parameters || {}, null, 2))}</pre></td>
                  <td><button class="btn btn-sm" onclick="invokeTool('${escapeHtml(t.name)}')">调用</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

function invokeTool(name) {
  showModal(`调用工具: ${name}`, `
    <div class="form-group">
      <label class="form-label">参数 (JSON)</label>
      <textarea id="tool-params">{}</textarea>
    </div>
    <div id="tool-result" style="display:none;margin-top:16px;">
      <div class="detail-section">
        <div class="detail-section-title">调用结果</div>
        <pre id="tool-result-content"></pre>
      </div>
    </div>
  `, `
    <button class="btn" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" id="tool-btn" onclick="doInvokeTool('${escapeHtml(name)}')">调用</button>
  `);
}

async function doInvokeTool(name) {
  const btn = document.getElementById('tool-btn');
  const paramsStr = document.getElementById('tool-params').value;
  const resultDiv = document.getElementById('tool-result');
  const resultContent = document.getElementById('tool-result-content');

  let params = {};
  try { params = JSON.parse(paramsStr); } catch { alert('参数必须是有效JSON'); return; }

  btn.disabled = true;
  btn.textContent = '调用中...';

  try {
    const res = await api.post(`/api/v1/tools/${name}/invoke`, params);
    resultDiv.style.display = 'block';
    resultContent.textContent = JSON.stringify(res, null, 2);
    btn.textContent = '调用完成';
    btn.disabled = false;
  } catch (err) {
    resultDiv.style.display = 'block';
    resultContent.textContent = '错误: ' + err.message;
    btn.textContent = '重试';
    btn.disabled = false;
  }
}

// ── 模态框 ──
function showModal(title, body, footer) {
  const container = document.getElementById('modal-container');
  container.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <div class="modal-header">
          <span class="modal-title">${title}</span>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">${body}</div>
        <div class="modal-footer">${footer}</div>
      </div>
    </div>
  `;
}

function closeModal() {
  document.getElementById('modal-container').innerHTML = '';
}

// ── 初始化 ──
async function checkApiStatus() {
  const el = document.getElementById('api-status');
  try {
    await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    el.className = 'api-status online';
    el.innerHTML = '<span>●</span> API已连接';
  } catch {
    el.className = 'api-status offline';
    el.innerHTML = '<span>●</span> API离线';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.page));
  });

  checkApiStatus();
  setInterval(checkApiStatus, 10000);
  navigate('dashboard');
});
