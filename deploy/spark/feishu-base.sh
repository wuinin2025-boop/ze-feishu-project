#!/bin/bash
set -euo pipefail

exec "$HOME/.local/lib/ze-feishu-mcp/node_modules/.bin/lark-mcp" mcp \
  --token-mode tenant_access_token \
  --tools preset.base.default,bitable.v1.appTableRecord.batchCreate,bitable.v1.appTableRecord.batchUpdate,bitable.v1.appTableRecord.batchDelete \
  --language zh \
  --mode stdio
