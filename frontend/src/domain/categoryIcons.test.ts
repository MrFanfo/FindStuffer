import { describe, expect, it } from "vitest";
import { categoryIcon } from "./categoryIcons";

describe("categoryIcon", () => {
  it("reads the category's own words, in English or Italian", () => {
    expect(categoryIcon("Electronics > Components")).toBe("chip");
    expect(categoryIcon("Elettronica > Componenti")).toBe("chip");
    expect(categoryIcon("Legatoria > Filo")).toBe("spool");
    expect(categoryIcon("Attrezzi > Elettrici")).toBe("wrench");
    expect(categoryIcon("Alimentari > Pasta")).toBe("cutlery");
    expect(categoryIcon("Materiali > Pelle")).toBe("layers");
  });

  it("matches on any part of the path, not only the leaf", () => {
    expect(categoryIcon("Kitchen > Something unusual")).toBe("cutlery");
  });

  it("falls back to a neutral mark rather than guessing", () => {
    expect(categoryIcon("Ricordi di famiglia")).toBe("tag");
    expect(categoryIcon("")).toBe("tag");
  });
});
