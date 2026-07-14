import { beforeEach, describe, expect, it, vi } from "vitest";

function script(src: string): HTMLScriptElement {
  const el = document.head.querySelector<HTMLScriptElement>(
    `script[src="${src}"]`,
  );
  if (!el) throw new Error(`Script tag not added: ${src}`);
  return el;
}

describe("loadLhcForms", () => {
  beforeEach(() => {
    vi.resetModules();
    document.head.innerHTML = "";
    // @ts-expect-error test cleanup of the LForms global
    window.LForms = undefined;
  });

  it("retries after a script load failure instead of caching the rejection", async () => {
    const { loadLhcForms } = await import("./lhc-forms-loader");

    const first = loadLhcForms();
    script("/lforms/zone.min.js").onerror?.(new Event("error"));
    await expect(first).rejects.toThrow("Failed to load script");
    expect(
      document.head.querySelector('script[src="/lforms/zone.min.js"]'),
    ).toBeNull();

    const second = loadLhcForms();
    expect(second).not.toBe(first);
    await vi.waitFor(() => script("/lforms/zone.min.js"));
  });

  it("does not re-execute scripts that already loaded when retrying", async () => {
    const { loadLhcForms } = await import("./lhc-forms-loader");

    const first = loadLhcForms();
    script("/lforms/zone.min.js").onload?.(new Event("load"));
    await vi.waitFor(() => script("/lforms/runtime.js"));
    script("/lforms/runtime.js").onerror?.(new Event("error"));
    await expect(first).rejects.toThrow("Failed to load script");

    loadLhcForms();
    await vi.waitFor(() => script("/lforms/runtime.js"));
    expect(
      document.head.querySelectorAll('script[src="/lforms/zone.min.js"]'),
    ).toHaveLength(1);
    expect(
      document.head.querySelectorAll('script[src="/lforms/runtime.js"]'),
    ).toHaveLength(1);
  });
});
