// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoWorkspace, loadDemoWorkspace, resetDemoWorkspace, saveDemoWorkspace } from "./demoWorkspace";

describe("browser demo workspace storage", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("saves only to the supplied tab storage and survives a reload", async () => {
    const firstTab = window.sessionStorage;
    const secondTab = createMemoryStorage();
    const edited = createDemoWorkspace(new Date("2026-09-02T12:00:00.000Z"));
    edited.maps[0].title = "First tab only";

    const saved = await saveDemoWorkspace(edited, 0, firstTab);
    expect(saved.revision).toBe(1);
    expect(loadDemoWorkspace(firstTab).maps[0].title).toBe("First tab only");
    expect(loadDemoWorkspace(secondTab).maps[0].title).toBe("Home server rebuild");

    resetDemoWorkspace(firstTab);
    expect(loadDemoWorkspace(firstTab).maps[0].title).toBe("Home server rebuild");
  });

  it("falls back to a clean seed when temporary data is malformed", () => {
    window.sessionStorage.setItem("audhdmap.browser-demo.workspace.v1", "{not-json");
    expect(loadDemoWorkspace().revision).toBe(0);
    expect(loadDemoWorkspace().maps).toHaveLength(2);
    window.sessionStorage.setItem("audhdmap.browser-demo.workspace.v1", JSON.stringify({ schemaVersion: 1, revision: 4, maps: [null], nodes: [], edges: [], groups: [], categories: [], settings: {} }));
    expect(loadDemoWorkspace().maps[0].title).toBe("Home server rebuild");
  });

  it("rejects a stale save revision inside one tab", async () => {
    const workspace = createDemoWorkspace();
    await saveDemoWorkspace(workspace, 0);
    await expect(saveDemoWorkspace(workspace, 0)).rejects.toThrow(/changed in this tab/i);
  });
});

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}
