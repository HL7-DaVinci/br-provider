import type {
  Bundle,
  BundleEntry,
  Claim,
  ClaimItem,
  ClaimSupportingInfo,
  CodeableConcept,
  Coverage,
  Extension,
  FhirResource,
  Organization,
  Patient,
  Practitioner,
  PractitionerRole,
  QuestionnaireResponse,
} from "fhir/r4";

import {
  getAppConfig,
  getStoredServerUrl,
  normalizeServerUrl,
} from "./fhir-config";

/**
 * Builds the PAS request Bundles: Claim/$submit (initial) and Claim/$inquire.
 */

const PAS_SD = "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/";
const PROFILE_REQUEST_BUNDLE = `${PAS_SD}profile-pas-request-bundle`;
const PROFILE_INQUIRY_BUNDLE = `${PAS_SD}profile-pas-inquiry-request-bundle`;
const PROFILE_CLAIM = `${PAS_SD}profile-claim`;
const PROFILE_CLAIM_INQUIRY = `${PAS_SD}profile-claim-inquiry`;
const PROFILE_REQUESTOR = `${PAS_SD}profile-requestor`;
const PROFILE_PRACTITIONERROLE = `${PAS_SD}profile-practitionerrole`;
const EXT_SERVICE_ITEM_REQUEST_TYPE = `${PAS_SD}extension-serviceItemRequestType`;
const EXT_CERTIFICATION_TYPE = `${PAS_SD}extension-certificationType`;
const EXT_TRANSMISSION_IDENTIFIERS = `${PAS_SD}extension-TransmissionIdentifiers`;
const EXT_CARE_TEAM_CLAIM_SCOPE = `${PAS_SD}extension-careTeamClaimScope`;
const EXT_REQUESTED_SERVICE = `${PAS_SD}extension-requestedService`;
const EXT_DOCUMENT_INFORMATION = `${PAS_SD}extension-documentInformation`;

const CLAIM_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/claim-type";
const PROCESS_PRIORITY_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/processpriority";
const DATA_ABSENT_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/data-absent-reason";
const MB_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0203";
const PAS_TEMP_CODES =
  "http://hl7.org/fhir/us/davinci-pas/CodeSystem/PASTempCodes";
const X12_PWK01_SYSTEM = "https://codesystem.x12.org/005010/755";

const CLAIM_IDENTIFIER_SYSTEM = "http://example.org/PATIENT_EVENT_TRACE_NUMBER";
const TRANSACTION_IDENTIFIER_SYSTEM =
  "http://example.org/SUBMITTER_TRANSACTION_IDENTIFIER";
const SUBMITTER_CLAIM_IDENTIFIER_SYSTEM =
  "http://example.org/SUBMITTER_CLAIM_IDENTIFIER";
const MEMBER_IDENTIFIER_SYSTEM = "http://example.org/MIN";
const US_NPI_SYSTEM = "http://hl7.org/fhir/sid/us-npi";

/**
 * Sending-system identifier (X12 ISA06): the request's applicationSenderCode and the Subscription
 * orgIdentifier filter. The PAS IG scopes subscriptions per sending system, so each plugged-in EHR
 * must present a distinct identifier or one EHR's decisions notify every other EHR's subscription.
 * A configured providerOrgIdentifier pins the value; otherwise it is derived from the active EHR
 * base URL. Seed-data NPIs are not usable here: servers seeded from the same IG examples share them.
 */
export function providerOrgIdentifier(): string {
  return (
    getAppConfig().providerOrgIdentifier ??
    deriveOrgIdentifier(getStoredServerUrl())
  );
}

/** Stable 10-digit identifier from a server base URL (FNV-1a 64, decimal-truncated). */
export function deriveOrgIdentifier(serverUrl: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const ch of normalizeServerUrl(serverUrl)) {
    hash ^= BigInt(ch.codePointAt(0) ?? 0);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return (hash % 10_000_000_000n).toString().padStart(10, "0");
}

export const PROVIDER_ORG_IDENTIFIER_SYSTEM =
  getAppConfig().providerOrgIdentifierSystem ??
  "http://example.org/fhir/org-identifier";
const PAYER_ORG_IDENTIFIER = getAppConfig().payerOrgIdentifier ?? "1234567893";

// Demo defaults for the X12-bound (required) item extensions; tune per service line as needed.
const X12_REQUEST_CATEGORY_SYSTEM = "https://codesystem.x12.org/005010/1525";
const X12_CERTIFICATION_TYPE_SYSTEM = "https://codesystem.x12.org/005010/1322";
const REQUEST_TYPE_HEALTH_SERVICES_REVIEW: CodeableConcept = {
  coding: [
    {
      system: X12_REQUEST_CATEGORY_SYSTEM,
      code: "HS",
      display: "Health Services Review",
    },
  ],
};
const CERTIFICATION_TYPE_INITIAL: CodeableConcept = {
  coding: [
    { system: X12_CERTIFICATION_TYPE_SYSTEM, code: "I", display: "Initial" },
  ],
};

const X12_SERVICE_TYPE_SYSTEM = "https://codesystem.x12.org/005010/1365";
const CMS_POS_SYSTEM =
  "https://www.cms.gov/Medicare/Coding/place-of-service-codes/Place_of_Service_Code_Set";

// ponytail: fixed demo defaults (home health care at home); parameterize per order when the UI captures them
export const CLAIM_ITEM_CATEGORY: CodeableConcept = {
  coding: [
    {
      system: X12_SERVICE_TYPE_SYSTEM,
      code: "42",
      display: "Home Health Care",
    },
  ],
};
export const CLAIM_ITEM_LOCATION: CodeableConcept = {
  coding: [{ system: CMS_POS_SYSTEM, code: "12", display: "Home" }],
};

/** Resources gathered from the provider FHIR server needed to assemble a PAS request Bundle. */
export interface PasSubmitResources {
  patient: Patient;
  practitioner: Practitioner;
  insurer: Organization;
  coverage: Coverage;
  order: FhirResource;
  orderType: string;
  questionnaireResponses: QuestionnaireResponse[];
}

/** Resources needed to assemble a PAS inquiry (query-by-example) Bundle. */
export interface PasInquiryResources {
  patient: Patient;
  /** Omitted when no order context is available; Claim.provider references the requestor Organization instead. */
  practitioner?: Practitioner;
  insurer: Organization;
  coverage: Coverage;
}

/** Builds an initial PAS Claim/$submit request Bundle. */
export function buildPasRequestBundle(
  r: PasSubmitResources,
  providerFhirBase: string,
): Bundle {
  return assembleSubmitBundle(r, PROFILE_CLAIM, providerFhirBase);
}

function npiOf(resource: Organization | Practitioner): string | undefined {
  return resource.identifier?.find((id) => id.system === US_NPI_SYSTEM)?.value;
}

/** profile-requestor allows only Organization or PractitionerRole as Claim.provider. */
function buildRequestorOrganization(): Organization {
  return {
    resourceType: "Organization",
    id: crypto.randomUUID(),
    meta: { profile: [PROFILE_REQUESTOR] },
    identifier: [
      {
        system: PROVIDER_ORG_IDENTIFIER_SYSTEM,
        value: providerOrgIdentifier(),
      },
    ],
    name: "Demo Provider Organization",
    active: true,
  };
}

/** profile-claim's careTeam.provider allows only Organization or PractitionerRole, not a bare Practitioner. */
function buildCareTeamPractitionerRole(
  practitioner: Practitioner,
  requestorOrg: Organization,
): PractitionerRole {
  return {
    resourceType: "PractitionerRole",
    id: crypto.randomUUID(),
    meta: { profile: [PROFILE_PRACTITIONERROLE] },
    practitioner: { reference: referenceFor(practitioner) },
    organization: { reference: referenceFor(requestorOrg) },
    telecom: practitioner.telecom ?? [
      { system: "phone", value: "555-555-5555" },
    ],
  };
}

function buildTransmissionIdentifiers(receiverCode: string): Extension {
  return {
    url: EXT_TRANSMISSION_IDENTIFIERS,
    extension: [
      { url: "applicationSenderCode", valueString: providerOrgIdentifier() },
      { url: "applicationReceiverCode", valueString: receiverCode },
    ],
  };
}

function assembleSubmitBundle(
  r: PasSubmitResources,
  claimProfile: string,
  providerFhirBase: string,
): Bundle {
  const patient = structuredClone(r.patient);
  const practitioner = structuredClone(r.practitioner);
  const insurer = structuredClone(r.insurer);
  const coverage = structuredClone(r.coverage);
  const order = structuredClone(r.order);
  const questionnaireResponses = r.questionnaireResponses.map((qr) =>
    structuredClone(qr),
  );
  const requestorOrg = buildRequestorOrganization();
  const careTeamPractitionerRole = buildCareTeamPractitionerRole(
    practitioner,
    requestorOrg,
  );

  ensureMemberIdentifier(patient, coverage);

  const item = buildClaimItem(order, r.orderType);
  item.careTeamSequence = [1];
  const diagnosis = extractDiagnosis(order);
  if (diagnosis) {
    item.diagnosisSequence = [1];
  }

  const claim: Claim = {
    resourceType: "Claim",
    id: crypto.randomUUID(),
    meta: { profile: [claimProfile] },
    extension: [
      buildTransmissionIdentifiers(npiOf(insurer) ?? PAYER_ORG_IDENTIFIER),
    ],
    identifier: [
      { system: CLAIM_IDENTIFIER_SYSTEM, value: crypto.randomUUID() },
    ],
    status: "active",
    type: { coding: [{ system: CLAIM_TYPE_SYSTEM, code: "professional" }] },
    use: "preauthorization",
    patient: { reference: referenceFor(patient) },
    created: today(),
    provider: { reference: referenceFor(requestorOrg) },
    priority: { coding: [{ system: PROCESS_PRIORITY_SYSTEM, code: "normal" }] },
    insurer: { reference: referenceFor(insurer) },
    insurance: [
      {
        sequence: 1,
        focal: true,
        coverage: { reference: referenceFor(coverage) },
      },
    ],
    careTeam: [
      {
        sequence: 1,
        provider: { reference: referenceFor(careTeamPractitionerRole) },
        extension: [{ url: EXT_CARE_TEAM_CLAIM_SCOPE, valueBoolean: true }],
      },
    ],
    item: [item],
  };
  if (diagnosis) {
    claim.diagnosis = [{ sequence: 1, diagnosisCodeableConcept: diagnosis }];
  }
  if (questionnaireResponses.length > 0) {
    claim.supportingInfo = questionnaireResponses.map((qr, i) =>
      additionalInformationEntry(i + 1, referenceFor(qr)),
    );
  }

  const bundledRefs = new Set(
    [
      patient,
      practitioner,
      careTeamPractitionerRole,
      requestorOrg,
      insurer,
      coverage,
      order,
      ...questionnaireResponses,
    ].map(referenceFor),
  );
  pruneUnbundledReferences(order, bundledRefs);

  const entries: BundleEntry[] = [
    entry(claim, providerFhirBase),
    entry(patient, providerFhirBase),
    entry(practitioner, providerFhirBase),
    entry(careTeamPractitionerRole, providerFhirBase),
    entry(requestorOrg, providerFhirBase),
    entry(insurer, providerFhirBase),
    entry(coverage, providerFhirBase),
    entry(order, providerFhirBase),
    ...questionnaireResponses.map((qr) => entry(qr, providerFhirBase)),
  ];

  return collectionBundle(
    PROFILE_REQUEST_BUNDLE,
    TRANSACTION_IDENTIFIER_SYSTEM,
    entries,
  );
}

/** Builds a PAS Claim/$inquire request Bundle (profile-claim-inquiry, query-by-example). */
export function buildPasInquiryBundle(
  r: PasInquiryResources,
  providerFhirBase: string,
): Bundle {
  const patient = structuredClone(r.patient);
  const practitioner = r.practitioner
    ? structuredClone(r.practitioner)
    : undefined;
  const insurer = structuredClone(r.insurer);
  const coverage = structuredClone(r.coverage);
  const requestorOrg = buildRequestorOrganization();

  ensureMemberIdentifier(patient, coverage);

  const claim: Claim = {
    resourceType: "Claim",
    id: crypto.randomUUID(),
    meta: { profile: [PROFILE_CLAIM_INQUIRY] },
    identifier: [
      { system: SUBMITTER_CLAIM_IDENTIFIER_SYSTEM, value: crypto.randomUUID() },
    ],
    status: "active",
    type: { coding: [{ system: CLAIM_TYPE_SYSTEM, code: "professional" }] },
    use: "preauthorization",
    patient: { reference: referenceFor(patient) },
    created: today(),
    provider: { reference: referenceFor(requestorOrg) },
    priority: { coding: [{ system: PROCESS_PRIORITY_SYSTEM, code: "normal" }] },
    insurer: { reference: referenceFor(insurer) },
    insurance: [
      {
        sequence: 1,
        focal: true,
        coverage: { reference: referenceFor(coverage) },
      },
    ],
    // Wildcard item to match any service line.
    item: [
      {
        sequence: 1,
        productOrService: {
          coding: [{ system: DATA_ABSENT_SYSTEM, code: "not-applicable" }],
        },
      },
    ],
  };

  const entries: BundleEntry[] = [
    entry(claim, providerFhirBase),
    entry(patient, providerFhirBase),
    ...(practitioner ? [entry(practitioner, providerFhirBase)] : []),
    entry(requestorOrg, providerFhirBase),
    entry(insurer, providerFhirBase),
    entry(coverage, providerFhirBase),
  ];

  return collectionBundle(
    PROFILE_INQUIRY_BUNDLE,
    TRANSACTION_IDENTIFIER_SYSTEM,
    entries,
  );
}

export function buildClaimItem(
  order: FhirResource,
  orderType: string,
): ClaimItem {
  return {
    sequence: 1,
    category: CLAIM_ITEM_CATEGORY,
    locationCodeableConcept: CLAIM_ITEM_LOCATION,
    extension: [
      {
        url: EXT_SERVICE_ITEM_REQUEST_TYPE,
        valueCodeableConcept: REQUEST_TYPE_HEALTH_SERVICES_REVIEW,
      },
      {
        url: EXT_CERTIFICATION_TYPE,
        valueCodeableConcept: CERTIFICATION_TYPE_INITIAL,
      },
      {
        url: EXT_REQUESTED_SERVICE,
        valueReference: { reference: referenceFor(order) },
      },
    ],
    productOrService: extractOrderCode(order, orderType) ?? {
      coding: [{ system: DATA_ABSENT_SYSTEM, code: "not-applicable" }],
    },
  };
}

/** Extracts the primary order code; each order type stores it in a different element. */
export function extractOrderCode(
  order: FhirResource,
  orderType: string,
): CodeableConcept | undefined {
  const o = order as unknown as Record<string, unknown>;
  switch (orderType) {
    case "MedicationRequest":
      return o.medicationCodeableConcept as CodeableConcept | undefined;
    case "ServiceRequest":
      return o.code as CodeableConcept | undefined;
    case "DeviceRequest":
      return o.codeCodeableConcept as CodeableConcept | undefined;
    case "NutritionOrder": {
      const oralDiet = o.oralDiet as { type?: CodeableConcept[] } | undefined;
      return oralDiet?.type?.[0];
    }
    case "VisionPrescription": {
      const lensSpecs = o.lensSpecification as
        | Array<{ product?: CodeableConcept }>
        | undefined;
      return lensSpecs?.[0]?.product;
    }
    case "CommunicationRequest": {
      const categories = o.category as CodeableConcept[] | undefined;
      return categories?.[0];
    }
    default:
      return undefined;
  }
}

function extractDiagnosis(order: FhirResource): CodeableConcept | undefined {
  const o = order as { reasonCode?: CodeableConcept[] };
  return o.reasonCode?.[0];
}

/**
 * Adds a type=MB member identifier derived from Coverage.subscriberId to the Patient and to the
 * Coverage itself when either lacks one; profile-coverage requires a memberid-slice identifier.
 */
function ensureMemberIdentifier(patient: Patient, coverage: Coverage): void {
  coverage.relationship ??= {
    coding: [
      {
        system: "http://terminology.hl7.org/CodeSystem/subscriber-relationship",
        code: "self",
      },
      { system: "https://codesystem.x12.org/005010/1069", code: "18" },
    ],
  };
  const subscriberId = coverage.subscriberId;
  if (!subscriberId) return;

  const mbIdentifier = {
    type: {
      coding: [
        { system: MB_TYPE_SYSTEM, code: "MB", display: "Member Number" },
      ],
    },
    system: MEMBER_IDENTIFIER_SYSTEM,
    value: subscriberId,
  };

  patient.identifier ??= [];
  const patientHasMb = patient.identifier.some((id) =>
    id.type?.coding?.some((c) => c.code === "MB"),
  );
  if (!patientHasMb) {
    patient.identifier.push(mbIdentifier);
  }

  coverage.identifier ??= [];
  const coverageHasMb = coverage.identifier.some((id) =>
    id.type?.coding?.some((c) => c.code === "MB"),
  );
  if (!coverageHasMb) {
    coverage.identifier.push(mbIdentifier);
  }
}

function additionalInformationEntry(
  sequence: number,
  reference: string,
): ClaimSupportingInfo {
  return {
    sequence,
    category: {
      coding: [{ system: PAS_TEMP_CODES, code: "additionalInformation" }],
    },
    valueReference: { reference },
    extension: [
      {
        url: EXT_DOCUMENT_INFORMATION,
        extension: [
          {
            url: "reportTypeCode",
            // ponytail: generic PWK01 support-data code; use the payer-requested code when fulfilling a solicited request
            valueCodeableConcept: {
              coding: [
                {
                  system: X12_PWK01_SYSTEM,
                  code: "OZ",
                  display: "Support Data for Claim",
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function collectionBundle(
  profile: string,
  identifierSystem: string,
  entries: BundleEntry[],
): Bundle {
  return {
    resourceType: "Bundle",
    meta: { profile: [profile] },
    identifier: { system: identifierSystem, value: crypto.randomUUID() },
    type: "collection",
    timestamp: new Date().toISOString(),
    entry: entries,
  };
}

function entry(resource: FhirResource, providerFhirBase: string): BundleEntry {
  stripVolatileMeta(resource);
  const fullUrl = `${providerFhirBase}/${resource.resourceType}/${(resource as { id?: string }).id}`;
  return { fullUrl, resource };
}

/** Removes version metadata so a stale versionId does not trip the payer's optimistic locking. */
function stripVolatileMeta(resource: FhirResource): void {
  if (!resource.meta) return;
  resource.meta.versionId = undefined;
  resource.meta.lastUpdated = undefined;
  if (Object.values(resource.meta).every((v) => v === undefined)) {
    resource.meta = undefined;
  }
}

/**
 * A typed `ResourceType/id` reference. The payer resolves these against the bundled resources by
 * type and id; an opaque urn:uuid reference is rejected in a collection bundle.
 */
function referenceFor(resource: FhirResource): string {
  return `${resource.resourceType}/${(resource as { id?: string }).id}`;
}

/**
 * Removes literal references from the bundled order copy that do not resolve
 * within the bundle. A PAS request bundle must be self-contained: the payer
 * cannot resolve this provider's resource ids, so an unbundled reference (for
 * example the order's encounter) would be meaningless or rejected there.
 * Identifier and display are kept; contained (#) references are left alone.
 */
export function pruneUnbundledReferences(
  node: unknown,
  bundledRefs: Set<string>,
): void {
  if (Array.isArray(node)) {
    for (const element of node) {
      pruneUnbundledReferences(element, bundledRefs);
    }
    for (let i = node.length - 1; i >= 0; i--) {
      if (isEmptyObject(node[i])) {
        node.splice(i, 1);
      }
    }
    return;
  }
  if (!node || typeof node !== "object") {
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const ref = (value as { reference?: unknown }).reference;
    if (
      typeof ref === "string" &&
      !ref.startsWith("#") &&
      !ref.includes("://") &&
      !bundledRefs.has(ref)
    ) {
      delete (value as { reference?: unknown }).reference;
    }
    pruneUnbundledReferences(value, bundledRefs);
    const pruned = obj[key];
    if (
      isEmptyObject(pruned) ||
      (Array.isArray(pruned) && pruned.length === 0)
    ) {
      delete obj[key];
    }
  }
}

function isEmptyObject(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
