import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
    projects: [
      {
        resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
        test: {
          name: "unit",
          environment: "node",
          include: [
            "test/unit/**/*.test.ts",
            "test/unit/**/*.test.tsx",
            "test/*.test.ts",
            "test/native-ml/**/*.test.ts",
          ],
          setupFiles: ["./test/setup.ts"],
        },
      },
      {
        resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
        test: {
          name: "security",
          environment: "node",
          include: ["test/security/**/*.test.ts"],
          setupFiles: ["./test/setup.ts"],
        },
      },
      {
        resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
        test: {
          name: "bookpi",
          environment: "node",
          include: ["test/bookpi/**/*.test.ts"],
          setupFiles: ["./test/setup.ts"],
        },
      },
      {
        resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
        test: {
          name: "integration",
          environment: "node",
          include: ["test/integration/**/*.test.ts"],
          setupFiles: ["./test/setup.ts"],
        },
      },
    ],
  },
});
