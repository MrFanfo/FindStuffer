import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.join(root, "frontend", "src");
const limits = {
  "frontend/src/App.tsx": 1300,
};
const maximumFeatureLines = 950;
const errors = [];

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(target) : [target];
  });
}

const sourceFiles = filesUnder(sourceRoot).filter((file) => /\.(?:ts|tsx)$/.test(file) && !/\.test\./.test(file));
for (const file of sourceFiles) {
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).length;
  const maximum = limits[relative] ?? (relative.startsWith("frontend/src/features/") ? maximumFeatureLines : null);
  if (maximum !== null && lines > maximum) errors.push(`${relative}: ${lines} lines exceeds ${maximum}`);
}

const sourceSet = new Set(sourceFiles.map((file) => path.normalize(file)));
const graph = new Map(sourceFiles.map((file) => [path.normalize(file), []]));
const importPattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](\.[^"']+)["']/g;
for (const file of sourceFiles) {
  const contents = fs.readFileSync(file, "utf8");
  for (const match of contents.matchAll(importPattern)) {
    const base = path.resolve(path.dirname(file), match[1]);
    const resolved = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]
      .map((candidate) => path.normalize(candidate))
      .find((candidate) => sourceSet.has(candidate));
    if (resolved) graph.get(path.normalize(file)).push(resolved);
  }
}

const visiting = new Set();
const visited = new Set();
function visit(file, chain = []) {
  if (visiting.has(file)) {
    const cycleStart = chain.indexOf(file);
    errors.push(`Circular dependency: ${[...chain.slice(cycleStart), file].map((entry) => path.relative(sourceRoot, entry)).join(" -> ")}`);
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  for (const dependency of graph.get(file) || []) visit(dependency, [...chain, file]);
  visiting.delete(file);
  visited.add(file);
}
for (const file of sourceFiles) visit(path.normalize(file));

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Architecture check passed: ${sourceFiles.length} source files, App and feature-size limits respected, no circular imports.`);
