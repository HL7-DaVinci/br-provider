import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { fileURLToPath, URL } from "node:url";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    devtools(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    tsConfigPaths(),
    viteReact(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          tanstack: [
            "@tanstack/react-query",
            "@tanstack/react-router",
            "@tanstack/react-table",
          ],
          radix: ["radix-ui"],
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/login": {
        target: "http://localhost:8080",
        changeOrigin: true,
        bypass(req) {
          if (req.method === "GET") return req.url;
        },
      },
      "/auth": { target: "http://localhost:8080", changeOrigin: true },
      "/oauth2": { target: "http://localhost:8080", changeOrigin: true },
      "/fhir": { target: "http://localhost:8080", changeOrigin: true },
      "/.well-known": { target: "http://localhost:8080", changeOrigin: true },
      "/config.js": { target: "http://localhost:8080", changeOrigin: true },
      "/api": { target: "http://localhost:8080", changeOrigin: true },
      "/actuator": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
});
