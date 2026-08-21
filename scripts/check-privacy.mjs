import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ignored = new Set([".git", "dist", "node_modules"]);
const extensions = new Set([".json", ".md", ".mjs", ".ts", ".yml", ".yaml"]);
const forbidden = [
  ["person" + ".fredbot", "personal person entity"],
  ["device_tracker" + ".pixel_10_pro", "personal device tracker"],
];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(path)));
    else if (extensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const findings = [];
for (const file of await collect(root)) {
  const text = await readFile(file, "utf8");
  for (const [needle, label] of forbidden) {
    if (text.toLowerCase().includes(needle)) {
      findings.push(`${relative(root, file)} contains ${label}`);
    }
  }
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
}
