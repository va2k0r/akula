import { defineConfig } from "vite";

const CANONICAL_LOCAL_PORT = 4173;

export default defineConfig({
  base: process.env["VITE_PUBLIC_BASE"] ?? "/",
  build: {
    target: "es2022",
    sourcemap: true,
  },
  server: {
    host: "127.0.0.1",
    port: CANONICAL_LOCAL_PORT,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: CANONICAL_LOCAL_PORT,
    strictPort: true,
  },
});
