/**
 * Polyfill for TanStack Start / React useServerFn in client-side SPA mode.
 *
 * Aceita dos formas de "server function":
 *  1. função local (dev / SSR): é invocada diretamente.
 *  2. descritor `{ endpoint, method }` (canônico em `atlas.functions.ts`):
 *     é convertido em `fetch(endpoint, { method, body })`.
 */

export interface ServerFnDescriptor {
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
}

export type ServerFn<TArgs extends unknown[], TReturn> =
  ((...args: TArgs) => Promise<TReturn> | TReturn) | ServerFnDescriptor;

async function invokeEndpoint<TArgs extends unknown[], TReturn>(
  descriptor: ServerFnDescriptor,
  args: TArgs,
): Promise<TReturn> {
  const init: RequestInit = { method: descriptor.method, headers: {} };
  const headers = init.headers as Record<string, string>;

  if (args.length > 0 && descriptor.method !== "GET") {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(args[0]);
  }

  const response = await fetch(descriptor.endpoint, init);
  if (!response.ok) {
    throw new Error(
      `[tanstack-polyfill] ${descriptor.method} ${descriptor.endpoint} → ${response.status}`,
    );
  }
  return (await response.json()) as TReturn;
}

export function useServerFn<TArgs extends unknown[], TReturn>(
  fn: ServerFn<TArgs, TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    try {
      if (typeof fn === "function") {
        return await fn(...args);
      }
      return await invokeEndpoint<TArgs, TReturn>(fn, args);
    } catch (err) {
      console.warn("[tanstack-polyfill] server function fallback:", err);
      throw err;
    }
  };
}

export function createServerFn<TReturn>(
  _options: { method?: ServerFnDescriptor["method"] } | Record<string, unknown>,
): {
  inputValidator<TInput>(validator: (input: unknown) => TInput): {
    handler(
      fn: (ctx: { data: TInput }) => Promise<TReturn> | TReturn,
    ): (...args: unknown[]) => Promise<TReturn>;
  };
  handler(
    fn: (ctx: { data: unknown }) => Promise<TReturn> | TReturn,
  ): (...args: unknown[]) => Promise<TReturn>;
} {
  const wrap =
    (fn: (ctx: { data: any }) => Promise<TReturn> | TReturn) =>
    async (...args: unknown[]): Promise<TReturn> =>
      await fn({ data: args[0] });

  return {
    inputValidator<TInput>(validator: (input: unknown) => TInput) {
      return {
        handler(fn: (ctx: { data: TInput }) => Promise<TReturn> | TReturn) {
          return wrap((ctx) => fn({ data: validator(ctx.data) }));
        },
      };
    },
    handler(fn: (ctx: { data: unknown }) => Promise<TReturn> | TReturn) {
      return wrap(fn);
    },
  } as ReturnType<typeof createServerFn<TReturn>>;
}
