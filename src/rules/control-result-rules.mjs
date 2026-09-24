export function describeFailure(failure) {
  if (typeof failure === 'string') return failure;
  if (!failure || typeof failure !== 'object') return String(failure || '未知错误');
  const name = String(failure.name || failure.step || failure.title || '检查失败').trim();
  const detail = String(failure.detail || failure.message || '').trim();
  return detail ? `${name}：${detail}` : name;
}

export function commandFailure(result, name) {
  if (!result || result.ok || result.json) return undefined;
  const output = `${result.stderr || ''}\n${result.stdout || ''}`.trim();
  const missingField = output.match(/field name ([^\s]+) not exist/i);
  if (missingField) {
    return `${name}失败：飞书字段“${missingField[1]}”不存在，可能已被改名或删除。`;
  }
  const errorLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('Error:'));
  if (errorLine) return `${name}失败：${errorLine.replace(/^Error:\s*/, '')}`;
  return `${name}失败：程序退出码 ${result.code ?? '未知'}。`;
}
