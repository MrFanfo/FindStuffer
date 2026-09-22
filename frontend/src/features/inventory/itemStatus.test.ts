import { describe, expect, it } from "vitest";
import type { Item } from "../../api";
import { heldQuantity, placeParts, quantityDelta } from "./itemStatus";

const item = {
  public_id: "itm", name: "M3 screws", quantity: "240", unit: "pcs",
  location_path: "Workshop > Shelf B > Drawer A", containment_path: "",
} as unknown as Item;

describe("placeParts", () => {
  it("puts the most specific place first so truncation trims the broad end", () => {
    expect(placeParts(item)).toEqual({ leaf: "Drawer A", rest: "Workshop › Shelf B" });
  });

  it("keeps a container path in its own order, innermost container first", () => {
    const inside = { ...item, containment_path: "Inside Screw organiser > Workshop > Drawer A" };
    expect(placeParts(inside)).toEqual({ leaf: "Screw organiser", rest: "Workshop › Drawer A" });
  });

  it("names an item with no place rather than showing an empty row", () => {
    expect(placeParts({ ...item, location_path: "" }).leaf).toBe("Unassigned");
  });
});

describe("quantityDelta", () => {
  it("turns a counted amount into the change that reaches it", () => {
    expect(quantityDelta("240", "237")).toBe(-3);
    expect(quantityDelta("2", "10")).toBe(8);
  });

  it("keeps decimal counts free of floating-point dust", () => {
    expect(quantityDelta("0.3", "0.1")).toBe(-0.2);
  });
});

describe("heldQuantity", () => {
  it("adds up what projects already claim", () => {
    const held = { ...item, project_holds: [
      { public_id: "p1", name: "Toolhead", quantity: "2" },
      { public_id: "p2", name: "Frame", quantity: "3" },
    ] };
    expect(heldQuantity(held)).toBe(5);
    expect(heldQuantity(item)).toBe(0);
  });
});
