import { defineConfig } from "vite";

export default defineConfig({
  // Allow importing the shared/ folder that lives one level above this package.
  server: {
    fs: { allow: [".."] },
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
