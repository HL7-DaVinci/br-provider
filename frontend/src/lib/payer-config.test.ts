import { afterEach, expect, it } from "vitest";
import { getStoredPayerHeaders, setStoredPayerServer } from "./payer-config";

afterEach(() => {
  localStorage.clear();
});

it("keeps payer headers keyed by FHIR URL when the active payer changes", () => {
  setStoredPayerServer({
    name: "A",
    cdsUrl: "https://a.example/cds-services",
    fhirUrl: "https://a.example/fhir",
    headers: [{ name: "X-Key", value: "a" }],
  });
  setStoredPayerServer({
    name: "B",
    cdsUrl: "https://b.example/cds-services",
    fhirUrl: "https://b.example/fhir",
    headers: [{ name: "X-Key", value: "b" }],
  });

  expect(getStoredPayerHeaders("https://a.example/fhir")).toEqual([
    { name: "X-Key", value: "a" },
  ]);
  expect(getStoredPayerHeaders("https://b.example/fhir")).toEqual([
    { name: "X-Key", value: "b" },
  ]);
});
