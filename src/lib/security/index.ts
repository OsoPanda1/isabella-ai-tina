/**
 * Isabella — Security Module Barrel Exports
 *
 * Módulo completo de seguridad: autenticación criptográfica,
 * API keys, headers, sanitización y más.
 */

// Crypto
export {
  generateSecureRandom,
  generateRandomHex,
  generateSecureUUID,
  generate512ByteKey,
  derive512ByteKey,
  create512ByteKeyFromEntropy,
  createHMAC512,
  verifyHMAC512,
  sha512,
  sha256,
  createHMAC256,
  verifyHMAC256,
  encrypt512,
  decrypt512,
  hashPassword,
  verifyPassword,
  generateSessionToken,
  generateCSRFToken,
  generateSignedToken,
  verifySignedToken,
  CRYPTO_CONSTANTS,
  type EncryptionResult,
} from "./crypto";

// API Keys
export {
  generateAPIKey,
  createAPIKeyRecord,
  generateMasterKey,
  generateSigningKey,
  hashAPIKey,
  verifyAPIKey,
  extractKeyPrefix,
  isAPIKeyFormat,
  validateAPIKey,
  apiKeyStore,
  rotateAPIKey,
  getAPIKeySummary,
  createDemoAPIKey,
  type APIKey,
  type APIKeyScope,
  type RateLimitConfig,
  type GeneratedAPIKey,
  type APIKeyValidationResult,
} from "./api-keys";

// Auth
export {
  authenticateAPIKey,
  authenticateSession,
  authenticateHMAC,
  authenticateInternal,
  hasScope,
  hasAllScopes,
  hasAnyScope,
  authMiddleware,
  rateLimiter,
  checkRateLimit,
  sanitizeForLogging,
  redactSensitiveFields,
  isTimestampValid,
  signRequest,
  type AuthContext,
  type AuthMiddlewareOptions,
  type HMACRequest,
} from "./auth";

// Headers & Sanitization
export {
  getSecurityHeaders,
  generateCSPNonce,
  getCSPWithNonce,
  sanitizeXSS,
  stripHTML,
  sanitizeFilename,
  sanitizeSQL,
  sanitizeURL,
  sanitizeInput,
  isValidEmail,
  isValidUUID,
  isValidHex,
  isValidBase64,
  isValidBase64URL,
  isValidJSON,
  getClientIP,
  getRateLimitKey,
  sanitizeForLogging as sanitizeForLoggingHeaders,
  createSecureLogEntry,
  SECURITY_CONSTANTS,
  type SecurityHeaders,
} from "./headers";
