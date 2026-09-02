// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LandingPage } from "./LandingPage";

describe("AuDHDMAP product website", () => {
  afterEach(cleanup);

  it("offers the passwordless demo, real product screens, and self-hosting path", () => {
    render(<LandingPage />);
    expect(screen.getByRole("heading", { name: /Map the way your mind actually moves/i })).not.toBeNull();
    const demoLinks = screen.getAllByRole("link", { name: /demo|Launch AuDHDMAP/i });
    expect(demoLinks.length).toBeGreaterThanOrEqual(3);
    expect(demoLinks.every((link) => link.getAttribute("href") === "/demo")).toBe(true);
    expect(screen.getByText("No account for the demo")).not.toBeNull();
    expect(screen.getByText(/shared, temporary, and passwordless/i)).not.toBeNull();
    expect(screen.getByRole("img", { name: /signal-green canvas/i }).getAttribute("src")).toBe("/site/canvas-map.jpg");
    expect(screen.getByRole("img", { name: /outline view/i }).getAttribute("src")).toBe("/site/outline-view.jpg");
    expect(screen.getByRole("img", { name: /export panel/i }).getAttribute("src")).toBe("/site/export-panel.jpg");
    expect(screen.getByRole("link", { name: "Install with Docker" })).not.toBeNull();
  });
});
