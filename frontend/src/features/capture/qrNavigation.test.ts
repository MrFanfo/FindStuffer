import { describe, expect, it } from "vitest";

import { parseFindstuffQrTarget } from "./qrNavigation";

describe("parseFindstuffQrTarget", () => {
  it("recognizes a Tailnet location URL from an app opened on another origin", () => {
    expect(parseFindstuffQrTarget(
      "https://findstuff.example.ts.net/?location=loc_drawer&mode=view",
      "https://findstuff.lan/?view=scan",
    )).toEqual({ type: "location", publicId: "loc_drawer", mode: "view" });
  });

  it("recognizes item and add-location links", () => {
    expect(parseFindstuffQrTarget("?item=itm_driver", "https://findstuff.local/"))
      .toEqual({ type: "item", publicId: "itm_driver" });
    expect(parseFindstuffQrTarget("/?location=loc_drawer&mode=add", "https://findstuff.local/"))
      .toEqual({ type: "location", publicId: "loc_drawer", mode: "add" });
  });

  it("does not treat retail codes or non-root web links as Findstuff labels", () => {
    expect(parseFindstuffQrTarget("8001234567890", "https://findstuff.local/")).toBeNull();
    expect(parseFindstuffQrTarget(
      "https://example.com/products/1?location=loc_drawer",
      "https://findstuff.local/",
    )).toBeNull();
  });
});
