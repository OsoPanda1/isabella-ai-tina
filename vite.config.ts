import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ command }) => {
  const isBuild = command === "build";
  return {
    oxc: {
      jsx: {
        runtime: "automatic",
        importSource: "react",
        ...(isBuild ? { development: false } : {}),
        // jsxDev: false is enforced by OXC in production; keep this contract explicit for audits.
      },
    },
    plugins: [
      {
        name: "browser-node-crypto-shim",
        enforce: "pre",
        resolveId(id, _importer, options) {
          if (!options?.ssr && id === "node:crypto") {
            return fileURLToPath(new URL("./src/lib/browser-node-crypto.ts", import.meta.url));
          }
          return null;
        },
      },
      tanstackStart(),
      nitro(),
      react(),
      tailwindcss(),
    ],
    resolve: {
      tsconfigPaths: true,
      alias: {
        "server-only": "vite/client",
      },
    },
    server: {
      host: "0.0.0.0",
      port: 3000,
      strictPort: true,
      // The hosted preview uses the Express middleware server; do not start
      // Vite's separate HMR socket on the shared 24678 port.
      hmr: false,
    },
    build: {
      target: "esnext",
      minify: "esbuild",
      sourcemap: false,
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) {
              if (id.includes("@tanstack")) return "vendor-tanstack";
              if (id.includes("react") || id.includes("react-dom")) return "vendor-react";
              if (id.includes("@radix-ui")) return "vendor-radix";
              if (id.includes("three") || id.includes("@react-three")) return "vendor-3d";
              if (id.includes("recharts")) return "vendor-charts";
              if (id.includes("lucide-react")) return "vendor-icons";
              if (id.includes("framer-motion")) return "vendor-motion";
              return "vendor";
            }
            return undefined;
          },
        },
      },
    },
    ssr: {
      noExternal: [],
      external: ["three"],
    },
  };
});
