#!/usr/bin/env node

import { spawn } from 'node:child_process';
import http from 'node:http';
import process from 'node:process';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || '/');
const CONTROL_PASSWORD = process.env.CONTROL_PASSWORD || '';
let running = false;
const recentRuns = [];

function normalizeBasePath(value) {
  const trimmed = String(value || '/').trim();
  if (!trimmed || trimmed === '/') return '/';
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
}

function withBasePath(path) {
  if (BASE_PATH === '/') return path;
  return `${BASE_PATH}${path === '/' ? '/' : path}`;
}

function routePath(url = '/') {
  const pathname = new URL(url, 'http://localhost').pathname;
  if (BASE_PATH === '/') return pathname;
  if (pathname === BASE_PATH) return '/';
  if (pathname.startsWith(`${BASE_PATH}/`)) return pathname.slice(BASE_PATH.length);
  return pathname;
}

function unauthorized(res) {
  res.writeHead(401, {
    'content-type': 'text/plain; charset=utf-8',
    'www-authenticate': 'Basic realm="ZE Feishu Control"',
  });
  res.end('需要输入访问密码');
}

function isAuthorized(req) {
  if (!CONTROL_PASSWORD) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const password = decoded.slice(decoded.indexOf(':') + 1);
    return password === CONTROL_PASSWORD;
  } catch {
    return false;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function commandLabel(command) {
  return command.join(' ');
}

function runCommand(command) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({
        command: commandLabel(command),
        code,
        ok: code === 0,
        stdout,
        stderr,
        json: extractJson(stdout),
      });
    });
  });
}

function summarizeRun(syncResult, verifyResult) {
  const sync = syncResult?.json || {};
  const verify = verifyResult?.json || {};
  return {
    pass: Boolean(syncResult?.ok && verifyResult?.ok && verify.pass !== false),
    sync: {
      protected_tables: sync.protected_tables || [],
      stats: sync.stats || {},
      upsert: sync.upsert || {},
    },
    verify: {
      pass: verify.pass,
      counts: verify.counts || {},
      amounts: verify.amounts || {},
      failures: verify.failures || [],
    },
  };
}

async function runTask(task) {
  if (task === 'setup') {
    const setup = await runCommand(['npm', 'run', 'setup:invoice-model']);
    return { task, steps: [setup], summary: { pass: setup.ok, setup: setup.json } };
  }
  if (task === 'verify') {
    const verify = await runCommand(['npm', 'run', 'verify:invoice']);
    return { task, steps: [verify], summary: { pass: verify.ok && verify.json?.pass !== false, verify: verify.json } };
  }
  if (task === 'dry-run') {
    const sync = await runCommand(['npm', 'run', 'sync:invoice', '--', '--dry-run']);
    return { task, steps: [sync], summary: { pass: sync.ok, sync: sync.json } };
  }
  const sync = await runCommand(['npm', 'run', 'sync:invoice']);
  const verify = await runCommand(['npm', 'run', 'verify:invoice']);
  return { task: 'sync-all', steps: [sync, verify], summary: summarizeRun(sync, verify) };
}

function html() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>飞书项目中心本地控制台</title>
  <style>
    :root { color-scheme: light; --blue:#1769ff; --line:#dde3ee; --text:#1f2733; --muted:#6b7280; --bg:#f5f7fb; --ok:#0f8f57; --bad:#c92a2a; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    header { padding: 22px 28px; background: white; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    h1 { font-size: 20px; margin: 0; }
    main { max-width: 1180px; margin: 0 auto; padding: 22px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
    button { border: 1px solid var(--line); background: white; color: var(--text); border-radius: 8px; height: 40px; padding: 0 14px; cursor: pointer; font-weight: 600; }
    button.primary { background: var(--blue); color: white; border-color: var(--blue); }
    button:disabled { opacity: .55; cursor: wait; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .card { background: white; border: 1px solid var(--line); border-radius: 8px; padding: 16px; min-height: 92px; }
    .card h2 { margin: 0 0 8px; font-size: 13px; color: var(--muted); font-weight: 600; }
    .value { font-size: 28px; font-weight: 760; }
    .wide { grid-column: 1 / -1; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
    .ok { color: var(--ok); }
    .bad { color: var(--bad); }
    .detail-section { border-top: 1px solid var(--line); padding-top: 12px; margin-top: 12px; }
    .detail-section:first-child { border-top: 0; padding-top: 0; margin-top: 0; }
    .detail-section h3 { margin: 0 0 8px; font-size: 15px; }
    ul { margin: 8px 0 0; padding-left: 18px; }
    li { margin: 4px 0; }
    .muted { color: var(--muted); }
    @media (max-width: 860px) { .grid, .two { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>飞书项目中心本地控制台</h1>
    <div id="status" class="muted">未运行</div>
  </header>
  <main>
    <div class="toolbar">
      <button class="primary" data-task="sync-all">同步项目和开票数据</button>
      <button data-task="dry-run">试算不写入</button>
      <button data-task="verify">只核对</button>
      <button data-task="setup">检查表结构</button>
    </div>
    <section class="grid" id="summary"></section>
    <section class="two">
      <div class="card">
        <h2>本次新增</h2>
        <div id="created" class="muted">暂无</div>
      </div>
      <div class="card">
        <h2>本次更新</h2>
        <div id="updated" class="muted">暂无</div>
      </div>
    </section>
    <section class="card wide" style="margin-top:12px;">
      <h2>具体更新数据列表</h2>
      <div id="detailList" class="muted">点击按钮开始。</div>
    </section>
  </main>
  <script>
    const BASE_PATH = ${JSON.stringify(BASE_PATH)};
    const buttons = [...document.querySelectorAll('button[data-task]')];
    const statusEl = document.querySelector('#status');
    const summaryEl = document.querySelector('#summary');
    const createdEl = document.querySelector('#created');
    const updatedEl = document.querySelector('#updated');
    const detailListEl = document.querySelector('#detailList');
    const tableNames = {
      project_overview_sources: '项目总览表（基础项目）',
      invoice_detail: '开票明细统一表',
      invoice_plan: '项目开票计划表',
      invoice_detail_plan_links: '开票明细关联计划',
      stale_invoice_details: '开票明细统一表（剔除旧明细）',
      project_overview: '项目总览表（汇总字段）',
      project_progress: '项目进度表',
    };

    function metric(title, value, className = '') {
      return '<div class="card"><h2>' + title + '</h2><div class="value ' + className + '">' + (value ?? '-') + '</div></div>';
    }

    function listKeys(groups, field) {
      const items = [];
      for (const [name, value] of Object.entries(groups || {})) {
        for (const key of value?.[field] || []) items.push('<li>' + escapeHtml(tableNames[name] || name) + '：' + escapeHtml(key) + '</li>');
      }
      return items.length ? '<ul>' + items.join('') + '</ul>' : '暂无';
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[char]));
    }

    function countText(value, field) {
      const explicit = value?.[field + '_count'];
      if (typeof explicit === 'number') return explicit;
      return (value?.[field + 's'] || []).length;
    }

    function renderKeyGroup(groups, field, emptyText) {
      const sections = [];
      for (const [name, value] of Object.entries(groups || {})) {
        if (!value || typeof value !== 'object') continue;
        const keys = value[field] || [];
        const count = countText(value, field.replace('_keys', '_key'));
        const limit = value.key_display_limit || keys.length;
        if (!count && !keys.length) continue;
        const hiddenText = count > keys.length ? '，当前显示前 ' + Math.min(limit, keys.length) + ' 条' : '';
        sections.push(
          '<div class="detail-section"><h3>' + escapeHtml(tableNames[name] || name) + '：' + count + ' 条' + hiddenText + '</h3>'
          + (keys.length ? '<ul>' + keys.map((key) => '<li>' + escapeHtml(key) + '</li>').join('') + '</ul>' : '<div class="muted">本次没有返回具体记录名。</div>')
          + '</div>'
        );
      }
      return sections.length ? sections.join('') : '<div class="muted">' + emptyText + '</div>';
    }

    function renderReminders(stats, verify) {
      const reminders = [];
      if (Number(stats.amount_exception_plan_rows || 0) > 0) reminders.push('有 ' + stats.amount_exception_plan_rows + ' 条开票计划金额异常，需人工确认。');
      if (Number(stats.unmatched_invoice_rows || 0) > 0) reminders.push('有 ' + stats.unmatched_invoice_rows + ' 条发票未匹配项目、计划外开票或红冲待确认。');
      if (Number(stats.old_project_plan_skipped_rows || 0) > 0) reminders.push('旧项目补录表有 ' + stats.old_project_plan_skipped_rows + ' 条未生成计划，通常是项目编号、期次或金额不完整。');
      for (const failure of verify.failures || []) reminders.push(failure);
      if (!reminders.length) return '<div class="muted">没有发现需要人工处理的异常。</div>';
      return '<ul>' + reminders.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul>';
    }

    function renderDetails(summary, stats, upsert, verify) {
      return [
        '<div class="detail-section"><h3>本次新增记录</h3>' + renderKeyGroup(upsert, 'created_keys', '本次没有新增记录。') + '</div>',
        '<div class="detail-section"><h3>本次更新记录</h3>' + renderKeyGroup(upsert, 'updated_keys', '本次没有更新记录。') + '</div>',
        '<div class="detail-section"><h3>需要人工确认</h3>' + renderReminders(stats, verify) + '</div>',
      ].join('');
    }

    function render(data) {
      const summary = data.summary || {};
      const sync = summary.sync || {};
      const verify = summary.verify || {};
      const stats = sync.stats || sync.sync?.stats || {};
      const upsert = sync.upsert || sync.sync?.upsert || {};
      const pass = summary.pass;
      summaryEl.innerHTML = [
        metric('运行结果', pass ? '通过' : '未通过', pass ? 'ok' : 'bad'),
        metric('旧项目计划', stats.old_project_plan_rows),
        metric('新项目计划', stats.source_plan_rows),
        metric('开票明细', stats.source_invoice_rows),
        metric('匹配发票', stats.matched_invoice_rows),
        metric('红冲抵消', stats.offset_invoice_rows),
        metric('未匹配/计划外', stats.unmatched_invoice_rows),
        metric('金额异常', stats.amount_exception_plan_rows),
        metric('剔除旧明细', stats.stale_invoice_detail_rows),
        metric('新增进度项目', stats.project_progress_created_candidates),
      ].join('');
      createdEl.innerHTML = listKeys(upsert, 'created_keys');
      updatedEl.innerHTML = listKeys(upsert, 'updated_keys');
      detailListEl.innerHTML = renderDetails(summary, stats, upsert, verify);
      statusEl.textContent = '最近运行：' + new Date().toLocaleString();
      statusEl.className = pass ? 'ok' : 'bad';
    }

    async function run(task) {
      buttons.forEach((button) => { button.disabled = true; });
      statusEl.textContent = '运行中，请保持这个终端窗口打开...';
      statusEl.className = 'muted';
      try {
        const response = await fetch(BASE_PATH.replace(/\\/$/, '') + '/api/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ task }),
        });
        const data = await response.json();
        render(data);
      } catch (error) {
        statusEl.textContent = '运行失败';
        statusEl.className = 'bad';
        detailListEl.innerHTML = '<div class="bad">运行失败：' + escapeHtml(error.message) + '</div>';
      } finally {
        buttons.forEach((button) => { button.disabled = false; });
      }
    }

    buttons.forEach((button) => {
      button.addEventListener('click', () => run(button.dataset.task));
    });
  </script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const pathname = routePath(req.url);
  if (!isAuthorized(req)) {
    unauthorized(res);
    return;
  }
  if (BASE_PATH !== '/' && new URL(req.url, 'http://localhost').pathname === BASE_PATH) {
    res.writeHead(302, { location: `${BASE_PATH}/` });
    res.end();
    return;
  }
  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html());
    return;
  }
  if (req.method === 'POST' && pathname === '/api/run') {
    if (running) {
      sendJson(res, 409, { error: '已有任务正在运行，请等它结束后再点。' });
      return;
    }
    running = true;
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const { task = 'sync-all' } = body ? JSON.parse(body) : {};
        const result = await runTask(task);
        const payload = { ...result, finished_at: new Date().toISOString() };
        recentRuns.unshift(payload);
        recentRuns.splice(20);
        sendJson(res, 200, payload);
      } catch (error) {
        sendJson(res, 500, { error: error.message, stack: error.stack });
      } finally {
        running = false;
      }
    });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/recent') {
    sendJson(res, 200, { recentRuns });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`控制台已启动：http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}${withBasePath('/')}`);
});
