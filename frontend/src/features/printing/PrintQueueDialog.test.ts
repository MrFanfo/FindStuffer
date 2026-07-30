import { describe, expect, it } from "vitest";

import {
  paginatePrintQueue,
  printColumnCount,
  type PrintQueueItem,
  type PrintQueueSettings,
} from "./PrintQueueDialog";

const settings: PrintQueueSettings = {
  color: "#4923A8",
  layout: "two",
  qrSize: 38,
  design: "clean",
  density: "balanced",
  textMode: "name",
  pathLevels: 3,
  showKind: false,
};

const queue = (count: number): PrintQueueItem[] => Array.from({ length: count }, (_, index) => ({
  publicId: `place-${index}`,
  name: `Place ${index}`,
  path: `Home > Place ${index}`,
  kind: "location",
  selected: true,
}));

describe("QR print pagination", () => {
  it("keeps complete rows together on every logical page", () => {
    const columns = printColumnCount(settings);
    const pages = paginatePrintQueue(queue(30), settings);

    expect(columns).toBe(2);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.slice(0, -1).every((page) => page.length % columns === 0)).toBe(true);
    expect(pages.flat()).toHaveLength(30);
  });

  it("uses fewer rows when long labels increase printed height", () => {
    const shortPages = paginatePrintQueue(queue(24), settings);
    const longQueue = queue(24).map((entry) => ({
      ...entry,
      name: `${entry.name} with a very long location label that wraps across several printed lines`,
    }));
    const longPages = paginatePrintQueue(longQueue, settings);

    expect(longPages.length).toBeGreaterThanOrEqual(shortPages.length);
  });
});
