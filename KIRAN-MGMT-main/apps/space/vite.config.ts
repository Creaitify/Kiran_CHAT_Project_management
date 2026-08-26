import path from "node:path";
import * as dotenv from "dotenv";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { joinUrlPath } from "@plane/utils";

dotenv.config({ path: path.resolve(__dirname, ".env") });

// Expose only vars starting with VITE_
const viteEnv = Object.keys(process.env)
  .filter((k) => k.startsWith("VITE_"))
  .reduce<Record<string, string>>((a, k) => {
    a[k] = process.env[k] ?? "";
    return a;
  }, {});

const basePath = joinUrlPath(process.env.VITE_SPACE_BASE_PATH ?? "", "/") ?? "/";

export default defineConfig(() => ({
  base: basePath,
  define: {
    "process.env": JSON.stringify(viteEnv),
  },
  build: {
    assetsInlineLimit: 0,
  },
  plugins: [
    // Visiting the base path without its trailing slash (/spaces) otherwise hits
    // Vite's "did you mean /spaces/?" notice instead of the app.
    {
      name: "kcms-base-path-redirect",
      configureServer(server) {
        const bare = basePath.replace(/\/$/, "");
        if (!bare) return;
        server.middlewares.use((req, res, next) => {
          const [pathname, query] = (req.url ?? "").split("?");
          if (pathname === bare || pathname === "/") {
            res.writeHead(302, { Location: `${basePath}${query ? `?${query}` : ""}` });
            res.end();
            return;
          }
          next();
        });
      },
    },
    reactRouter(),
    tsconfigPaths({ projects: [path.resolve(__dirname, "tsconfig.json")] }),
  ],
  resolve: {
    alias: {
      // Next.js compatibility shims used within space
      "next/navigation": path.resolve(__dirname, "app/compat/next/navigation.ts"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "127.0.0.1",
  },
}));
