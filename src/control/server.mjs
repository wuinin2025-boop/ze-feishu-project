#!/usr/bin/env node

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { actionList, commandForAction } from './commands.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const MAX_LOG_CHARS = 240000;

let currentJob;
let lastJob;
let nextJobId = 1;

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function text(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4096) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function publicJob(job) {
  if (!job) return undefined;
  return {
    id: job.id,
    action: job.action,
    command: job.command,
    status: job.status,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
    exit_code: job.exitCode,
    signal: job.signal,
    log: job.log,
  };
}

function appendLog(job, chunk) {
  job.log += chunk;
  if (job.log.length > MAX_LOG_CHARS) {
    job.log = job.log.slice(job.log.length - MAX_LOG_CHARS);
  }
}

function startJob(action) {
  if (currentJob) {
    const error = new Error('已有同步任务正在运行，请等它结束后再点下一个。');
    error.statusCode = 409;
    throw error;
  }

  const command = commandForAction(action);
  const job = {
    id: nextJobId++,
    action,
    command: [NPM, 'run', ...command],
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: undefined,
    exitCode: undefined,
    signal: undefined,
    log: '',
  };
  currentJob = job;
  lastJob = job;

  const child = spawn(NPM, ['run', ...command], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => appendLog(job, chunk.toString()));
  child.stderr.on('data', (chunk) => appendLog(job, chunk.toString()));
  child.on('error', (error) => appendLog(job, `${error.stack || error.message}\n`));
  child.on('close', (code, signal) => {
    job.status = code === 0 ? 'succeeded' : 'failed';
    job.exitCode = code;
    job.signal = signal;
    job.finishedAt = new Date().toISOString();
    currentJob = undefined;
  });

  return job;
}

function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>飞书项目同步控制台</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #171a1f;
      --muted: #626b78;
      --line: #d8dde6;
      --accent: #2563eb;
      --accent-dark: #1d4ed8;
      --danger: #b42318;
      --ok: #087443;
      --radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
    }
    main {
      width: min(1120px, calc(100vw - 32px));
      margin: 28px auto;
      display: grid;
      gap: 18px;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: end;
    }
    h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.15;
      font-weight: 720;
      letter-spacing: 0;
    }
    .sub {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 14px;
    }
    .status {
      min-width: 170px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      font-size: 14px;
      text-align: right;
    }
    .status strong { display: block; color: var(--text); font-size: 15px; }
    .actions {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 10px;
    }
    button {
      min-height: 78px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      padding: 13px 14px;
      text-align: left;
      cursor: pointer;
      transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
    }
    button:hover { border-color: var(--accent); transform: translateY(-1px); }
    button:disabled { cursor: not-allowed; opacity: .55; transform: none; }
    button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    button.primary:hover { background: var(--accent-dark); }
    button.danger span:first-child::after {
      content: " 会写入";
      margin-left: 8px;
      color: var(--danger);
      font-size: 12px;
      font-weight: 700;
    }
    button.primary.danger span:first-child::after { color: #ffe3df; }
    button span { display: block; }
    button span:first-child { font-size: 15px; font-weight: 720; }
    button span:last-child {
      margin-top: 7px;
      color: inherit;
      opacity: .72;
      line-height: 1.35;
      font-size: 13px;
    }
    .logbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
    }
    .logbar p { margin: 0; color: var(--muted); font-size: 14px; }
    pre {
      margin: 0;
      min-height: 360px;
      max-height: calc(100vh - 360px);
      overflow: auto;
      padding: 16px;
      border: 1px solid #111827;
      border-radius: var(--radius);
      background: #111827;
      color: #e5e7eb;
      line-height: 1.5;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    @media (max-width: 680px) {
      header { display: grid; align-items: start; }
      .status { text-align: left; }
      main { width: min(100vw - 20px, 1120px); margin-top: 18px; }
      pre { max-height: none; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>飞书项目同步控制台</h1>
        <p class="sub">本地运行，只控制这台电脑上的脚本。第一次请先点“先演练，不写飞书”。</p>
      </div>
      <div class="status">
        <span>状态</span>
        <strong id="status">空闲</strong>
      </div>
    </header>
    <section class="actions" id="actions"></section>
    <section class="logbar">
      <p id="job">还没有运行任务</p>
      <p>地址：localhost:3000</p>
    </section>
    <pre id="log">等待操作...</pre>
  </main>
  <script>
    const actionsEl = document.getElementById('actions');
    const statusEl = document.getElementById('status');
    const jobEl = document.getElementById('job');
    const logEl = document.getElementById('log');
    let pollTimer;

    async function loadActions() {
      const res = await fetch('/api/actions');
      const actions = await res.json();
      actionsEl.innerHTML = actions.map((action, index) => \`
        <button data-action="\${action.id}" class="\${index === 0 ? 'primary ' : ''}\${action.danger ? 'danger' : ''}">
          <span>\${action.label}</span>
          <span>\${action.description}</span>
        </button>
      \`).join('');
      actionsEl.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        await runAction(button.dataset.action);
      });
    }

    function setBusy(busy) {
      for (const button of actionsEl.querySelectorAll('button')) button.disabled = busy;
    }

    async function runAction(action) {
      setBusy(true);
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: '启动失败' }));
        logEl.textContent = error.error || '启动失败';
        setBusy(false);
        return;
      }
      await refreshStatus();
      pollTimer = setInterval(refreshStatus, 1200);
    }

    async function refreshStatus() {
      const res = await fetch('/api/status');
      const data = await res.json();
      const job = data.current || data.last;
      if (!job) {
        statusEl.textContent = '空闲';
        return;
      }
      const done = job.status !== 'running';
      statusEl.textContent = job.status === 'running' ? '运行中' : (job.status === 'succeeded' ? '已完成' : '失败');
      jobEl.textContent = \`任务 #\${job.id}：\${job.command.join(' ')}\`;
      logEl.textContent = job.log || '任务已启动，等待输出...';
      logEl.scrollTop = logEl.scrollHeight;
      setBusy(!done);
      if (done && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    }

    loadActions().then(refreshStatus);
  </script>
</body>
</html>`;
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  try {
    if (req.method === 'GET' && url.pathname === '/') return text(res, 200, page(), 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/api/actions') return json(res, 200, actionList());
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return json(res, 200, { current: publicJob(currentJob), last: publicJob(lastJob) });
    }
    if (req.method === 'POST' && url.pathname === '/api/run') {
      const body = await readJson(req);
      const job = startJob(body.action);
      return json(res, 202, publicJob(job));
    }
    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message });
  }
}

const server = http.createServer((req, res) => {
  handle(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`本地同步控制台已启动：http://localhost:${PORT}`);
});
