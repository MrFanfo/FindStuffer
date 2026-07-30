const PRINT_QUEUE_KEY = "findstuff.locationPrintQueue.v1";
const PRINT_SETTINGS_KEY = "findstuff.locationPrintSettings.v1";

export type PrintQueueItem = {
  publicId: string;
  name: string;
  path: string;
  kind: string;
  selected: boolean;
};
export type PrintLayout = "auto" | "two" | "three" | "four";
export type PrintDesign = "ornate" | "clean" | "bold" | "soft" | "technical" | "ticket";
export type PrintDensity = "compact" | "balanced" | "spacious";
export type PrintTextMode = "name" | "full-path" | "last-levels";
export type PrintQueueSettings = {
  color: string;
  layout: PrintLayout;
  qrSize: number;
  design: PrintDesign;
  density: PrintDensity;
  textMode: PrintTextMode;
  pathLevels: number;
  showKind: boolean;
};

const DEFAULT_PRINT_SETTINGS: PrintQueueSettings = {
  color: "#4923A8",
  layout: "auto",
  qrSize: 38,
  design: "ornate",
  density: "balanced",
  textMode: "name",
  pathLevels: 3,
  showKind: false,
};
export function loadPrintQueue(): PrintQueueItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PRINT_QUEUE_KEY) || "[]") as PrintQueueItem[];
    return Array.isArray(parsed)
      ? parsed.filter((entry) => entry && typeof entry.publicId === "string" && typeof entry.name === "string")
      : [];
  } catch {
    return [];
  }
}
export function loadPrintSettings(): PrintQueueSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(PRINT_SETTINGS_KEY) || "null") as Partial<PrintQueueSettings> | null;
    const layout = parsed?.layout === "two" || parsed?.layout === "three" || parsed?.layout === "four" ? parsed.layout : "auto";
    const color = typeof parsed?.color === "string" && /^#[0-9a-f]{6}$/i.test(parsed.color)
      ? parsed.color.toUpperCase()
      : DEFAULT_PRINT_SETTINGS.color;
    const qrSize = Math.min(64, Math.max(20, Number(parsed?.qrSize) || DEFAULT_PRINT_SETTINGS.qrSize));
    const designs: PrintDesign[] = ["ornate", "clean", "bold", "soft", "technical", "ticket"];
    const design = designs.includes(parsed?.design as PrintDesign) ? parsed?.design as PrintDesign : "ornate";
    const density: PrintDensity = parsed?.density === "compact" || parsed?.density === "spacious" ? parsed.density : "balanced";
    const textMode: PrintTextMode = parsed?.textMode === "full-path" || parsed?.textMode === "last-levels" ? parsed.textMode : "name";
    const pathLevels = Math.min(8, Math.max(1, Math.round(Number(parsed?.pathLevels) || DEFAULT_PRINT_SETTINGS.pathLevels)));
    return { color, layout, qrSize, design, density, textMode, pathLevels, showKind: parsed?.showKind === true };
  } catch {
    return DEFAULT_PRINT_SETTINGS;
  }
}

export function savePrintQueue(queue: PrintQueueItem[]): void {
  try {
    localStorage.setItem(PRINT_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // The print queue is a local convenience; inventory data remains untouched.
  }
}

export function savePrintSettings(settings: PrintQueueSettings): void {
  try {
    localStorage.setItem(PRINT_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Print settings are best-effort.
  }
}

