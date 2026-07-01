import type {
  Bundle,
  BundleEntry,
  Claim,
  ClaimItem,
  ClaimRelated,
  ClaimSupportingInfo,
  CodeableConcept,
  Coverage,
  Extension,
  FhirResource,
  Organization,
  Patient,
  Practitioner,
  QuestionnaireResponse,
} from "fhir/r4";

/**
 * Builds the PAS request Bundles: Claim/$submit (initial and update) and Claim/$inquire.
 */

const PAS_SD = "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/";
const PROFILE_REQUEST_BUNDLE = `${PAS_SD}profile-pas-request-bundle`;
const PROFILE_INQUIRY_BUNDLE = `${PAS_SD}profile-pas-inquiry-request-bundle`;
const PROFILE_CLAIM = `${PAS_SD}profile-claim`;
const PROFILE_CLAIM_UPDATE = `${PAS_SD}profile-claim-update`;
const PROFILE_CLAIM_INQUIRY = `${PAS_SD}profile-claim-inquiry`;
const EXT_SERVICE_ITEM_REQUEST_TYPE = `${PAS_SD}extension-serviceItemRequestType`;
const EXT_CERTIFICATION_TYPE = `${PAS_SD}extension-certificationType`;
const EXT_TRANSMISSION_IDENTIFIERS = `${PAS_SD}extension-TransmissionIdentifiers`;

const CLAIM_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/claim-type";
const PROCESS_PRIORITY_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/processpriority";
const RELATED_CLAIM_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/ex-relatedclaimrelationship";
const DATA_ABSENT_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/data-absent-reason";
const MB_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0203";
const PAS_SUPPORTING_INFO_SYSTEM =
  "http://hl7.org/us/davinci-pas/CodeSystem/PASSupportingInfoType";

const CLAIM_IDENTIFIER_SYSTEM = "http://example.org/PATIENT_EVENT_TRACE_NUMBER";
const TRANSACTION_IDENTIFIER_SYSTEM =
  "http://example.org/SUBMITTER_TRANSACTION_IDENTIFIER";
const SUBMITTER_CLAIM_IDENTIFIER_SYSTEM =
  "http://example.org/SUBMITTER_CLAIM_IDENTIFIER";
const MEMBER_IDENTIFIER_SYSTEM = "http://example.org/MIN";
const US_NPI_SYSTEM = "http://hl7.org/fhir/sid/us-npi";

/** Provider org identifier: the request's applicationSenderCode and the Subscription orgIdentifier. */
export const PROVIDER_ORG_IDENTIFIER = "1122334455";
const PAYER_ORG_IDENTIFIER = "1234567893";

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
  practitioner: Practitioner;
  insurer: Organization;
  coverage: Coverage;
}

/** Builds an initial PAS Claim/$submit request Bundle. */
export function buildPasRequestBundle(r: PasSubmitResources): Bundle {
  return assembleSubmitBundle(r, PROFILE_CLAIM);
}

/**
 * Builds a PAS update Bundle: a profile-claim-update Claim carrying a `related` element that
 * references the prior Claim on the payer, so the payer detects an update rather than an initial.
 */
export function buildPasUpdateBundle(
  r: PasSubmitResources,
  priorClaimId: string,
  payerFhirUrl: string,
): Bundle {
  const related: ClaimRelated = {
    claim: { reference: `${normalizeUrl(payerFhirUrl)}/Claim/${priorClaimId}` },
    relationship: { coding: [{ system: RELATED_CLAIM_SYSTEM, code: "prior" }] },
  };
  return assembleSubmitBundle(r, PROFILE_CLAIM_UPDATE, related);
}

function npiOf(resource: Organization | Practitioner): string | undefined {
  return resource.identifier?.find((id) => id.system === US_NPI_SYSTEM)?.value;
}

function buildTransmissionIdentifiers(receiverCode: string): Extension {
  return {
    url: EXT_TRANSMISSION_IDENTIFIERS,
    extension: [
      { url: "applicationSenderCode", valueString: PROVIDER_ORG_IDENTIFIER },
      { url: "applicationReceiverCode", valueString: receiverCode },
    ],
  };
}

function assembleSubmitBundle(
  r: PasSubmitResources,
  claimProfile: string,
  related?: ClaimRelated,
): Bundle {
  const patient = structuredClone(r.patient);
  const practitioner = structuredClone(r.practitioner);
  const insurer = structuredClone(r.insurer);
  const coverage = structuredClone(r.coverage);
  const questionnaireResponses = r.questionnaireResponses.map((qr) =>
    structuredClone(qr),
  );

  ensureMemberIdentifier(patient, coverage);

  const claim: Claim = {
    resourceType: "Claim",
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
    provider: { reference: referenceFor(practitioner) },
    priority: { coding: [{ system: PROCESS_PRIORITY_SYSTEM, code: "normal" }] },
    insurer: { reference: referenceFor(insurer) },
    insurance: [
      {
        sequence: 1,
        focal: true,
        coverage: { reference: referenceFor(coverage) },
      },
    ],
    item: [buildClaimItem(r.order, r.orderType)],
  };
  if (related) claim.related = [related];
  if (questionnaireResponses.length > 0) {
    claim.supportingInfo = questionnaireResponses.map((qr, i) =>
      questionnaireSupportingInfo(i + 1, referenceFor(qr)),
    );
  }

  const entries: BundleEntry[] = [
    entry(claim, newUrn()),
    entry(patient, newUrn()),
    entry(practitioner, newUrn()),
    entry(insurer, newUrn()),
    entry(coverage, newUrn()),
    ...questionnaireResponses.map((qr) => entry(qr, newUrn())),
  ];

  return collectionBundle(
    PROFILE_REQUEST_BUNDLE,
    TRANSACTION_IDENTIFIER_SYSTEM,
    entries,
  );
}

/** Builds a PAS Claim/$inquire request Bundle (profile-claim-inquiry, query-by-example). */
export function buildPasInquiryBundle(r: PasInquiryResources): Bundle {
  const patient = structuredClone(r.patient);
  const practitioner = structuredClone(r.practitioner);
  const insurer = structuredClone(r.insurer);
  const coverage = structuredClone(r.coverage);

  ensureMemberIdentifier(patient, coverage);

  const claim: Claim = {
    resourceType: "Claim",
    meta: { profile: [PROFILE_CLAIM_INQUIRY] },
    identifier: [
      { system: SUBMITTER_CLAIM_IDENTIFIER_SYSTEM, value: crypto.randomUUID() },
    ],
    status: "active",
    type: { coding: [{ system: CLAIM_TYPE_SYSTEM, code: "professional" }] },
    use: "preauthorization",
    patient: { reference: referenceFor(patient) },
    created: today(),
    provider: { reference: referenceFor(practitioner) },
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
    entry(claim, newUrn()),
    entry(patient, newUrn()),
    entry(practitioner, newUrn()),
    entry(insurer, newUrn()),
    entry(coverage, newUrn()),
  ];

  return collectionBundle(
    PROFILE_INQUIRY_BUNDLE,
    TRANSACTION_IDENTIFIER_SYSTEM,
    entries,
  );
}

function buildClaimItem(order: FhirResource, orderType: string): ClaimItem {
  return {
    sequence: 1,
    extension: [
      {
        url: EXT_SERVICE_ITEM_REQUEST_TYPE,
        valueCodeableConcept: REQUEST_TYPE_HEALTH_SERVICES_REVIEW,
      },
      {
        url: EXT_CERTIFICATION_TYPE,
        valueCodeableConcept: CERTIFICATION_TYPE_INITIAL,
      },
    ],
    productOrService: extractOrderCode(order, orderType) ?? {
      coding: [{ system: DATA_ABSENT_SYSTEM, code: "unknown" }],
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
      return (o.medicationCodeableConcept ?? o.medicationReference) as
        | CodeableConcept
        | undefined;
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

/** Adds a type=MB member identifier derived from Coverage.subscriberId when the Patient lacks one. */
function ensureMemberIdentifier(patient: Patient, coverage: Coverage): void {
  const subscriberId = coverage.subscriberId;
  if (!subscriberId) return;

  patient.identifier ??= [];
  const hasMb = patient.identifier.some((id) =>
    id.type?.coding?.some((c) => c.code === "MB"),
  );
  if (!hasMb) {
    patient.identifier.push({
      type: {
        coding: [
          { system: MB_TYPE_SYSTEM, code: "MB", display: "Member Number" },
        ],
      },
      system: MEMBER_IDENTIFIER_SYSTEM,
      value: subscriberId,
    });
  }
}

function questionnaireSupportingInfo(
  sequence: number,
  reference: string,
): ClaimSupportingInfo {
  return {
    sequence,
    category: {
      coding: [{ system: PAS_SUPPORTING_INFO_SYSTEM, code: "questionnaire" }],
    },
    valueReference: { reference },
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

function entry(resource: FhirResource, fullUrl: string): BundleEntry {
  stripVolatileMeta(resource);
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

function newUrn(): string {
  return `urn:uuid:${crypto.randomUUID()}`;
}

/**
 * A typed `ResourceType/id` reference. The payer resolves these against the bundled resources by
 * type and id; an opaque urn:uuid reference is rejected in a collection bundle.
 */
function referenceFor(resource: FhirResource): string {
  return `${resource.resourceType}/${(resource as { id?: string }).id}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
