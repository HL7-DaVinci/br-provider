import { describe, expect, it, vi } from "vitest";
import { resolvePrefetchTemplates } from "./cds-prefetch";

const CRD_ENCOUNTER_START_TEMPLATES = {
  patient: "Patient/{{context.patientId}}",
  encounter: "Encounter/{{context.encounterId}}",
  coverage: "Coverage?patient={{context.patientId}}&status=active",
  practitionerRoles:
    "PractitionerRole?_id={{%encounter.participant.individual.resolve().ofType(PractitionerRole).id}}",
  practitioners:
    "Practitioner?_id={{%practitionerRoles.entry.resource.practitioner.resolve().id|%encounter.participant.individual.resolve().ofType(Practitioner).id}}",
  organizations:
    "Organization?_id={{%practitionerRoles.entry.resource.organization.resolve().id|%encounter.serviceProvider.resolve().ofType(Organization).id}}",
  locations:
    "Location?_id={{%practitionerRoles.entry.resource.location.resolve().id|%encounter.location.location.resolve().id}}",
};

const patient = { resourceType: "Patient", id: "pat1" };
const encounter = {
  resourceType: "Encounter",
  id: "enc1",
  participant: [
    { individual: { reference: "PractitionerRole/pr1" } },
    { individual: { reference: "PractitionerRole/pr2" } },
  ],
  serviceProvider: { reference: "Organization/org9" },
  location: [{ location: { reference: "Location/loc1" } }],
};
const practitionerRole = (id: string, suffix: string) => ({
  resourceType: "PractitionerRole",
  id,
  practitioner: { reference: `Practitioner/prac${suffix}` },
  organization: { reference: `Organization/org${suffix}` },
  location: [{ reference: `Location/loc${suffix}` }],
});
const bundleOf = (...resources: { resourceType: string; id: string }[]) => ({
  resourceType: "Bundle",
  type: "searchset",
  entry: resources.map((resource) => ({ resource })),
});

function crdFetcher(overrides: Record<string, unknown> = {}) {
  const pr1 = practitionerRole("pr1", "1");
  const pr2 = practitionerRole("pr2", "2");
  const responses: Record<string, unknown> = {
    "Patient/pat1": patient,
    "Encounter/enc1": encounter,
    "Coverage?patient=pat1&status=active": bundleOf({
      resourceType: "Coverage",
      id: "cov1",
    }),
    "PractitionerRole/pr1": pr1,
    "PractitionerRole/pr2": pr2,
    "Practitioner/prac1": { resourceType: "Practitioner", id: "prac1" },
    "Practitioner/prac2": { resourceType: "Practitioner", id: "prac2" },
    "Organization/org1": { resourceType: "Organization", id: "org1" },
    "Organization/org2": { resourceType: "Organization", id: "org2" },
    "Location/loc1": { resourceType: "Location", id: "loc1" },
    "Location/loc2": { resourceType: "Location", id: "loc2" },
    "PractitionerRole?_id=pr1,pr2": bundleOf(pr1, pr2),
    "Practitioner?_id=prac1,prac2": bundleOf(
      { resourceType: "Practitioner", id: "prac1" },
      { resourceType: "Practitioner", id: "prac2" },
    ),
    "Organization?_id=org1,org2": bundleOf(
      { resourceType: "Organization", id: "org1" },
      { resourceType: "Organization", id: "org2" },
    ),
    "Location?_id=loc1,loc2": bundleOf(
      { resourceType: "Location", id: "loc1" },
      { resourceType: "Location", id: "loc2" },
    ),
    ...overrides,
  };
  return vi.fn(async (query: string) => responses[query]);
}

describe("resolvePrefetchTemplates", () => {
  it("resolves all CRD encounter-start templates including dependent ones", async () => {
    const fetchJson = crdFetcher();
    const prefetch = await resolvePrefetchTemplates(
      CRD_ENCOUNTER_START_TEMPLATES,
      { patientId: "pat1", encounterId: "enc1", userId: "Practitioner/prac1" },
      fetchJson,
    );
    expect(Object.keys(prefetch).sort()).toEqual([
      "coverage",
      "encounter",
      "locations",
      "organizations",
      "patient",
      "practitionerRoles",
      "practitioners",
    ]);
    expect(fetchJson).toHaveBeenCalledWith("PractitionerRole?_id=pr1,pr2");
    expect(fetchJson).toHaveBeenCalledWith("Practitioner?_id=prac1,prac2");
    expect(fetchJson).toHaveBeenCalledWith("Organization?_id=org1,org2");
    expect(fetchJson).toHaveBeenCalledWith("Location?_id=loc1,loc2");
  });

  it("reuses already-fetched resources instead of refetching references", async () => {
    const fetchJson = crdFetcher();
    await resolvePrefetchTemplates(
      CRD_ENCOUNTER_START_TEMPLATES,
      { patientId: "pat1", encounterId: "enc1" },
      fetchJson,
    );
    const individualFetches = fetchJson.mock.calls.filter(([q]) =>
      /^PractitionerRole\/pr\d$/.test(q),
    );
    expect(individualFetches).toHaveLength(2);
  });

  it("falls back to the second alternative when the first yields nothing", async () => {
    const soloPractitionerEncounter = {
      resourceType: "Encounter",
      id: "enc1",
      participant: [{ individual: { reference: "Practitioner/prac7" } }],
    };
    const fetchJson = crdFetcher({
      "Encounter/enc1": soloPractitionerEncounter,
      "Practitioner/prac7": { resourceType: "Practitioner", id: "prac7" },
      "Practitioner?_id=prac7": bundleOf({
        resourceType: "Practitioner",
        id: "prac7",
      }),
    });
    const prefetch = await resolvePrefetchTemplates(
      {
        encounter: "Encounter/{{context.encounterId}}",
        practitionerRoles: CRD_ENCOUNTER_START_TEMPLATES.practitionerRoles,
        practitioners: CRD_ENCOUNTER_START_TEMPLATES.practitioners,
      },
      { encounterId: "enc1" },
      fetchJson,
    );
    expect(prefetch.practitionerRoles).toBeNull();
    expect(prefetch.practitioners).toBeDefined();
    expect(fetchJson).toHaveBeenCalledWith("Practitioner?_id=prac7");
  });

  it("sends null for keys whose context token is missing", async () => {
    const fetchJson = crdFetcher();
    const prefetch = await resolvePrefetchTemplates(
      {
        patient: "Patient/{{context.patientId}}",
        encounter: "Encounter/{{context.encounterId}}",
      },
      { patientId: "pat1" },
      fetchJson,
    );
    expect(prefetch.patient).toBeDefined();
    expect("encounter" in prefetch).toBe(true);
    expect(prefetch.encounter).toBeNull();
  });

  it("sends null for keys whose fetch fails", async () => {
    const fetchJson = vi.fn(async () => undefined);
    const prefetch = await resolvePrefetchTemplates(
      { patient: "Patient/{{context.patientId}}" },
      { patientId: "pat1" },
      fetchJson,
    );
    expect(prefetch).toEqual({ patient: null });
  });

  it("rebases Bundle entry fullUrls onto the advertised base", async () => {
    const bundle = {
      resourceType: "Bundle",
      type: "searchset",
      entry: [
        {
          fullUrl: "http://localhost:8080/fhir/Patient/pat1",
          resource: patient,
        },
      ],
    };
    const fetchJson = vi.fn(async () => bundle);
    const prefetch = await resolvePrefetchTemplates(
      { patients: "Patient?_id={{context.patientId}}" },
      { patientId: "pat1" },
      fetchJson,
      "http://host.docker.internal:8080/fhir/",
    );
    const sent = prefetch.patients as typeof bundle;
    expect(sent.entry[0].fullUrl).toBe(
      "http://host.docker.internal:8080/fhir/Patient/pat1",
    );
  });
});
