import { describe, expect, it } from "vitest";
import { buildCrdConfiguration } from "./use-cds-hooks";

describe("buildCrdConfiguration", () => {
  it("maps each advertised option to its default value", () => {
    const configuration = buildCrdConfiguration({
      hook: "appointment-book",
      id: "appointment-book-crd",
      description: "",
      extension: {
        "davinci-crd.configuration-options": [
          {
            code: "coverage-info",
            type: "boolean",
            name: "Coverage Information",
            description: "",
            default: true,
          },
          {
            code: "max-cards",
            type: "integer",
            name: "Maximum cards",
            description: "",
            default: 10,
          },
        ],
      },
    });
    expect(configuration).toEqual({ "coverage-info": true, "max-cards": 10 });
  });

  it("returns undefined when the service advertises no options", () => {
    expect(
      buildCrdConfiguration({ hook: "order-sign", id: "x", description: "" }),
    ).toBeUndefined();
  });
});
