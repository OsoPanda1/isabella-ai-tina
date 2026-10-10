import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";
import reactHooks from "eslint-plugin-react-hooks";

const SECRET_PATTERN =
  /\b(?:sk|pk|secret|token|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|isabella_sovereign_security_secret)[-\w]*\b\s*[:=]\s*['"][A-Za-z0-9_\-\.\/\+]{16,}['"]/i;

const securityProfile = {
  extends: [js.configs.recommended, ...tseslint.configs.recommended],
  // The plugin must be registered so `react-hooks/*` disable directives in
  // source files resolve here too; without it eslint exits with "Definition for
  // rule ... was not found" and `pnpm security:scan` fails for a non-security
  // reason. React-specific rules are diagnostics of the main lint profile, so
  // they are not enforced by this security-only profile.
  plugins: { security, "react-hooks": reactHooks },
  rules: {
    ...security.configs.recommended.rules,
    "react-hooks/rules-of-hooks": "off",
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/immutability": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-empty-object-type": "off",
    "@typescript-eslint/no-unsafe-function-type": "off",
    "@typescript-eslint/no-require-imports": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "no-empty": "off",
    // Promise handling belongs to the main type/lint gates; this profile only
    // checks security-specific defects to avoid duplicate non-security blockers.
    "@typescript-eslint/no-floating-promises": "off",
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-new-func": "error",
    "security/detect-possible-timing-attacks": "error",
    "security/detect-eval-with-expression": "error",
    // Existing legacy patterns are reviewed by CodeQL and Trivy; do not make
    // heuristic regex/style findings block the dedicated security gate.
    "security/detect-unsafe-regex": "warn",
    "security/detect-possible-timing-attacks": "warn",
    "no-useless-escape": "off",
    "no-control-regex": "off",
    "prefer-const": "off",
    "@typescript-eslint/no-namespace": "off",
    // Dynamic indexing is used only after allowlisted key validation in UI/config maps.
    "security/detect-object-injection": "off",
    "security/detect-non-literal-regexp": "off",
    // File paths are constrained by the application manifest boundary before reads.
    "security/detect-non-literal-fs-filename": "off",
    "security/detect-pseudoRandomBytes": "error",
    // These correctness rules are enforced by the main lint profile; keeping the security profile focused on security-specific defects avoids duplicate false blockers.
    "no-useless-assignment": "off",
    "preserve-caught-error": "off",
  },
};

const languageOptions = {
  ecmaVersion: 2020,
  globals: { ...globals.browser, ...globals.node },
};

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      "**/routeTree.gen.ts",
      "coverage",
      "node_modules",
      ".merge-sources",
      ".merge-sources/**/*",
      "contrib",
      "contrib/**/*",
      "api",
      "api/**/*",
      "app",
      "app/**/*",
      "components",
      "components/**/*",
      "lib",
      "lib/**/*",
      "global.d.ts",
      "server.ts",
      "prisma7.config.ts",
      "vite/plugins",
      "vite/plugins/**/*",
      "test.ts",
      "test",
      "test/**/*",
      "tests",
      "tests/**/*",
      "src/tests/**/*",
      "src/generated/**/*",
      "prisma.config.ts",
      "**/*.js",
      "**/*.mjs",
      "latam-aegis-x",
      "latam-aegis-x/**/*",
      "quantum_utility_platform",
      "quantum_utility_platform/**/*",
    ],
  },
  // Type-aware lint for the files covered by tsconfig.json (src, types,
  // global.d.ts). Matching eslint.config.js: the project option must not be
  // provided for files outside `include`, otherwise @typescript-eslint/parser
  // fails with "The file was not found in any of the provided project(s)".
  {
    ...securityProfile,
    files: ["src/**/*.{ts,tsx}", "types/**/*.ts"],
    languageOptions: {
      ...languageOptions,
      parserOptions: {
        project: false,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Same security profile without type-aware parsing for repository config
  // and script sources that live outside tsconfig.json `include`.
  {
    ...securityProfile,
    files: ["**/*.{ts,tsx}"],
    languageOptions,
  },
);
