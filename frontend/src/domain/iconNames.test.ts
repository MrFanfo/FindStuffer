import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { MARKS } from "./categoryIcons";
import { PLACE_ICONS, placeIcons } from "./placeIcons";

// The drawings installed with the app. A guess naming anything else draws nothing.
const shipped = new Set(
  readdirSync(resolve(__dirname, "../../../backend/findstuff/seed_marks"))
    .filter((file) => file.endsWith(".svg"))
    .map((file) => file.replace(/\.svg$/, "")),
);

describe("suggested icons", () => {
  it("only ever suggest icons that are installed", () => {
    const suggested = [...MARKS, ...PLACE_ICONS].map(([icon]) => icon).concat("tag", "boxes");
    expect(suggested.filter((icon) => !shipped.has(icon))).toEqual([]);
  });

  it("guess a place from its name, then its kind, then its parent", () => {
    const icons = placeIcons([
      { public_id: "a", name: "Cucina", kind: "room", description: "", path: "Cucina", children: [
        { public_id: "b", name: "Frigorifero", kind: "appliance", description: "", path: "", children: [] },
        { public_id: "c", name: "Mobile sotto forno", kind: "cabinet", description: "", path: "", children: [] },
      ] },
      { public_id: "d", name: "Garage", kind: "room", description: "", path: "Garage", icon: "toolbox", children: [
        { public_id: "e", name: "Scatola 1", kind: "location", description: "", path: "", children: [] },
        { public_id: "f", name: "Angolo", kind: "location", description: "", path: "", children: [] },
      ] },
    ]);
    expect(icons.get("a")).toBe("cutlery");
    expect(icons.get("b")).toBe("fridge");
    expect(icons.get("c")).toBe("case");
    expect(icons.get("d")).toBe("toolbox");
    expect(icons.get("e")).toBe("boxes");
    expect(icons.get("f")).toBe("toolbox");
  });
});
