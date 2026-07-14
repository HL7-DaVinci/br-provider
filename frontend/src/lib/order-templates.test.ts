import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteCustomTemplate,
  getAllTemplates,
  getCustomTemplates,
  getTemplateById,
  saveCustomTemplate,
} from "./order-templates";

describe("custom order templates", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saves, lists, and resolves a custom template", () => {
    const template = saveCustomTemplate({
      code: "A9999",
      display: "Test Device",
      codeSystem: "http://example.org/codes",
      resourceType: "DeviceRequest",
    });

    expect(template.id).toBe("custom-DeviceRequest-A9999");
    expect(template.category).toBe("DME");
    expect(getCustomTemplates()).toHaveLength(1);
    expect(getAllTemplates()).toContainEqual(template);
    expect(getTemplateById(template.id)).toEqual(template);
  });

  it("defaults display to the code and upserts by resource type and code", () => {
    saveCustomTemplate({
      code: "A9999",
      display: "",
      codeSystem: "http://example.org/codes",
      resourceType: "DeviceRequest",
    });
    const updated = saveCustomTemplate({
      code: "A9999",
      display: "Renamed",
      codeSystem: "http://example.org/other",
      resourceType: "DeviceRequest",
    });

    expect(getCustomTemplates()).toHaveLength(1);
    expect(updated.display).toBe("Renamed");

    const first = saveCustomTemplate({
      code: "B1111",
      display: "",
      codeSystem: "http://example.org/codes",
      resourceType: "ServiceRequest",
    });
    expect(first.display).toBe("B1111");
  });

  it("deletes a custom template", () => {
    const template = saveCustomTemplate({
      code: "A9999",
      display: "Test Device",
      codeSystem: "http://example.org/codes",
      resourceType: "DeviceRequest",
    });

    deleteCustomTemplate(template.id);

    expect(getCustomTemplates()).toHaveLength(0);
    expect(getTemplateById(template.id)).toBeUndefined();
  });

  it("returns no custom templates when storage is corrupt", () => {
    localStorage.setItem("custom-order-templates", "not-json");
    expect(getCustomTemplates()).toEqual([]);
  });
});
