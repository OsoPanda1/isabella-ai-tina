export const MAX_JSON_DEPTH = 8;
export const MAX_OBJECT_KEYS = 128;
export const MAX_ARRAY_ITEMS = 128;

export class RequestLimitError extends Error {
  readonly code: "REQUEST_BODY_TOO_LARGE" | "REQUEST_OBJECT_TOO_DEEP" | "REQUEST_OBJECT_TOO_LARGE";

  constructor(code: RequestLimitError["code"]) {
    super(code);
    this.name = "RequestLimitError";
    this.code = code;
  }
}

export function requestBodyLimitBytes(request: Request, configured: number): number {
  const parsed = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  const maxBytes = Math.max(1024, Math.min(configured, 1_048_576));
  if (Number.isFinite(parsed) && parsed > maxBytes)
    throw new RequestLimitError("REQUEST_BODY_TOO_LARGE");
  return maxBytes;
}

export async function readJsonBody(request: Request, configured: number): Promise<unknown> {
  const maxBytes = requestBodyLimitBytes(request, configured);
  if (!request.body) return null;

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("request_body_too_large");
        throw new RequestLimitError("REQUEST_BODY_TOO_LARGE");
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new SyntaxError("INVALID_JSON");
  }
}

export function assertBoundedJsonValue(
  value: unknown,
  options: { maxDepth?: number; maxObjectKeys?: number; maxArrayItems?: number } = {},
): void {
  const maxDepth = options.maxDepth ?? MAX_JSON_DEPTH;
  const maxObjectKeys = options.maxObjectKeys ?? MAX_OBJECT_KEYS;
  const maxArrayItems = options.maxArrayItems ?? MAX_ARRAY_ITEMS;

  const visit = (current: unknown, depth: number): void => {
    if (depth > maxDepth) throw new RequestLimitError("REQUEST_OBJECT_TOO_DEEP");
    if (typeof current !== "object" || current === null) return;
    if (Array.isArray(current)) {
      if (current.length > maxArrayItems) throw new RequestLimitError("REQUEST_OBJECT_TOO_LARGE");
      for (const item of current) visit(item, depth + 1);
      return;
    }
    const keys = Object.keys(current);
    if (keys.length > maxObjectKeys) throw new RequestLimitError("REQUEST_OBJECT_TOO_LARGE");
    for (const key of keys) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new RequestLimitError("REQUEST_OBJECT_TOO_LARGE");
      }
      visit((current as Record<string, unknown>)[key], depth + 1);
    }
  };

  visit(value, 0);
}

export function safeErrorCode(error: unknown): string {
  return error instanceof RequestLimitError ? error.code : "INVALID_REQUEST";
}
