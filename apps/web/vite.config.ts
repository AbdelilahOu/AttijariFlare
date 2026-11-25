import { fileURLToPath } from "node:url";

import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { fileRoutes } from "filesystem-routing/vite";
import { defineConfig } from "vite-plus";

export default defineConfig(({ command }) => {
  const cloudflareWorkersAlias: Record<string, string> =
    command === "serve" && process.env.ALCHEMY_CLOUDFLARE_VITE_INJECTED !== "1"
      ? {
          "cloudflare:workers": fileURLToPath(
            new URL("./cloudflare-workers.dev.ts", import.meta.url),
          ),
        }
      : {};

  return {
    optimizeDeps: {
      entries: ["src/**/*.tsx"],
    },
    plugins: [
      solid({
        start: { middleware: "./src/middleware.ts" },
        ssr: true,
        extensions: [".jsx", ".tsx"],
      }),
      fileRoutes({ httpMethods: true }),
      tailwindcss(),
    ],
    server: {
      port: 3001,
    },
    build: {
      rollupOptions: {
        external: ["cloudflare:workers"],
      },
    },
    ssr: {
      noExternal: ["solid-js", /^@solidjs\//, "@tanstack/solid-query"],
    },
    resolve: {
      tsconfigPaths: true,
      alias: cloudflareWorkersAlias,
    },
  };
});
