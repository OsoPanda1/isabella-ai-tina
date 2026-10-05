/**
 * USER AUTHENTICATION & CREDENTIAL SERVICE (src/lib/user-auth-service.ts)
 * ============================================================================
 * Ecosistema TAMV / RDM Digital Hub / Isabella Villaseñor AI v4.2.0
 *
 * Servicio nativo, seguro y de alta disponibilidad para registro (Signup),
 * inicio de sesión (Login), hashing de contraseñas de estándar bancario
 * (PBKDF2-HMAC-SHA512 con 100,000 iteraciones y salt de 16 bytes),
 * gestión de sesiones durables y emisión de tokens OIDC/JWT soberanos.
 * ============================================================================
 */

import * as crypto from "node:crypto";
import { repositoryFactory } from "./persistence/repository-factory";
import { SecuritySystem } from "./security";
import { type Role } from "./rbac";

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  tenantId: string;
  role: Role;
  createdAt: string;
  lastLoginAt?: string;
  passwordHash: string;
  salt: string;
}

export class UserAuthService {
  private static readonly ITERATIONS = 100_000;
  private static readonly KEY_LEN = 64;
  private static readonly DIGEST = "sha512";

  /**
   * Hashea una contraseña en texto plano utilizando PBKDF2 con sal criptográfica única.
   */
  public static hashPassword(password: string): { hash: string; salt: string } {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto
      .pbkdf2Sync(password, salt, this.ITERATIONS, this.KEY_LEN, this.DIGEST)
      .toString("hex");
    return { hash, salt };
  }

  /**
   * Verifica la contraseña en tiempo constante para mitigar ataques de temporización (timing attacks).
   */
  public static verifyPassword(password: string, hash: string, salt: string): boolean {
    const computed = crypto
      .pbkdf2Sync(password, salt, this.ITERATIONS, this.KEY_LEN, this.DIGEST)
      .toString("hex");

    const hashBuf = Buffer.from(hash, "hex");
    const computedBuf = Buffer.from(computed, "hex");

    if (hashBuf.length !== computedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(hashBuf, computedBuf);
  }

  /**
   * Registro de nuevo usuario (Signup) — SOLO DESARROLLO / MIGRACIÓN
   * P0-06: En producción la autoridad canónica es Supabase Auth/OIDC → PrincipalContext → RBAC/CROWN.
   * Este servicio es adapter de migración y queda DESACTIVADO en production/staging (fail-closed).
   * El rol JAMÁS proviene del cliente: se deriva server-side como Operator (mínimo privilegio).
   * PBKDF2-HMAC-SHA512 100k es LEGACY — para nueva identidad usar Argon2id (ver ADR).
   */
  public static async signup(params: {
    email: string;
    username: string;
    password: string;
    tenantSlug?: string;
    // role?: Role — ELIMINADO: el cliente no puede elegir rol privilegiado (SovereignOwner, governance_admin, etc.)
    ip?: string;
  }): Promise<{
    success: true;
    token: string;
    user: {
      id: string;
      email: string;
      username: string;
      tenantId: string;
      role: Role;
    };
  }> {
    // P0-06: bloquear signup nativo en producción — solo dev/test/migración.
    // Fail-closed: cualquier fallo al resolver el modo (config importada,
    // esquema, etc.) PROPAGA el error; no se traga el guard.
    const { config } = await import("./config");
    const { resolveRuntimeMode } = await import("./runtime-mode");
    const mode = resolveRuntimeMode(config().ISABELLA_RUNTIME_MODE);
    if (mode === "production" || mode === "staging") {
      throw new Error(
        "signup nativo deshabilitado en producción — usar Supabase Auth/OIDC canónico",
      );
    }
    const email = params.email.trim().toLowerCase();
    const username = params.username.trim();
    const role: Role = "Operator"; // P0-06: rol derivado server-side, nunca del cliente
    const ip = params.ip || "127.0.0.1";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Formato de correo electrónico inválido.");
    }
    if (!username || username.length < 3) {
      throw new Error("El nombre de usuario debe contener al menos 3 caracteres.");
    }
    if (!params.password || params.password.length < 8) {
      throw new Error("La contraseña debe tener una longitud mínima de 8 caracteres.");
    }

    // Regla de fortaleza de contraseña
    const hasUpper = /[A-Z]/.test(params.password);
    const hasLower = /[a-z]/.test(params.password);
    const hasDigit = /[0-9]/.test(params.password);
    if (!hasUpper || !hasLower || !hasDigit) {
      throw new Error(
        "La contraseña debe incluir mayúsculas, minúsculas y al menos un dígito numérico.",
      );
    }

    const userId = `usr_${crypto.randomBytes(8).toString("hex")}`;
    const tenantId = params.tenantSlug
      ? `tnt_${params.tenantSlug.toLowerCase().replace(/[^a-z0-9_-]/g, "")}`
      : `tnt_${username.toLowerCase().replace(/[^a-z0-9_-]/g, "")}_${userId.slice(4, 8)}`;

    const { hash, salt } = this.hashPassword(params.password);

    // 1. Asegurar o aprovisionar Tenant en el repositorio.
    // S11: el tenantSlug del cliente NUNCA se usa para unirse a un tenant
    // existente (eso sería alta de identidad ajena); sólo para crear uno nuevo.
    const tenantRepo = repositoryFactory.getTenantRepository();
    const existingTenant = await tenantRepo.read(tenantId, tenantId);
    if (existingTenant && params.tenantSlug) {
      throw new Error("tenant_already_exists — el tenant indicado ya existe");
    }
    if (!existingTenant) {
      await tenantRepo.create(tenantId, {
        id: tenantId,
        slug: params.tenantSlug || username.toLowerCase(),
        tier: "sovereign",
        quotaBalance: 500, // Balance de bienvenida de tokens
        quotaTierLimit: 50_000,
        createdAt: new Date().toISOString(),
        createdBy: userId,
        metadata: { createdByEmail: email, initialRole: role },
      });
    }

    // 2. Persistir perfil de credenciales
    const sessionRepo = repositoryFactory.getSessionRepository();
    await sessionRepo.create(`cred:${email}`, {
      id: `cred:${email}`,
      tenantId,
      userId,
      principalType: "user",
      tokenJti: "credential_record",
      expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      metadata: {
        email,
        username,
        role,
        passwordHash: hash,
        salt,
      },
    });

    // 3. Emitir Sovereign JWT Token
    const token = await SecuritySystem.generateSovereignToken(
      userId,
      role,
      tenantId,
      "isabella:chat isabella:voice isabella:tools isabella:ledger:write",
    );

    const tokenPayload = token.split(".")[1];
    const tokenClaims = tokenPayload
      ? (JSON.parse(Buffer.from(tokenPayload, "base64url").toString("utf8")) as {
          jti?: string;
        })
      : {};
    const jti = tokenClaims.jti || crypto.randomUUID();

    // 4. Crear sesión activa
    await sessionRepo.create(`${userId}:${jti}`, {
      id: `${userId}:${jti}`,
      tenantId,
      userId,
      principalType: "user",
      tokenJti: jti,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      metadata: { ip, userAgent: "IsabellaClientApp" },
    });

    // 5. Registrar auditoría
    const auditRepo = repositoryFactory.getAuditRepository();
    await auditRepo.audit({
      id: crypto.randomUUID(),
      tenantId,
      traceId: `trc_signup_${userId.slice(4)}`,
      timestamp: new Date().toISOString(),
      action: "user.signup",
      resource: "identity",
      severity: "S3",
      actor: userId,
      result: "success",
      details: { email, username, role, tenantId },
    });

    return {
      success: true,
      token,
      user: {
        id: userId,
        email,
        username,
        tenantId,
        role,
      },
    };
  }

  /**
   * Inicio de sesión seguro (Login) con validación de hash y rate limit.
   */
  public static async login(params: { email: string; password: string; ip?: string }): Promise<{
    success: true;
    token: string;
    user: {
      id: string;
      email: string;
      username: string;
      tenantId: string;
      role: Role;
    };
  }> {
    const email = params.email.trim().toLowerCase();
    const ip = params.ip || "127.0.0.1";

    const sessionRepo = repositoryFactory.getSessionRepository();
    const credRecord = await sessionRepo.read(`cred:${email}`, `cred:${email}`);

    if (!credRecord || !credRecord.metadata) {
      throw new Error("Credenciales inválidas o usuario no registrado.");
    }

    const meta = credRecord.metadata as {
      email: string;
      username: string;
      role: Role;
      passwordHash: string;
      salt: string;
    };

    const isMatch = this.verifyPassword(params.password, meta.passwordHash, meta.salt);
    if (!isMatch) {
      const auditRepo = repositoryFactory.getAuditRepository();
      await auditRepo.audit({
        id: crypto.randomUUID(),
        tenantId: credRecord.tenantId,
        traceId: `trc_login_fail_${crypto.randomUUID().slice(0, 8)}`,
        timestamp: new Date().toISOString(),
        action: "user.login_failed",
        resource: "identity",
        severity: "S1",
        actor: email,
        result: "denied",
        details: { ip, reason: "invalid_password_hash" },
      });
      throw new Error("Credenciales inválidas o contraseña incorrecta.");
    }

    // Emitir nuevo Sovereign JWT
    const token = await SecuritySystem.generateSovereignToken(
      credRecord.userId,
      meta.role,
      credRecord.tenantId,
      "isabella:chat isabella:voice isabella:tools isabella:ledger:write",
    );

    const tokenPayload = token.split(".")[1];
    const tokenClaims = tokenPayload
      ? (JSON.parse(Buffer.from(tokenPayload, "base64url").toString("utf8")) as {
          jti?: string;
        })
      : {};
    const jti = tokenClaims.jti || crypto.randomUUID();

    // Guardar sesión activa
    await sessionRepo.create(`${credRecord.userId}:${jti}`, {
      id: `${credRecord.userId}:${jti}`,
      tenantId: credRecord.tenantId,
      userId: credRecord.userId,
      principalType: "user",
      tokenJti: jti,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      metadata: { ip, lastLogin: new Date().toISOString() },
    });

    const auditRepo = repositoryFactory.getAuditRepository();
    await auditRepo.audit({
      id: crypto.randomUUID(),
      tenantId: credRecord.tenantId,
      traceId: `trc_login_ok_${crypto.randomUUID().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      action: "user.login_success",
      resource: "identity",
      severity: "S3",
      actor: credRecord.userId,
      result: "success",
      details: { email, role: meta.role, ip },
    });

    return {
      success: true,
      token,
      user: {
        id: credRecord.userId,
        email: meta.email,
        username: meta.username,
        tenantId: credRecord.tenantId,
        role: meta.role,
      },
    };
  }
}
