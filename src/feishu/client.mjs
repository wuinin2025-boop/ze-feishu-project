import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CONFIG_PATH = process.env.CODEX_CONFIG_PATH || path.join(os.homedir(), '.codex', 'config.toml');

function readSection(text, sectionName) {
  const header = `[${sectionName}]`;
  const start = text.indexOf(header);
  if (start < 0) throw new Error(`Missing config section: ${sectionName}`);
  const bodyStart = start + header.length;
  const remaining = text.slice(bodyStart);
  const nextHeader = remaining.search(/\n\s*\[/);
  return nextHeader < 0 ? remaining : remaining.slice(0, nextHeader);
}

function parseStringAssignments(section) {
  const values = {};
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"([^"]*)"\s*$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function configuredFeishu() {
  const text = fs.readFileSync(CONFIG_PATH, 'utf8');
  const sectionName = text.includes('[mcp_servers.feishu-project-center]')
    ? 'mcp_servers.feishu-project-center'
    : 'mcp_servers.feishu-base';
  const base = parseStringAssignments(readSection(text, sectionName));
  const env = text.includes(`[${sectionName}.env]`)
    ? parseStringAssignments(readSection(text, `${sectionName}.env`))
    : {};
  return { base, env };
}

export async function connectFeishu(toolNames) {
  const { base, env } = configuredFeishu();
  const command = base.command || 'npx';
  const args = command.endsWith('feishu-base.sh')
    ? []
    : ['-y', '@larksuiteoapi/lark-mcp', 'mcp', '--token-mode', 'tenant_access_token', '-l', 'zh'];
  if (toolNames?.length && args.length) args.push('-t', toolNames.join(','));
  const transport = new StdioClientTransport({
    command,
    args,
    env: { ...process.env, ...env },
  });
  const client = new Client({ name: 'ze-feishu-project', version: '0.1.0' });
  await client.connect(transport);
  return client;
}

export async function callFeishuOpenApi(apiPath, { method = 'GET', data } = {}) {
  const { env } = configuredFeishu();
  const domain = (env.LARK_DOMAIN || 'https://open.feishu.cn').replace(/\/$/, '');
  const tokenResponse = await fetch(`${domain}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: env.APP_ID, app_secret: env.APP_SECRET }),
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || tokenData.code !== 0 || !tokenData.tenant_access_token) {
    throw new Error(`Feishu token request failed: ${JSON.stringify(tokenData)}`);
  }

  const response = await fetch(`${domain}/open-apis${apiPath}`, {
    method,
    headers: {
      authorization: `Bearer ${tokenData.tenant_access_token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const responseText = await response.text();
  let result = {};
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error(`Feishu API ${method} ${apiPath} returned HTTP ${response.status}: ${responseText.slice(0, 300)}`);
    }
  }
  if (!response.ok || (typeof result.code === 'number' && result.code !== 0)) {
    throw new Error(`Feishu API ${method} ${apiPath} failed: ${JSON.stringify(result)}`);
  }
  return result;
}

export async function callJson(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.find((item) => item.type === 'text')?.text;
  const data = text ? JSON.parse(text) : result;
  if (result.isError || (typeof data.code === 'number' && data.code !== 0)) {
    throw new Error(`${name} failed: ${JSON.stringify(data)}`);
  }
  return data;
}

export async function searchAll(client, appToken, tableId, fieldNames) {
  const items = [];
  let pageToken;
  do {
    const data = await callJson(client, 'bitable_v1_appTableRecord_search', {
      path: { app_token: appToken, table_id: tableId },
      params: { page_size: 500, ...(pageToken ? { page_token: pageToken } : {}) },
      data: { ...(fieldNames ? { field_names: fieldNames } : {}), automatic_fields: true },
    });
    items.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);
  return items;
}

export function textValue(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (item == null) return [];
      if (typeof item === 'string' || typeof item === 'number') return [String(item)];
      if (typeof item === 'object') return [item.text ?? item.name ?? item.value ?? ''];
      return [];
    }).map(String).map((item) => item.trim()).filter(Boolean).join('、');
  }
  if (typeof value === 'object') return textValue(value.text ?? value.name ?? value.value ?? '');
  return '';
}

export function numberValue(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value && typeof value === 'object') {
    const nested = Array.isArray(value.value) ? value.value[0] : value.value;
    return numberValue(nested);
  }
  return undefined;
}

export function timestampValue(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return undefined;
}
