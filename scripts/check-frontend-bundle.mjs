import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "frontend", "dist");
const manifestPath = path.join(dist, ".vite", "manifest.json");
if (!fs.existsSync(manifestPath)) throw new Error("Build manifest missing; run npm run build first.");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const entry = Object.values(manifest).find((chunk) => chunk.isEntry);
if (!entry) throw new Error("Frontend entry chunk missing from Vite manifest.");

const entryBytes = fs.statSync(path.join(dist, entry.file)).size;
const maximumEntryBytes = 350 * 1024;
const maximumAsyncBytes = 400 * 1024;
const maximumVendorBytes = 500 * 1024;
const oversizedAsync = Object.values(manifest)
  .filter((chunk) => !chunk.isEntry && chunk.file?.endsWith(".js"))
  .map((chunk) => ({ file: chunk.file, source: chunk.src || "", bytes: fs.statSync(path.join(dist, chunk.file)).size }))
  .filter((chunk) => chunk.bytes > (chunk.source.startsWith("node_modules/") ? maximumVendorBytes : maximumAsyncBytes));

if (entryBytes > maximumEntryBytes || oversizedAsync.length) {
  if (entryBytes > maximumEntryBytes) console.error(`Entry bundle ${(entryBytes / 1024).toFixed(1)} KiB exceeds 350 KiB.`);
  for (const chunk of oversizedAsync) console.error(`Async bundle ${chunk.file} ${(chunk.bytes / 1024).toFixed(1)} KiB exceeds 400 KiB.`);
  process.exit(1);
}
console.log(`Bundle budget passed: entry ${(entryBytes / 1024).toFixed(1)} KiB; ${Object.keys(manifest).length} manifest entries.`);
