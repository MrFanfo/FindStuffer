import axe from "axe-core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExtraView } from "./ExtraView";

describe("ExtraView", () => {
  it("presents focused workspaces for analytics, data, inventory management, and settings", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: /inventory management/i }));
    fireEvent.click(screen.getByRole("button", { name: /^settings/i }));
    expect(onAnalytics).toHaveBeenCalledOnce();
    expect(onData).toHaveBeenCalledOnce();
    expect(onInventoryManagement).toHaveBeenCalledOnce();
    expect(onSettings).toHaveBeenCalledOnce();
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
