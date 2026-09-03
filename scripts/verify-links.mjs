// Checks that every relative link in the Markdown resolves to a real file.
// Broken documentation links are the easiest kind of rot to ship and the
// cheapest to catch.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.dirname(import.meta.dirname);
const skip = new Set(["node_modules", ".git", "dist", "dist-electron", "release", "coverage"]);

function markdownFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...markdownFiles(full));
    else if (entry.name.endsWith(".md")) found.push(full);
  }
  return found;
}

const linkPattern = /\[[^\]]*\]\(([^)]+)\)|<img[^>]+src="([^"]+)"/g;
const broken = [];

for (const file of markdownFiles(root)) {
  const contents = readFileSync(file, "utf8");
  for (const match of contents.matchAll(linkPattern)) {
    const target = match[1] ?? match[2];
    if (!target || /^(https?:|mailto:|#)/.test(target)) continue;

    const [withoutAnchor] = target.split("#");
    if (!withoutAnchor) continue;

    const resolved = path.resolve(path.dirname(file), decodeURIComponent(withoutAnchor));
    if (!existsSync(resolved)) {
      broken.push(`${path.relative(root, file)} -> ${target}`);
      continue;
    }
    // A link to a directory only works on GitHub if it holds a README.
    if (statSync(resolved).isDirectory() && !existsSync(path.join(resolved, "README.md"))) {
      const listing = readdirSync(resolved);
      if (listing.length === 0) broken.push(`${path.relative(root, file)} -> ${target} (empty directory)`);
    }
  }
}

if (broken.length > 0) {
  console.error(`Broken documentation links:\n${broken.map((entry) => `  - ${entry}`).join("\n")}`);
  process.exit(1);
}

console.log("Documentation links verified.");
