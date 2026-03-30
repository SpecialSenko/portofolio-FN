import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import vercel from "@astrojs/vercel";
import icon from "astro-icon";

export default defineConfig({
  integrations: [
    react(),
    icon(),
  ],
  server: {
    host: "127.0.0.1",
    port: 4321,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4321,
    strictPort: true,
  },
  adapter: vercel(),
});
