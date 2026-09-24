import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MARK_PATHS } from "./categoryMarks";

/** Turns the drawn marks into the standalone SVG files the server seeds and serves. */
/** Only runs when asked: MARK_DIR=… vitest run markExport regenerates the files. */
test.skipIf(!process.env.MARK_DIR)("write seed marks", () => {
  const out = process.env.MARK_DIR!;
  fs.mkdirSync(out, { recursive: true });
  for (const [name, node] of Object.entries(MARK_PATHS)) {
    const body = renderToStaticMarkup(<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{node}</svg>);
    fs.writeFileSync(path.join(out, `${name}.svg`), `${body}\n`);
  }
  expect(Object.keys(MARK_PATHS).length).toBeGreaterThan(90);
});
