import { defineConfig } from "vite";

// `pnpm dev --host` exposes the dev server on the local network so a phone on the same
// Wi-Fi can open it (Vite prints the "Network:" URL).
export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
});
