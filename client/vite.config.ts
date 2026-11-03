import { foldkit } from "@foldkit/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [tailwindcss(), foldkit()],
  server: {
    port: 5180,
    proxy: {
      "/api": { target: "http://localhost:3001", rewrite: (path) => path.replace(/^\/api/, "") },
    },
  },
})
