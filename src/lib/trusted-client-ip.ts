/**
 * Trusted Client IP Extractor
 * -----------------------------------------------------------------
 * Los consumidores reales envían dos formas de request: `IncomingMessage`
 * (Node/HTTP) y `Request` (Fetch API de las rutas). Ambas se leen con la
 * misma precedencia: x-forwarded-for → x-real-ip → socket / 127.0.0.1.
 */
import type { IncomingMessage } from "node:http";

type ClientIpRequest = IncomingMessage | Request;

function readHeader(req: ClientIpRequest, name: string): string | undefined {
  if ("socket" in req) {
    const value = req.headers[name];
    return typeof value === "string" ? value : undefined;
  }
  return req.headers.get(name) ?? undefined;
}

export function getTrustedClientIp(req: ClientIpRequest): string {
  const forwardedFor = readHeader(req, "x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = readHeader(req, "x-real-ip");
  if (realIp && realIp.trim().length > 0) {
    return realIp.trim();
  }
  if ("socket" in req) return req.socket?.remoteAddress || "127.0.0.1";
  return "127.0.0.1";
}

export { getTrustedClientIp as resolveTrustedClientIp };

export default getTrustedClientIp;
