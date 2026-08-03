import { beforeEach, describe, expect, it } from "vitest";
import {
  addPayerRecent,
  addProviderRecent,
  getPayerRecents,
  getProviderRecents,
  removePayerRecent,
  removeProviderRecent,
} from "./server-recents";

beforeEach(() => {
  localStorage.clear();
});

describe("provider recents", () => {
  it("prepends new entries and dedupes by normalized url", () => {
    addProviderRecent({ url: "http://a.test/fhir" });
    addProviderRecent({ url: "http://b.test/fhir" });
    addProviderRecent({ url: "http://a.test/fhir/", idp: "http://idp.test" });
    const recents = getProviderRecents();
    expect(recents.map((r) => r.url)).toEqual([
      "http://a.test/fhir",
      "http://b.test/fhir",
    ]);
    expect(recents[0].idp).toBe("http://idp.test");
  });

  it("caps at 10 entries", () => {
    for (let i = 0; i < 12; i++) {
      addProviderRecent({ url: `http://s${i}.test/fhir` });
    }
    expect(getProviderRecents()).toHaveLength(10);
    expect(getProviderRecents()[0].url).toBe("http://s11.test/fhir");
  });

  it("removes by url", () => {
    addProviderRecent({ url: "http://a.test/fhir" });
    removeProviderRecent("http://a.test/fhir");
    expect(getProviderRecents()).toEqual([]);
  });

  it("drops malformed entries and unknown auth modes on read", () => {
    localStorage.setItem(
      "fhir-server-recents",
      JSON.stringify([
        { url: "http://ok.test/fhir", authMode: "bogus", headers: "junk" },
        { notAUrl: true },
        "junk",
      ]),
    );
    expect(getProviderRecents()).toEqual([{ url: "http://ok.test/fhir" }]);
  });

  it("keeps a smart auth mode and clientId on read", () => {
    localStorage.setItem(
      "fhir-server-recents",
      JSON.stringify([
        { url: "http://ok.test/fhir", authMode: "smart", clientId: "abc123" },
      ]),
    );
    expect(getProviderRecents()).toEqual([
      { url: "http://ok.test/fhir", authMode: "smart", clientId: "abc123" },
    ]);
  });
});

describe("payer recents", () => {
  const payer = {
    name: "Test Payer",
    cdsUrl: "http://p.test/cds-services",
    fhirUrl: "http://p.test/fhir",
  };

  it("dedupes by fhirUrl plus cdsUrl", () => {
    addPayerRecent(payer);
    addPayerRecent({ ...payer, authMode: "open" as const });
    expect(getPayerRecents()).toHaveLength(1);
    expect(getPayerRecents()[0].authMode).toBe("open");
  });

  it("removes by fhirUrl plus cdsUrl", () => {
    addPayerRecent(payer);
    removePayerRecent(payer.fhirUrl, payer.cdsUrl);
    expect(getPayerRecents()).toEqual([]);
  });
});
