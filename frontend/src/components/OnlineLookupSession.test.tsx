import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type Item } from "../api";
import { OnlineLookupSession } from "./OnlineLookupSession";

vi.mock("../api", () => ({ api: {
  onlineSources: vi.fn(), onlineSourcePreview: vi.fn(), attachManualFromUrl: vi.fn(), updateItem: vi.fn(),
} }));

const item = {
  public_id: "itm_test", name: "PO-33 K.O!", brand: "Teenage Engineering", model: "PO-33",
  description: "", barcode: "", weight_g: null, links: [], location_path: "Studio", version: 1,
} as unknown as Item;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.onlineSources).mockResolvedValue({ query: "Teenage Engineering PO-33", results: [{
    title: "Official product", url: "https://example.org/po-33", domain: "example.org", is_pdf: false,
  }] });
});

describe("online lookup review", () => {
  it("attaches a reviewed PDF manual and advances", async () => {
    vi.mocked(api.onlineSourcePreview).mockResolvedValue({
      format: "pdf", source_url: "https://example.org/manual.pdf", title: "Manual",
      size_bytes: 2048, pdf_links: [],
    });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(<OnlineLookupSession mode="manual" title="Studio" items={[item]} onSaved={onSaved} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect" }));
    fireEvent.click(await screen.findByRole("button", { name: "Attach PDF manual" }));
    await waitFor(() => expect(api.attachManualFromUrl).toHaveBeenCalledWith(
      item, "https://example.org/manual.pdf", "Teenage Engineering PO-33 manual",
    ));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(await screen.findByText("All items reviewed")).toBeInTheDocument();
  });

  it("saves selected product fields and a source link", async () => {
    vi.mocked(api.onlineSourcePreview).mockResolvedValue({
      format: "product", source_url: "https://example.org/po-33", title: "PO-33",
      fields: { name: "Different name", description: "Pocket sampler", weight_g: 100 },
      exact_model: true, structured: true,
    });
    render(<OnlineLookupSession mode="details" title="Studio" items={[item]} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect" }));
    expect(await screen.findByText("Suggested: Pocket sampler")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save selected details" }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith(item, {
      description: "Pocket sampler", weight_g: 100,
      links: [{ label: "Product source: example.org", url: "https://example.org/po-33" }],
    }));
  });
});
