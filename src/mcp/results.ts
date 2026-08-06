import type { CallToolResult } from '@modelcontextprotocol/server';
import { serializeError } from '../errors.js';

type ToolResult = CallToolResult & { structuredContent?: Record<string, unknown> };

export function toolSuccess(data: unknown): ToolResult {
  const structuredContent = { ok: true, data };
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

export function toolFailure(error: unknown): ToolResult {
  const structuredContent = { ok: false, error: serializeError(error) };
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}
