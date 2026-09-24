import { describe, expect, it } from "vitest";
import type { Item } from "../../api";
import { heldQuantity, isLowStock, placeParts, quantityDelta } from "./itemStatus";

const item = {
  public_id: "itm", name: "M3 screws", quantity: "240", unit: "pcs",
  location_path: "Workshop > Shelf B > Drawer A", containment_path: "",
} as unknown as Item;

describe("placeParts", () => {
  it("leads with the room and the cupboard, and keeps the rest for after", () => {
    expect(placeParts(item)).toEqual({ head: "Workshop › Shelf B", tail: "Drawer A" });
  });

  it("puts the container an item sits in at the deep end of the path", () => {
    const inside = { ...item, containment_path: "Inside Screw organiser > Workshop > Drawer A" };
    expect(placeParts(inside)).toEqual({ head: "Workshop › Shelf B", tail: "Drawer A › Screw Organiser" });
  });

  it("leaves no tail when the place is only two levels deep", () => {
    expect(placeParts({ ...item, location_path: "Kitchen > Pantry" })).toEqual({ head: "Kitchen › Pantry", tail: "" });
  });

  it("evens out the case each level was typed in", () => {
    const shouted = { ...item, location_path: "STUDIO > armadio grande > Ripiano 2" };
    expect(placeParts(shouted)).toEqual({ head: "Studio › Armadio Grande", tail: "Ripiano 2" });
  });

  it("leaves mixed case and anything with a number exactly as typed", () => {
    const mixed = { ...item, location_path: "Studio > iPhone box > 3D prints" };
    expect(placeParts(mixed)).toEqual({ head: "Studio › iPhone Box", tail: "3D Prints" });
  });

  it("names an item with no place rather than showing an empty row", () => {
    expect(placeParts({ ...item, location_path: "" }).head).toBe("Unassigned");
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

it("an item whose category does not track low stock is never low", () => {
  const base = { quantity: "1", low_stock_threshold: "2" } as unknown as Item;
  expect(isLowStock(base)).toBe(true);
  expect(isLowStock({ ...base, low_stock_enabled: false })).toBe(false);
});
