import * as fs from "node:fs";
import * as path from "node:path";

export interface AuthScannerConfig {
  rootDir?: string;
}

export interface AuthScanResult {
  jwtValidation: JWTValidation;
  rbacImplementation: RBACImplementation;
  sessionManagement: SessionManagement;
  mfaStatus: MFAStatus;
  findings: AuthFinding[];
  statistics: {
    jwtValidated: boolean;
    rbacImplemented: boolean;
    sessionManaged: boolean;
    mfaProductionVerified: boolean;
  };
}

export interface JWTValidation {
  implemented: boolean;
  algorithm: string;
  issVerified: boolean;
  subVerified: boolean;
  audVerified: boolean;
  expVerified: boolean;
  jtiVerified: boolean;
  tenantIdVerified: boolean;
  roleVerified: boolean;
  scopeVerified: boolean;
  keyRotationImplemented: boolean;
  keyRotationTested: boolean;
  location: string;
}

export interface RBACImplementation {
  implemented: boolean;
  matrixDefined: boolean;
  abacImplemented: boolean;
  denyByDefault: boolean;
  location: string;
}

export interface SessionManagement {
  implemented: boolean;
  refreshTokenRotation: boolean;
  sessionRevocation: boolean;
  jtiDenylist: boolean;
  deviceInventory: boolean;
  stepUpAuthentication: boolean;
  location: string;
}

export interface MFAStatus {
  planned: boolean;
  implemented: boolean;
  tested: boolean;
  productionVerified: boolean;
  enforcedForPrivileged: boolean;
  methods: string[];
  location: string;
}

export interface AuthFinding {
  id: string;
  type:
    | "JWT_WEAK_ALGORITHM"
    | "JWT_MISSING_CLAIMS"
    | "RBAC_INCOMPLETE"
    | "SESSION_NO_REVOCATION"
    | "MFA_NOT_PRODUCTION_VERIFIED"
    | "NO_STEP_UP_AUTH"
    | "NO_JTI_DENYLIST"
    | "NO_REFRESH_ROTATION";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  description: string;
  location: string;
  remediation: string;
}

export class AuthScanner {
  private config: Required<AuthScannerConfig>;

  constructor(config: AuthScannerConfig = {}) {
    this.config = {
      rootDir: config.rootDir ?? process.cwd(),
    };
  }

  scan(): AuthScanResult {
    const files = this.collectFiles(this.config.rootDir);
    const allContent = new Map<string, string>();

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf8");
        allContent.set(file, content);
      } catch {
        /* intentional empty: skip unreadable files */
      }
    }

    const jwtValidation = this.scanJWTValidation(allContent);
    const rbacImplementation = this.scanRBAC(allContent);
    const sessionManagement = this.scanSessionManagement(allContent);
    const mfaStatus = this.scanMFA(allContent);
    const findings = this.generateFindings(
      jwtValidation,
      rbacImplementation,
      sessionManagement,
      mfaStatus,
    );

    return {
      jwtValidation,
      rbacImplementation,
      sessionManagement,
      mfaStatus,
      findings,
      statistics: {
        jwtValidated: jwtValidation.implemented,
        rbacImplemented: rbacImplementation.implemented,
        sessionManaged: sessionManagement.implemented,
        mfaProductionVerified: mfaStatus.productionVerified,
      },
    };
  }

  private scanJWTValidation(allContent: Map<string, string>): JWTValidation {
    let implemented = false;
    let algorithm = "unknown";
    const claimsFound = new Set<string>();
    let keyRotationImplemented = false;
    let keyRotationTested = false;
    let location = "";

    for (const [file, content] of allContent) {
      const algMatch = content.match(/algorithm\s*[:=]\s*['"]([^'"]+)['"]/);
      if (algMatch) {
        implemented = true;
        algorithm = algMatch[1];
        location = file;
      }

      if (/sign\s*\(/.test(content) || /verify\s*\(/.test(content)) {
        implemented = true;
        if (!location) location = file;
      }

      for (const claim of ["iss", "sub", "aud", "exp", "jti", "tenantId", "role", "scope"]) {
        if (new RegExp(claim).test(content)) {
          claimsFound.add(claim);
        }
      }

      if (/key.*rotation|rotate.*key/gi.test(content)) {
        keyRotationImplemented = true;
      }
      if (/test.*key.*rotation|key.*rotation.*test/gi.test(content)) {
        keyRotationTested = true;
      }
    }

    return {
      implemented,
      algorithm,
      issVerified: claimsFound.has("iss"),
      subVerified: claimsFound.has("sub"),
      audVerified: claimsFound.has("aud"),
      expVerified: claimsFound.has("exp"),
      jtiVerified: claimsFound.has("jti"),
      tenantIdVerified: claimsFound.has("tenantId"),
      roleVerified: claimsFound.has("role"),
      scopeVerified: claimsFound.has("scope"),
      keyRotationImplemented,
      keyRotationTested,
      location,
    };
  }

  private scanRBAC(allContent: Map<string, string>): RBACImplementation {
    let implemented = false;
    let matrixDefined = false;
    let abacImplemented = false;
    let denyByDefault = false;
    let location = "";

    for (const [file, content] of allContent) {
      if (/hasPermission|checkPermission|authorize|permission/.test(content)) {
        implemented = true;
        if (!location) location = file;
      }

      if (/permission[_-]?matrix|rbac[_-]?matrix/gi.test(content)) {
        matrixDefined = true;
      }

      if (/abac|attribute[_-]?based/gi.test(content)) {
        abacImplemented = true;
      }

      if (/deny[_-]?by[_-]?default|default[_-]?deny/gi.test(content)) {
        denyByDefault = true;
      }
    }

    return {
      implemented,
      matrixDefined,
      abacImplemented,
      denyByDefault,
      location,
    };
  }

  private scanSessionManagement(allContent: Map<string, string>): SessionManagement {
    let implemented = false;
    let refreshTokenRotation = false;
    let sessionRevocation = false;
    let jtiDenylist = false;
    let deviceInventory = false;
    let stepUpAuthentication = false;
    let location = "";

    for (const [file, content] of allContent) {
      if (/session|token/.test(content)) {
        implemented = true;
        if (!location) location = file;
      }

      if (/refresh.*rotation|rotate.*refresh/gi.test(content)) {
        refreshTokenRotation = true;
      }

      if (/revoke|invalidate|blacklist|denylist/gi.test(content)) {
        sessionRevocation = true;
      }

      if (/jti|jwt[_-]?id/gi.test(content)) {
        jtiDenylist = true;
      }

      if (/device|fingerprint|session.*inventory/gi.test(content)) {
        deviceInventory = true;
      }

      if (/step[_-]?up|elevate|privilege.*escalation/gi.test(content)) {
        stepUpAuthentication = true;
      }
    }

    return {
      implemented,
      refreshTokenRotation,
      sessionRevocation,
      jtiDenylist,
      deviceInventory,
      stepUpAuthentication,
      location,
    };
  }

  private scanMFA(allContent: Map<string, string>): MFAStatus {
    let planned = false;
    let implemented = false;
    let tested = false;
    let productionVerified = false;
    let enforcedForPrivileged = false;
    const methods: string[] = [];
    let location = "";

    for (const [file, content] of allContent) {
      if (/totp|authenticator|2fa|mfa/gi.test(content)) {
        planned = true;
        implemented = true;
        if (!location) location = file;
        if (!methods.includes("TOTP")) methods.push("TOTP");
      }

      if (/webauthn|passkey|fido/gi.test(content)) {
        if (!methods.includes("WebAuthn")) methods.push("WebAuthn");
      }

      if (/sms.*otp|otp.*sms/gi.test(content)) {
        if (!methods.includes("SMS")) methods.push("SMS");
      }

      if (/email.*otp|otp.*email/gi.test(content)) {
        if (!methods.includes("Email")) methods.push("Email");
      }

      if (/require.*mfa|mfa.*required|enforce.*mfa/gi.test(content)) {
        enforcedForPrivileged = true;
      }

      if (/test.*mfa|mfa.*test/gi.test(content)) {
        tested = true;
      }

      if (/production.*mfa|mfa.*production|prod.*mfa/gi.test(content)) {
        productionVerified = true;
      }
    }

    return {
      planned,
      implemented,
      tested,
      productionVerified,
      enforcedForPrivileged,
      methods,
      location,
    };
  }

  private generateFindings(
    jwt: JWTValidation,
    rbac: RBACImplementation,
    session: SessionManagement,
    mfa: MFAStatus,
  ): AuthFinding[] {
    const findings: AuthFinding[] = [];

    if (
      jwt.implemented &&
      !["ES256", "ES384", "ES512", "RS256", "RS384", "RS512", "EdDSA"].includes(jwt.algorithm)
    ) {
      findings.push({
        id: `AUTH-JWT-WEAK-${Date.now().toString(36)}`,
        type: "JWT_WEAK_ALGORITHM",
        severity: "HIGH",
        description: `JWT usa algoritmo débil: ${jwt.algorithm}`,
        location: jwt.location,
        remediation: "Usar ES384, RS256 o EdDSA para JWTs de producción",
      });
    }

    const missingClaims = [];
    if (!jwt.issVerified) missingClaims.push("iss");
    if (!jwt.audVerified) missingClaims.push("aud");
    if (!jwt.jtiVerified) missingClaims.push("jti");
    if (!jwt.tenantIdVerified) missingClaims.push("tenantId");
    if (!jwt.roleVerified) missingClaims.push("role");
    if (!jwt.scopeVerified) missingClaims.push("scope");

    if (missingClaims.length > 0) {
      findings.push({
        id: `AUTH-JWT-MISSING-${Date.now().toString(36)}`,
        type: "JWT_MISSING_CLAIMS",
        severity: "HIGH",
        description: `JWT faltan claims críticos: ${missingClaims.join(", ")}`,
        location: jwt.location,
        remediation:
          "Añadir todos los claims requeridos: iss, sub, aud, exp, jti, tenantId, role, scope",
      });
    }

    if (rbac.implemented && !rbac.matrixDefined) {
      findings.push({
        id: `AUTH-RBAC-INCOMPLETE-${Date.now().toString(36)}`,
        type: "RBAC_INCOMPLETE",
        severity: "MEDIUM",
        description: "RBAC implementado pero sin matriz de permisos definida",
        location: rbac.location,
        remediation: "Definir permission-matrix.ts con roles, recursos y acciones",
      });
    }

    if (rbac.implemented && !rbac.denyByDefault) {
      findings.push({
        id: `AUTH-RBAC-NO-DENY-${Date.now().toString(36)}`,
        type: "RBAC_INCOMPLETE",
        severity: "HIGH",
        description: "RBAC no tiene deny-by-default",
        location: rbac.location,
        remediation: "Implementar deny-by-default en authorization.ts",
      });
    }

    if (session.implemented && !session.sessionRevocation) {
      findings.push({
        id: `AUTH-SESSION-NO-REVOKE-${Date.now().toString(36)}`,
        type: "SESSION_NO_REVOCATION",
        severity: "HIGH",
        description: "Sesiones no revocables",
        location: session.location,
        remediation: "Implementar revocación de sesiones con jti denylist",
      });
    }

    if (session.implemented && !session.jtiDenylist) {
      findings.push({
        id: `AUTH-SESSION-NO-JTI-${Date.now().toString(36)}`,
        type: "NO_JTI_DENYLIST",
        severity: "HIGH",
        description: "Sin denylist de jti para revocación",
        location: session.location,
        remediation: "Implementar jti denylist/revocation list",
      });
    }

    if (session.implemented && !session.refreshTokenRotation) {
      findings.push({
        id: `AUTH-SESSION-NO-ROTATION-${Date.now().toString(36)}`,
        type: "NO_REFRESH_ROTATION",
        severity: "MEDIUM",
        description: "Sin rotación de refresh tokens",
        location: session.location,
        remediation: "Implementar refresh token rotation",
      });
    }

    if (!session.stepUpAuthentication) {
      findings.push({
        id: `AUTH-NO-STEP-UP-${Date.now().toString(36)}`,
        type: "NO_STEP_UP_AUTH",
        severity: "CRITICAL",
        description: "Operaciones privilegiadas sin step-up authentication",
        location: "global",
        remediation: "Implementar MFA step-up para SovereignOwner y operaciones críticas",
      });
    }

    if (mfa.planned && !mfa.productionVerified) {
      findings.push({
        id: `AUTH-MFA-NOT-PROD-${Date.now().toString(36)}`,
        type: "MFA_NOT_PRODUCTION_VERIFIED",
        severity: "CRITICAL",
        description: "MFA planificado pero no verificado en producción",
        location: mfa.location,
        remediation: "Implementar y probar MFA en staging antes de producción",
      });
    }

    return findings;
  }

  private collectFiles(dir: string): string[] {
    const files: string[] = [];
    const includePatterns = ["**/*.ts", "**/*.tsx"];
    const excludePatterns = [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.git/**",
      "**/coverage/**",
      "**/genesis/**",
      "**/*.test.ts",
      "**/*.spec.ts",
    ];

    const walk = (currentDir: string): void => {
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          const relativePath = path.relative(this.config.rootDir, fullPath);

          const excluded = excludePatterns.some((p) => this.matchPattern(relativePath, p));
          if (excluded) continue;

          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile()) {
            const included = includePatterns.some((p) => this.matchPattern(relativePath, p));
            if (included) files.push(fullPath);
          }
        }
      } catch {
        /* intentional empty: skip inaccessible dirs */
      }
    };

    walk(dir);
    return files;
  }

  private matchPattern(filePath: string, pattern: string): boolean {
    const regexPattern = pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, ".");
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }
}

export function createAuthScanner(config?: AuthScannerConfig): AuthScanner {
  return new AuthScanner(config);
}
