import axe from "axe-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExtraView } from "./ExtraView";

describe("ExtraView", () => {
  it("presents focused workspaces for analytics, data, archive and loans, and settings", async () => {
    const onAnalytics = vi.fn();
    const onData = vi.fn();
    const onInventoryManagement = vi.fn();
    const onSettings = vi.fn();
    const { container } = render(
      <ExtraView
        offlineOperations={[]}
        offlineMode={false}
        syncing={false}
        onAnalytics={onAnalytics}
        onData={onData}
        onInventoryManagement={onInventoryManagement}
        onSettings={onSettings}
        onSync={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /analytics/i }));
    fireEvent.click(screen.getByRole("button", { name: /^data/i }));
    fireEvent.click(screen.getByRole("button", { name: /archive & loans/i }));
    fireEvent.click(screen.getByRole("button", { name: /^settings/i }));
    expect(onAnalytics).toHaveBeenCalledOnce();
    expect(onData).toHaveBeenCalledOnce();
    expect(onInventoryManagement).toHaveBeenCalledOnce();
    expect(onSettings).toHaveBeenCalledOnce();
    expect((await axe.run(container)).violations).toEqual([]);
  });
});

describe("ExtraView QR labels", () => {
  it("opens the print queue and says how many labels wait in it", () => {
    cleanup();
    const onPrintQueue = vi.fn();
    render(
      <ExtraView offlineOperations={[]} offlineMode={false} syncing={false} onAnalytics={vi.fn()} onData={vi.fn()}
        onInventoryManagement={vi.fn()} onSettings={vi.fn()} onSync={vi.fn()} onDiscard={vi.fn()}
        printQueueCount={3} onPrintQueue={onPrintQueue} />,
    );
    const card = screen.getByRole("button", { name: /qr labels/i });
    expect(card).toHaveTextContent("3 waiting in the print queue");
    fireEvent.click(card);
    expect(onPrintQueue).toHaveBeenCalledOnce();
  });
});
