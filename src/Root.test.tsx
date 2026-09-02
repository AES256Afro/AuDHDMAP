// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "./model";

const api = vi.hoisted(() => ({
  loadSiteConfig: vi.fn(),
  loadWorkspace: vi.fn(),
  login: vi.fn(),
  session: vi.fn(),
}));

vi.mock("./api", () => api);
vi.mock("./WorkspaceApp", () => ({
  WorkspaceApp: ({ initialWorkspace, publicDemo }: { initialWorkspace: Workspace; publicDemo: boolean }) => <div>{publicDemo ? "browser demo ready" : "private workspace"}: {initialWorkspace.maps[0].title}</div>,
}));

import { Root } from "./Root";

describe("application entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/demo");
  });
  afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });

  it("opens the public demo from browser storage without a session or server workspace request", async () => {
    api.loadSiteConfig.mockResolvedValue({ publicSite: true, publicDemo: true });
    render(<Root />);
    expect(await screen.findByText(/browser demo ready: Home server rebuild/i)).not.toBeNull();
    await waitFor(() => expect(api.loadSiteConfig).toHaveBeenCalledTimes(1));
    expect(api.session).not.toHaveBeenCalled();
    expect(api.loadWorkspace).not.toHaveBeenCalled();
  });
});
