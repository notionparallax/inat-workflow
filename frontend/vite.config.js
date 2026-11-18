import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { zipSync } from "fflate";

const EXTENSION_DIR = fileURLToPath(new URL("../extension", import.meta.url));
const ZIP_NAME = "dive-inat-extension.zip";

// The extension folder, zipped, so the site can offer it for download until
// it's in the Chrome Web Store, and for the store upload itself (which needs
// manifest.json at the top level of the zip).
function extensionZip() {
  const files = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[`${relative(EXTENSION_DIR, path).replaceAll("\\", "/")}`] = readFileSync(path);
    }
  };
  walk(EXTENSION_DIR);
  return zipSync(files, { level: 9 });
}

const zipPlugin = {
  name: "extension-zip",
  configureServer(server) {
    server.middlewares.use(`/${ZIP_NAME}`, (_req, res) => {
      res.setHeader("Content-Type", "application/zip");
      res.end(Buffer.from(extensionZip()));
    });
  },
  generateBundle() {
    this.emitFile({ type: "asset", fileName: ZIP_NAME, source: extensionZip() });
  },
};

export default defineConfig({
  // Relative asset paths, so the site works from any folder (e.g. GitHub Pages' /inat-workflow/).
  base: "./",
  plugins: [svelte(), zipPlugin],
  build: { rollupOptions: { input: { main: "index.html", shortcuts: "shortcuts.html" } } },
  server: { port: 5173, strictPort: true },
});
