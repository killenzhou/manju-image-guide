import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: path.resolve(__dirname, "web"),
  plugins: [react(), viteSingleFile()],
  build: {
    target: "es2022",
    outDir: path.resolve(__dirname, "dist/web"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
