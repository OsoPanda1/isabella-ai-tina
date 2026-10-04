import { SecuritySystem } from "./security";
import { PrincipalContext } from "./principal-context";
import { evaluateAuthorization, type AuthorizationContext } from "./authorization";
import type { Resource, Action } from "./permission-matrix";
import { runWithIdentity } from "./identity-context";
import { resolveTrustedClientIp } from "./trusted-client-ip";
import { parseSafeJsonBody } from "./input-limits";
import { config } from "./config";
import { buildAuthorizationDynamicContext } from "./authorization-context";

export class ApiGateway {
  public static async handle<T>(
    request: Request,
    resource: Resource,
    action: Action,
    schema: {
      safeParse: (data: unknown) => {
        success: boolean;
        data?: T;
        error?: { message: string };
      };
    },
    handler: (context: PrincipalContext, data: T) => Promise<Response>,
  ): Promise<Response> {
    const headers = SecuritySystem.injectSecureHeaders(
      new Headers({ "content-type": "application/json" }),
    );
    const method = request.method.toUpperCase();
    const bodyMethods = new Set(["POST", "PUT", "PATCH"]);
    const maxBodyBytes = config().INPUT_MAX_BODY_BYTES;
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (bodyMethods.has(method) && Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      return new Response(JSON.stringify({ error: "Payload excede el límite permitido." }), {
        status: 413,
        headers,
      });
    }

    const authResult = await PrincipalContext.authorize(request);
    if (!authResult.success) return authResult.response;
    const { context } = authResult;
    const clientIp = resolveTrustedClientIp(request);

    const dynamicAuthorizationContext = buildAuthorizationDynamicContext(
      request,
      context.tenantId,
      context.userId,
    );
    const authReq: AuthorizationContext = {
      tenant_id: context.tenantId,
      subject_id: context.userId,
      action,
      resource,
      role: context.role,
      authenticated: true,
      context: {
        ip_address: clientIp,
        user_agent: request.headers.get("user-agent") ?? "unknown",
        timestamp: new Date(),
        ...dynamicAuthorizationContext,
      },
    };

    const decisionResult = await evaluateAuthorization(authReq);
    if (!decisionResult.allow) {
      return new Response(
        JSON.stringify({
          error: "Acceso Denegado: Privilegios insuficientes para la operación.",
          traceId: context.traceId,
          decisionId: decisionResult.decision_id,
          anomalyScore: decisionResult.anomaly_score ?? 0,
        }),
        { status: 403, headers },
      );
    }

    let parsedData: T = {} as T;
    if (bodyMethods.has(method)) {
      try {
        const rawBody = await parseSafeJsonBody(request.clone());
        const validation = schema.safeParse(rawBody);
        if (!validation.success) {
          return new Response(
            JSON.stringify({
              error: "Validación de entrada fallida.",
              details: validation.error?.message || "Esquema inválido",
            }),
            { status: 400, headers },
          );
        }
        parsedData = validation.data!;
      } catch (error) {
        const status =
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: string }).code === "BODY_TOO_LARGE"
            ? 413
            : 400;
        return new Response(
          JSON.stringify({
            error:
              status === 413
                ? "Payload excede el límite permitido."
                : "Payload corrupto detectado por la puerta de enlace.",
          }),
          { status, headers },
        );
      }
    }

    return runWithIdentity(context.toRequestIdentity(), () => handler(context, parsedData));
  }
}
