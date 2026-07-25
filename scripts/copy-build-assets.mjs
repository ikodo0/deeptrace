import { mkdir, readdir, stat, copyFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const srcDir = join(root, "src");
const distDir = join(root, "dist");

async function findJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findJsonFiles(abs)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
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

const files = await findJsonFiles(srcDir);
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
