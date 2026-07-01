import { afterEach, describe, expect, it } from "vitest";
import { getStoredPractitionerRef } from "./use-practitioner-ref";

function setFhirUser(fhirUser: string | undefined) {
  if (fhirUser === undefined) {
    sessionStorage.removeItem("spa_userinfo");
  } else {
    sessionStorage.setItem("spa_userinfo", JSON.stringify({ fhirUser }));
  }
}

describe("getStoredPractitionerRef", () => {
  afterEach(() => sessionStorage.clear());

  it("returns a relative Practitioner reference from the stored fhirUser", () => {
    setFhirUser("Practitioner/PractitionerExample");
    expect(getStoredPractitionerRef()).toBe("Practitioner/PractitionerExample");
  });

  it("extracts the reference from an absolute fhirUser URL", () => {
    setFhirUser("https://fhir.example.org/r4/Practitioner/123");
    expect(getStoredPractitionerRef()).toBe("Practitioner/123");
  });

  it("supports PractitionerRole and ignores a trailing query", () => {
    setFhirUser("PractitionerRole/role-1?_format=json");
    expect(getStoredPractitionerRef()).toBe("PractitionerRole/role-1");
  });

  it("returns undefined when no fhirUser is stored", () => {
    setFhirUser(undefined);
    expect(getStoredPractitionerRef()).toBeUndefined();
  });

  it("returns undefined for a non-Practitioner fhirUser", () => {
    setFhirUser("Patient/pat1");
    expect(getStoredPractitionerRef()).toBeUndefined();
  });
});
