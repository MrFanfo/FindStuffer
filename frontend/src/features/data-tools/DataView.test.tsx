import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { DataView } from "./DataView";

vi.mock("../../api", () => ({ flattenLocations: () => [], api: {
  settings: vi.fn(), importBatches: vi.fn(), backups: vi.fn(), importPreview: vi.fn(),
} }));

const operations = '{"format":"findstuff-ops-v1","schema_version":2,"operations":[]}';

function mount() {
  return render(<DataView categories={[]} locations={[]} locationTypes={[]} units={[]}
    busy={false} offline={false} onBack={vi.fn()} onChanged={vi.fn()} setNotice={vi.fn()} />);
}

describe("shared JSON import", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/?view=data&import=clipboard");
    vi.mocked(api.settings).mockResolvedValue({ setup: { backup: { enabled: false, backup_count: 0 } } } as Awaited<ReturnType<typeof api.settings>> );
    vi.mocked(api.importBatches).mockResolvedValue([]);
    vi.mocked(api.backups).mockResolvedValue([]);
    vi.mocked(api.importPreview).mockResolvedValue({
      valid: true, counts: { operations: 0 }, details: [], note: "Ready",
    } as Awaited<ReturnType<typeof api.importPreview>>);
  });

  it("previews copied JSON in the existing review flow without applying it", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true, value: { readText: vi.fn().mockResolvedValue(operations) },
    });
    mount();
    expect(screen.getByText(/Shared JSON is ready/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Paste JSON from clipboard" }));
    await waitFor(() => expect(api.importPreview).toHaveBeenCalledWith(JSON.parse(operations)));
    expect(await screen.findByText("Ready to apply")).toBeInTheDocument();
    expect(window.location.search).toBe("?view=data");
    expect(screen.getByRole("button", { name: "Apply reviewed changes" })).toBeInTheDocument();
  });

  it("offers manual paste when clipboard access fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true, value: { readText: vi.fn().mockRejectedValue(new Error("Clipboard blocked")) },
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Paste JSON from clipboard" }));
    const input = await screen.findByPlaceholderText("Tap here, then choose Paste");
    expect(input).toHaveFocus();
    expect(screen.getByText(/Tap the text box and choose Paste/)).toBeInTheDocument();
    expect(screen.queryByText("Clipboard blocked")).not.toBeInTheDocument();
    expect(api.importPreview).not.toHaveBeenCalled();
    fireEvent.paste(input, { clipboardData: { getData: () => operations } });
    await waitFor(() => expect(api.importPreview).toHaveBeenCalledWith(JSON.parse(operations)));
    expect(await screen.findByText("Ready to apply")).toBeInTheDocument();
  });

  it("clears a previous preview when pasted JSON is invalid", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true, value: { readText: vi.fn().mockResolvedValue(operations) },
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Paste JSON from clipboard" }));
    expect(await screen.findByText("Ready to apply")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Paste JSON manually" }));
    fireEvent.change(screen.getByPlaceholderText("Tap here, then choose Paste"), { target: { value: "not JSON" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview pasted JSON" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply reviewed changes" })).not.toBeInTheDocument();
  });
});
