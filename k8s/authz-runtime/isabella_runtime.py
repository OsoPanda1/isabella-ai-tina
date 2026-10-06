#!/usr/bin/env python3
from __future__ import annotations

"""
Isabella Scope Authorization Runtime v4 (hardened)
==================================================
Policy Decision Point (PDP) para el Trust Plane de Isabella Mexa.

Principio innegociable: los claims solo son confiables DESPUES de verificar la
firma del token. Las senales de alta garantia (assurance/step-up/dual-control/
environment) se leen DEL TOKEN VERIFICADO, nunca del request del cliente.

Modos de verificacion:
  * JWKS (RS256)  -> produccion con un IdP externo (ISABELLA_JWKS_URL).
  * Ed25519 local -> modo soberano de la app (ISABELLA_ED25519_PUBLIC_KEY).
"""

import argparse
import hashlib
import heapq
import ipaddress  # noqa: F401  (reservado para ABAC de red futuro)
import json
import os
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Mapping

import jwt
from jwt import PyJWKClient


MAX_BODY = int(os.getenv("ISABELLA_MAX_BODY", "65536"))
MAX_SCOPE_COUNT = 128
MAX_ROLE_COUNT = 16
MAX_CACHE = 10000


class AuthzError(Exception):
    def __init__(self, code: str, message: str, status: int = 403,
                 retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.retryable = retryable


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode()


def sha3(value: Any) -> str:
    return hashlib.sha3_512(canonical(value)).hexdigest()


def require(condition: bool, code: str, message: str, status: int = 403) -> None:
    if not condition:
        raise AuthzError(code, message, status)


def string(value: Any, name: str, maximum: int = 256) -> str:
    if not isinstance(value, str):
        raise AuthzError("INVALID_FIELD", f"{name} must be string", 400)
    value = value.strip()
    if not value or len(value) > maximum:
        raise AuthzError("INVALID_FIELD", f"invalid {name}", 400)
    return value


def safe_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): safe_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [safe_json(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


@dataclass(frozen=True)
class Request:
    request_id: str
    trace_id: str
    token: str
    scope: str
    resource_tenant: str | None
    environment: str
    assurance: str
    step_up: bool
    dual_control: bool
    client_ip: str | None


@dataclass(frozen=True)
class Decision:
    decision_id: str
    request_id: str
    trace_id: str
    allowed: bool
    code: str
    reason: str
    principal: str
    tenant_id: str
    required_scope: str
    matched_scope: str | None
    obligations: tuple[str, ...]
    policy_version: str
    created_at: float
    expires_at: float


class FastReplayStore:
    def __init__(self, capacity: int = 100000):
        self.capacity = capacity
        self.values: dict[str, float] = {}
        self.heap: list[tuple[float, str]] = []
        self.lock = threading.Lock()

    def consume(self, tenant: str, jti: str, exp: float) -> None:
        key = f"{tenant}:{jti}"
        now = time.time()
        with self.lock:
            while self.heap and self.heap[0][0] <= now:
                expiry, old_key = heapq.heappop(self.heap)
                if self.values.get(old_key) == expiry:
                    del self.values[old_key]
            if key in self.values:
                raise AuthzError("TOKEN_REPLAY", "token already consumed", 401)
            if len(self.values) >= self.capacity:
                raise AuthzError("REPLAY_STORE_FULL", "replay store full", 503, True)
            self.values[key] = exp
            heapq.heappush(self.heap, (exp, key))


class DecisionCache:
    def __init__(self, capacity: int = MAX_CACHE):
        self.capacity = capacity
        self.data: dict[str, tuple[float, Decision]] = {}
        self.lock = threading.Lock()

    def get(self, key: str) -> Decision | None:
        now = time.time()
        with self.lock:
            item = self.data.get(key)
            if not item:
                return None
            expiry, decision = item
            if expiry <= now:
                self.data.pop(key, None)
                return None
            return decision

    def put(self, key: str, decision: Decision, ttl: float) -> None:
        with self.lock:
            if len(self.data) >= self.capacity:
                self.data.pop(next(iter(self.data)))
            self.data[key] = (min(time.time() + ttl, decision.expires_at), decision)


class AuditStore:
    ALLOWED = {
        "eventId", "decisionId", "requestId", "traceId", "tenantHash",
        "principalHash", "requiredScope", "matchedScope", "allowed",
        "code", "policyVersion", "createdAt", "previousDigest",
    }

    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        self.db.execute("""CREATE TABLE IF NOT EXISTS audit(
            event_id TEXT PRIMARY KEY, event_json TEXT NOT NULL,
            event_digest TEXT NOT NULL, created_at REAL NOT NULL)""")
        self.db.commit()

    def append(self, decision: Decision) -> dict[str, Any]:
        with self.lock:
            row = self.db.execute(
                "SELECT event_digest FROM audit ORDER BY created_at DESC, event_id DESC LIMIT 1"
            ).fetchone()
            previous = row[0] if row else "GENESIS"
            event = {
                "eventId": f"evt-{uuid.uuid4()}",
                "decisionId": decision.decision_id,
                "requestId": decision.request_id,
                "traceId": decision.trace_id,
                "tenantHash": sha3(decision.tenant_id),
                "principalHash": sha3(decision.principal),
                "requiredScope": decision.required_scope,
                "matchedScope": decision.matched_scope,
                "allowed": decision.allowed,
                "code": decision.code,
                "policyVersion": decision.policy_version,
                "createdAt": decision.created_at,
                "previousDigest": previous,
            }
            event = {k: event[k] for k in self.ALLOWED if k in event}
            event_digest = sha3(event)
            self.db.execute(
                "INSERT INTO audit VALUES (?, ?, ?, ?)",
                (event["eventId"], json.dumps(event, sort_keys=True),
                 event_digest, decision.created_at),
            )
            self.db.commit()
            return {"event": event, "eventDigest": event_digest}


class JWTVerifier:
    """Verifica la firma del token. Dos modos: JWKS (RS256) o Ed25519 local."""

    def __init__(self, catalog: dict[str, Any]):
        from cryptography.hazmat.primitives.serialization import load_pem_public_key

        auth = catalog["authentication"]
        self.issuer = os.getenv("ISABELLA_ISSUER", auth["issuer"])
        self.audience = os.getenv("ISABELLA_AUDIENCE", auth["audience"])
        self.jwks_url = os.getenv("ISABELLA_JWKS_URL")
        self.ed25519_raw = os.getenv("ISABELLA_ED25519_PUBLIC_KEY")
        self.algorithms = set(auth.get("algorithms", ["RS256"]))
        self.clock_skew = float(auth.get("clockSkewSeconds", 5))
        self.max_lifetime = float(auth.get("maxTokenLifetimeSeconds", 900))

        self.mode = "jwks" if self.jwks_url else None
        self.jwks = PyJWKClient(self.jwks_url) if self.jwks_url else None
        self.ed25519_key = None
        if self.ed25519_raw:
            self.mode = "ed25519"
            raw = self.ed25519_raw
            if os.path.isfile(raw):
                raw = Path(raw).read_text(encoding="utf-8")
            self.ed25519_key = load_pem_public_key(raw.encode("utf-8"))
            # En modo Ed25519 el unico algoritmo aceptado es EdDSA.
            self.algorithms = {"EdDSA"}

    def verify(self, token: str) -> Mapping[str, Any]:
        if self.mode is None:
            raise AuthzError("VERIFIER_NOT_CONFIGURED",
                             "JWKS or Ed25519 public key required", 500)
        try:
            header = jwt.get_unverified_header(token)
            if header.get("alg") not in self.algorithms:
                raise AuthzError("JWT_ALGORITHM_REJECTED", "algorithm rejected", 401)

            if self.mode == "ed25519":
                claims = jwt.decode(
                    token, self.ed25519_key, algorithms=["EdDSA"],
                    issuer=self.issuer, audience=self.audience,
                    options={"require": ["iss", "aud", "sub", "jti", "iat", "exp"]},
                )
            else:
                key = self.jwks.get_signing_key_from_jwt(token).key
                claims = jwt.decode(
                    token, key, algorithms=list(self.algorithms),
                    issuer=self.issuer, audience=self.audience,
                    options={"require": ["iss", "aud", "sub", "jti", "iat", "exp"]},
                )
        except AuthzError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise AuthzError("JWT_INVALID", "token verification failed", 401) from exc

        now = time.time()
        iat = float(claims["iat"])
        exp = float(claims["exp"])
        if iat > now + self.clock_skew or exp <= now or exp - iat > self.max_lifetime:
            raise AuthzError("JWT_TIME_INVALID", "invalid token time", 401)
        if not isinstance(claims.get("roles"), list) or not claims["roles"]:
            raise AuthzError("ROLES_INVALID", "roles invalid", 401)
        if not isinstance(claims.get("scopes"), list) or len(claims["scopes"]) > MAX_SCOPE_COUNT:
            raise AuthzError("SCOPES_INVALID", "scopes invalid", 401)
        return claims


class Runtime:
    def __init__(self, catalog: dict[str, Any], verifier: JWTVerifier | None = None):
        self.catalog = catalog
        self.policy_version = catalog["policyVersion"]
        self.scopes = catalog["scopes"]
        self.roles = catalog["roles"]
        self.assurance = catalog["assuranceLevels"]
        self.jwt = verifier or JWTVerifier(catalog)
        self.replay = FastReplayStore()
        self.cache = DecisionCache()
        self.audit = AuditStore(os.getenv("ISABELLA_AUDIT_DB", "./data/audit.db"))

    def parse(self, payload: Mapping[str, Any]) -> Request:
        if len(canonical(payload)) > MAX_BODY:
            raise AuthzError("REQUEST_TOO_LARGE", "request too large", 413)
        return Request(
            string(payload.get("requestId"), "requestId", 128),
            string(payload.get("traceId"), "traceId", 128),
            string(payload.get("accessToken"), "accessToken", 8192),
            string(payload.get("requiredScope"), "requiredScope", 128),
            payload.get("resourceTenant"),
            string(payload.get("environment", "production"), "environment", 32),
            string(payload.get("assurance", "local"), "assurance", 32),
            bool(payload.get("stepUpVerified", False)),
            bool(payload.get("dualControlVerified", False)),
            payload.get("clientIp"),
        )

    def authorize(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        started = time.perf_counter()
        request_id = str(payload.get("requestId", "unknown"))
        trace_id = str(payload.get("traceId", "unknown"))
        try:
            request = self.parse(payload)
            claims = self.jwt.verify(request.token)
            tenant = string(claims.get("tenantId"), "tenantId", 128)
            principal = string(claims.get("sub"), "sub", 256)
            self.replay.consume(tenant, string(claims["jti"], "jti"), float(claims["exp"]))
            decision = self.evaluate(request, claims, tenant, principal)
            audit = self.audit.append(decision)
            return self.response(decision, audit, started)
        except AuthzError as error:
            decision = Decision(
                f"dec-{uuid.uuid4()}", request_id, trace_id, False,
                error.code, error.message, "unknown", "unknown",
                str(payload.get("requiredScope", "unknown")), None, (),
                self.policy_version, time.time(), time.time(),
            )
            audit = self.audit.append(decision)
            return self.response(decision, audit, started, error)

    def evaluate(self, request: Request, claims: Mapping[str, Any],
                 tenant: str, principal: str) -> Decision:
        # FUENTE DE VERDAD: claims verificados. Los campos del request
        # (assurance/step_up/dual_control/environment) son NO confiables y se
        # IGNORAN por completo. Si el token no emite el claim, se asume el
        # valor mas bajo (fail-closed): un token sin "aal" nunca satisface
        # scopes de alta garantia, aunque el cliente afirme aal3.
        assurance = str(claims.get("aal", "local"))
        step_up = bool(claims.get("step_up", False))
        dual_control = bool(claims.get("dual_control", False))
        environment = str(claims.get("environment", "unknown"))

        spec = self.scopes.get(request.scope)
        if not spec:
            raise AuthzError("UNKNOWN_SCOPE", "scope is not registered")
        resource_tenant = request.resource_tenant
        if spec.get("tenantBound", True) and resource_tenant not in (None, tenant):
            raise AuthzError("TENANT_BOUNDARY_VIOLATION", "cross-tenant access denied")
        granted = set(claims["scopes"])
        matched = request.scope if request.scope in granted else None
        if not matched:
            namespace = request.scope.split(":", 1)[0]
            candidate = f"{namespace}:*"
            if candidate in granted:
                matched = candidate
        if not matched:
            raise AuthzError("SCOPE_DENIED", "required scope missing")
        roles = set(claims["roles"])
        if max((self.roles.get(r, -1) for r in roles), default=-1) < self.roles.get(spec["minimumRole"], 999):
            raise AuthzError("ROLE_INSUFFICIENT", "minimum role not met")
        required_rank = self.assurance.get(spec.get("assurance", "local"), {}).get("rank", 999)
        if self.assurance.get(assurance, {}).get("rank", 0) < required_rank:
            raise AuthzError("ASSURANCE_INSUFFICIENT", "assurance level insufficient")
        if spec.get("requiresStepUp") and not step_up:
            raise AuthzError("STEP_UP_REQUIRED", "step-up required")
        if spec.get("requiresDualControl") and not dual_control:
            raise AuthzError("DUAL_CONTROL_REQUIRED", "dual control required")
        for name, condition in spec.get("conditions", {}).items():
            if condition["type"] == "environment_equals" and environment != condition["value"]:
                raise AuthzError("CONDITION_FAILED", f"condition failed: {name}")
        obligations = ["audit", "tenant-isolation"]
        if spec.get("requiresStepUp"):
            obligations.append("step-up")
        if spec.get("requiresDualControl"):
            obligations.append("dual-control")
        now = time.time()
        return Decision(
            f"dec-{uuid.uuid4()}", request.request_id, request.trace_id, True,
            "ALLOW", "policy satisfied", principal, tenant, request.scope,
            matched, tuple(obligations), self.policy_version, now,
            min(float(claims["exp"]), now + 30),
        )

    def response(self, decision: Decision, audit: dict[str, Any],
                 started: float, error: AuthzError | None = None) -> dict[str, Any]:
        result = {
            "schema": "isabella.authorization.response.v4",
            "status": "ALLOW" if decision.allowed else "DENY",
            "requestId": decision.request_id,
            "traceId": decision.trace_id,
            "decision": {
                "decisionId": decision.decision_id,
                "allowed": decision.allowed,
                "code": decision.code,
                "reason": decision.reason,
                "principal": decision.principal if decision.allowed else "redacted",
                "tenantId": decision.tenant_id if decision.allowed else "redacted",
                "requiredScope": decision.required_scope,
                "matchedScope": decision.matched_scope,
                "obligations": list(decision.obligations),
                "policyVersion": decision.policy_version,
                "expiresAt": decision.expires_at,
            },
            "audit": audit,
            "runtimeMs": round((time.perf_counter() - started) * 1000, 3),
        }
        if error:
            result["error"] = {"code": error.code, "retryable": error.retryable}
        return result


class Handler(BaseHTTPRequestHandler):
    runtime: Runtime

    def send_json(self, status: int, value: dict[str, Any]) -> None:
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self.send_json(200, {"status": "ok"})
        if self.path == "/ready":
            ready = bool(os.getenv("ISABELLA_JWKS_URL") or os.getenv("ISABELLA_ED25519_PUBLIC_KEY"))
            return self.send_json(200, {"status": "ready", "verifierConfigured": ready})
        if self.path == "/v1/diagnostics":
            return self.send_json(200, {"status": "ok", "policyVersion": self.runtime.policy_version})
        self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/v1/authorize":
            return self.send_json(404, {"error": "not_found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                raise AuthzError("REQUEST_TOO_LARGE", "invalid body", 413)
            payload = json.loads(self.rfile.read(length))
            result = self.runtime.authorize(payload)
            status = 200 if result["status"] == "ALLOW" else 403
            self.send_json(status, result)
        except AuthzError as error:
            self.send_json(error.status, {"status": "DENY", "error": {"code": error.code}})
        except Exception:  # noqa: BLE001
            self.send_json(400, {"status": "DENY", "error": {"code": "INVALID_REQUEST"}})

    def log_message(self, *_):
        return


def load_catalog(path: str) -> dict[str, Any]:
    catalog = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(catalog.get("scopes"), dict):
        raise SystemExit("catalog scopes must be an object")
    if not isinstance(catalog.get("assuranceLevels"), dict):
        raise SystemExit("catalog assuranceLevels must be an object")
    if not isinstance(catalog.get("roles"), dict):
        raise SystemExit("catalog roles must be an object")
    return catalog


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", default="catalog.json")
    parser.add_argument("--http", action="store_true")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--stdio", action="store_true")
    args = parser.parse_args()
    runtime = Runtime(load_catalog(args.catalog))
    if args.http:
        Handler.runtime = runtime
        ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
        return 0
    if args.stdio:
        for line in __import__("sys").stdin:
            if line.strip():
                print(json.dumps(runtime.authorize(json.loads(line)), ensure_ascii=False), flush=True)
        return 0
    parser.error("use --http or --stdio")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
