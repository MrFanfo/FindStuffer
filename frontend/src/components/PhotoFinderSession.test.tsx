import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type Item, type PhotoSuggestion } from "../api";
import { PhotoFinderSession } from "./PhotoFinderSession";

vi.mock("../features/shell/usePreferences", () => ({
  usePreferences: () => ({ preferences: { photo_suggestion_count: 4 }, loaded: true }),
}));
vi.mock("../api", () => ({
  api: { photoSuggestions: vi.fn(), uploadPhoto: vi.fn() },
}));

const item = {
  public_id: "itm_test", name: "PO-33 K.O!", brand: "Teenage Engineering", location_path: "Studio",
} as Item;
const photo = (index: number): PhotoSuggestion => ({
  query: "Teenage Engineering PO-33 K.O!", title: `Photo ${index}`,
  source_page: "https://example.com/product", image_url: "https://example.com/photo.webp",
  data_url: "data:image/webp;base64,YQ==", width: 100, height: 100,
  size_bytes: 100, result_index: index,
});

describe("photo finder grid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.photoSuggestions).mockImplementation(async (_id, offset) => offset === 0
      ? { suggestions: [photo(0), photo(2), photo(3), photo(4)], next_offset: 5, has_more: true }
      : { suggestions: [photo(5)], next_offset: 6, has_more: false });
  });

  it("saves the clicked photo and advances", async () => {
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({
      blob: async () => new Blob(["image"], { type: "image/webp" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<PhotoFinderSession title="Studio" items={[item]} onClose={vi.fn()} onSaved={onSaved} />);
      fireEvent.click(await screen.findByRole("button", { name: "Save photo: Photo 2" }));
      await waitFor(() => expect(api.uploadPhoto).toHaveBeenCalledWith(
        item, expect.any(Blob), 100, 100,
      ));
      await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
      expect(await screen.findByText("All items reviewed")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows a grid and fetches the next page after skipped results", async () => {
    render(<PhotoFinderSession title="Studio" items={[item]} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(await screen.findAllByRole("button", { name: /Save photo:/ })).toHaveLength(4);
    expect(api.photoSuggestions).toHaveBeenCalledWith(item.public_id, 0, 4);
    fireEvent.click(screen.getByRole("button", { name: "Next photos" }));
    await waitFor(() => expect(api.photoSuggestions).toHaveBeenCalledWith(item.public_id, 5, 4));
    expect(await screen.findByRole("button", { name: "Save photo: Photo 5" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next photos" })).toBeDisabled();
  });
});
