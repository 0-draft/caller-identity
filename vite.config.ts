import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Served from https://0-draft.github.io/caller-identity/ on GitHub Pages.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/caller-identity/",
  plugins: [react(), tailwindcss()],
});
