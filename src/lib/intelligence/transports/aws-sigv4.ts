import { createHash, createHmac } from "node:crypto";

/** AWS credentials used for SigV4 header-based signing. */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/** Input for a single SigV4-signed request. `date` makes signing deterministic. */
export interface SigV4Input {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  region: string;
  service: string;
  credentials: AwsCredentials;
  date?: string | Date;
}

/** Headers to send: caller headers plus `Authorization`, `X-Amz-*` additions. */
export interface SignedRequest {
  headers: Record<string, string>;
}

/** Intermediate SigV4 material, exported so canonicalization is directly testable. */
export interface SigV4Material {
  canonicalRequest: string;
  stringToSign: string;
  credentialScope: string;
  signature: string;
  headers: Record<string, string>;
}

/** Stable error codes raised by the signer. */
export type SigV4ErrorCode =
  | "MISSING_CREDENTIALS"
  | "INVALID_URL"
  | "INVALID_METHOD"
  | "INVALID_REGION"
  | "INVALID_SERVICE"
  | "INVALID_DATE";

/** Typed signer failure. The message always starts with the error code. */
export class SigV4Error extends Error {
  readonly code: SigV4ErrorCode;

  constructor(code: SigV4ErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "SigV4Error";
    this.code = code;
  }
}

const ALGORITHM = "AWS4-HMAC-SHA256";
const TERMINATOR = "aws4_request";

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function escapeUri(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalUri(pathname: string): string {
  const path = pathname.length > 0 ? pathname : "/";
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = path;
  }
  return decoded
    .split("/")
    .map((segment) => escapeUri(segment))
    .join("/");
}

function canonicalQueryString(url: URL): string {
  const pairs: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams) {
    pairs.push([escapeUri(key), escapeUri(value)]);
  }
  pairs.sort((left, right) => {
    if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
    return left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0;
  });
  return pairs.map(([key, value]) => `${key}=${value}`).join("&");
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function formatAmzDate(date: string | Date | undefined): string {
  const value = date === undefined ? new Date() : date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) {
    throw new SigV4Error("INVALID_DATE", `fecha no parseable: ${String(date)}`);
  }
  return `${value.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

/**
 * Compute the full SigV4 material for a request using only `node:crypto`.
 *
 * Implements the documented AWS SigV4 pipeline: canonical request (strict URI
 * encoding, sorted query, lowercased/trimmed headers, lowercase hex hashes) →
 * string to sign with credential scope `<date>/<region>/<service>/aws4_request`
 * → signing key derived through four HMAC-SHA256 iterations → hex signature.
 *
 * The signature has NOT been verified against a live AWS endpoint.
 */
export function computeSignature(input: SigV4Input): SigV4Material {
  const { accessKeyId, secretAccessKey, sessionToken } = input.credentials;
  if (!accessKeyId || !secretAccessKey) {
    throw new SigV4Error("MISSING_CREDENTIALS", "accessKeyId y secretAccessKey son obligatorios");
  }
  if (!input.region) throw new SigV4Error("INVALID_REGION", "region es obligatoria");
  if (!input.service) throw new SigV4Error("INVALID_SERVICE", "service es obligatorio");
  const method = input.method.trim().toUpperCase();
  if (!method) throw new SigV4Error("INVALID_METHOD", "method es obligatorio");

  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new SigV4Error("INVALID_URL", "url no es una URL absoluta parseable");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SigV4Error("INVALID_URL", `protocolo no soportado: ${url.protocol}`);
  }
  if (!url.hostname) throw new SigV4Error("INVALID_URL", "url sin hostname");

  const amzDate = formatAmzDate(input.date);
  const shortDate = amzDate.slice(0, 8);
  const credentialScope = `${shortDate}/${input.region}/${input.service}/${TERMINATOR}`;
  const payloadHash = sha256Hex(input.body ?? "");
  const hasSessionToken = sessionToken !== undefined && sessionToken !== "";

  const signedValues = new Map<string, string>();
  const outputHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    const lower = name.toLowerCase();
    if (lower === "authorization" || lower === "host" || lower.startsWith("x-amz-")) continue;
    const normalized = normalizeHeaderValue(value);
    const existing = signedValues.get(lower);
    signedValues.set(lower, existing === undefined ? normalized : `${existing},${normalized}`);
    if (!(name in outputHeaders)) outputHeaders[name] = normalized;
  }
  signedValues.set("host", url.host);
  signedValues.set("x-amz-date", amzDate);
  signedValues.set("x-amz-content-sha256", payloadHash);
  if (hasSessionToken && sessionToken !== undefined) {
    signedValues.set("x-amz-security-token", sessionToken);
  }

  const sortedNames = [...signedValues.keys()].sort();
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${signedValues.get(name)}\n`)
    .join("");
  const signedHeaders = sortedNames.join(";");
  const canonicalRequest = [
    method,
    canonicalUri(url.pathname),
    canonicalQueryString(url),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [ALGORITHM, amzDate, credentialScope, sha256Hex(canonicalRequest)].join(
    "\n",
  );

  const dateKey = hmacSha256(`AWS4${secretAccessKey}`, shortDate);
  const regionKey = hmacSha256(dateKey, input.region);
  const serviceKey = hmacSha256(regionKey, input.service);
  const signingKey = hmacSha256(serviceKey, TERMINATOR);
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  const authorization =
    `${ALGORITHM} Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const headers: Record<string, string> = {
    ...outputHeaders,
    Authorization: authorization,
    "X-Amz-Date": amzDate,
    "X-Amz-Content-Sha256": payloadHash,
    ...(hasSessionToken && sessionToken !== undefined
      ? { "X-Amz-Security-Token": sessionToken }
      : {}),
  };

  return { canonicalRequest, stringToSign, credentialScope, signature, headers };
}

/**
 * Sign a request with AWS SigV4 and return only the headers to send.
 *
 * Caller-supplied `authorization`, `host` and `x-amz-*` headers are replaced by
 * the computed ones (`host` always comes from the URL). Values are trimmed and
 * collapsed before signing so what is sent matches the canonical request.
 */
export function signRequest(input: SigV4Input): SignedRequest {
  return { headers: computeSignature(input).headers };
}
