import { mkdir, readdir, stat, copyFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const srcDir = join(root, "src");
const distDir = join(root, "dist");

// tsc emits only JS, so every non-source file the runtime reads is copied here.
const ASSET_EXTENSIONS = [".json", ".html", ".woff2"];

async function findAssetFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findAssetFiles(abs)));
    } else if (entry.isFile() && ASSET_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push(abs);
    }
  }
  return files;
}

try {
  await stat(srcDir);
} catch {
  console.error(`copy-build-assets: src/ not found at ${srcDir}`);
  process.exit(1);
}

const files = await findAssetFiles(srcDir);
for (const src of files) {
  const rel = relative(srcDir, src);
  const dest = join(distDir, rel);
  try {
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
  } catch (err) {
    console.error(`copy-build-assets: failed to copy ${rel}: ${err}`);
    process.exit(1);
  }
}
