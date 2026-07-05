export type McpMode = "readonly" | "preview-write";

export type PreviewPlan = {
  ok: true;
  mode: "preview";
  effect: "api-write-preview";
  willExecute: false;
  request: {
    method: "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    body?: Record<string, unknown>;
  };
  safety: {
    requiresUserConfirmation: true;
    executeVia: string;
    mcpExecuteEnabled: false;
  };
};

export function previewPlan(request: PreviewPlan["request"]): PreviewPlan {
  return {
    ok: true,
    mode: "preview",
    effect: "api-write-preview",
    willExecute: false,
    request,
    safety: {
      requiresUserConfirmation: true,
      executeVia: "apexcn workflow approve && apexcn workflow run --resume --execute",
      mcpExecuteEnabled: false
    }
  };
}

export function readonlyBlocked(toolName: string): { ok: false; error: { code: string; message: string } } {
  return {
    ok: false,
    error: {
      code: "MCP_READONLY_BLOCKED",
      message: `${toolName} is a preview-only write tool and is blocked in readonly MCP mode.`
    }
  };
}
