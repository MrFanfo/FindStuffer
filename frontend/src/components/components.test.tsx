import axe from "axe-core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Item, ItemDocument } from "../api";
import { DocumentSection } from "./DocumentSection";
import { SearchFeedback } from "./SearchFeedback";
import { SearchableFilterPicker } from "./SearchableFilterPicker";

const item = {
  public_id: "itm_test",
  name: "Oscilloscope",
  location_path: "Workshop",
} as Item;

const document = {
  public_id: "doc_test",
  item_public_id: item.public_id,
  document_type: "warranty",
  title: "Warranty certificate",
  original_name: "warranty.pdf",
  mime_type: "application/pdf",
  size_bytes: 2048,
  purchase_date: "2026-01-10",
  warranty_expires_at: "2028-01-10",
  extracted_text: "Serial number SCOPE-42",
  extracted_serial_number: "SCOPE-42",
  extracted_purchase_date: "2026-01-10",
  extracted_warranty_expires_at: "2028-01-10",
  extraction_status: "complete",
  extraction_error: null,
  content_url: "/api/v1/documents/doc_test/content",
  created_at: "2026-01-10T00:00:00",
  updated_at: "2026-01-10T00:00:00",
} satisfies ItemDocument;

describe("modular inventory components", () => {
  it("offers actionable no-result feedback", () => {
    const onAdd = vi.fn();
    const onFindLost = vi.fn();
    render(<SearchFeedback query="mystery cable" onAdd={onAdd} onFindLost={onFindLost} />);

    fireEvent.click(screen.getByRole("button", { name: /add “mystery cable”/i }));
    fireEvent.click(screen.getByRole("button", { name: /mark lost/i }));

    expect(onAdd).toHaveBeenCalledOnce();
    expect(onFindLost).toHaveBeenCalledOnce();
  });

  it("renders owned documents and OCR suggestions", async () => {
    const { container } = render(
      <DocumentSection
        item={item}
        documents={[document]}
        onReload={vi.fn()}
        onItemChanged={vi.fn()}
        notify={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: "Warranty certificate" })).toHaveAttribute(
      "href",
      document.content_url,
    );
    expect(screen.getByText(/serial SCOPE-42/i)).toBeInTheDocument();
    expect(screen.getByLabelText("File")).toHaveAttribute(
      "accept",
      "application/pdf,image/jpeg,image/png,image/webp",
    );
    const accessibility = await axe.run(container);
    expect(accessibility.violations).toEqual([]);
  });

  it("filters reusable picker options and closes after selection", () => {
    const onChoose = vi.fn();
    const onClose = vi.fn();
    render(
      <SearchableFilterPicker
        title="Filter by Place"
        icon="pin"
        options={[
          { id: "drawer", label: "Top drawer", detail: "Workshop > Bench" },
          { id: "pantry", label: "Pantry" },
        ]}
        selectedId=""
        emptyLabel="Any Place"
        onChoose={onChoose}
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "drawer" } });
    fireEvent.click(screen.getByRole("button", { name: /top drawer/i }));
    expect(onChoose).toHaveBeenCalledWith("drawer");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
