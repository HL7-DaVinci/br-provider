import type { FhirResource, QuestionnaireResponse } from "fhir/r4";

export const QR_CONTEXT_EXT_URL =
  "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/qr-context";
export const QR_COVERAGE_EXT_URL =
  "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/qr-coverage";
export const INTENDED_USE_EXT_URL =
  "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/intendedUse";
export const INTENDED_USE_CODE_SYSTEM =
  "http://hl7.org/fhir/us/davinci-crd/CodeSystem/coverage-information-codes";

/** Per the dtr-questionnaireresponse profile's intendedUse value set. */
export type IntendedUse = "withpa" | "withorder" | "withclaim" | "retain-doc";

export interface UpsertQrDtrExtensionsOptions {
  orderRefs: string[];
  coverageRef: string;
  encounterRef?: string;
  intendedUse: IntendedUse;
}

/**
 * Upserts the DTR QuestionnaireResponse context extensions required by the
 * dtr-questionnaireresponse profile: qr-context references for each order, the Coverage,
 * and the Encounter when known (DTR 2.0.1 requires at least one Coverage context and one
 * Request-or-Encounter context), plus the qr-coverage reference (DTR 2.2.0) and the
 * required intendedUse. Mutates `qr.extension` in place.
 */
export function upsertQrDtrExtensions(
  qr: QuestionnaireResponse,
  {
    orderRefs,
    coverageRef,
    encounterRef,
    intendedUse,
  }: UpsertQrDtrExtensionsOptions,
): void {
  const existingIntendedUse = (qr.extension ?? []).find(
    (e) =>
      e.url === INTENDED_USE_EXT_URL &&
      e.valueCodeableConcept?.coding?.some(
        (c) => c.system === INTENDED_USE_CODE_SYSTEM && c.code === intendedUse,
      ),
  );
  const filtered = (qr.extension ?? []).filter(
    (e) =>
      e.url !== QR_CONTEXT_EXT_URL &&
      e.url !== QR_COVERAGE_EXT_URL &&
      e.url !== INTENDED_USE_EXT_URL,
  );
  const contextRefs = [...orderRefs, coverageRef];
  if (encounterRef) contextRefs.push(encounterRef);
  for (const ref of contextRefs) {
    filtered.push({
      url: QR_CONTEXT_EXT_URL,
      valueReference: { reference: ref },
    });
  }
  filtered.push({
    url: QR_COVERAGE_EXT_URL,
    valueReference: { reference: coverageRef },
  });
  filtered.push(
    existingIntendedUse ?? {
      url: INTENDED_USE_EXT_URL,
      valueCodeableConcept: {
        coding: [{ system: INTENDED_USE_CODE_SYSTEM, code: intendedUse }],
      },
    },
  );
  qr.extension = filtered;
}

/**
 * Copies extensions the target does not already carry (matched by url), bringing any
 * referenced contained resources along. Extensions with a local reference whose contained
 * target is missing from the source are skipped so the target never carries a dangling
 * reference.
 */
export function copyMissingExtensionsWithContained(
  source: QuestionnaireResponse,
  target: QuestionnaireResponse,
): void {
  const existingUrls = new Set((target.extension ?? []).map((e) => e.url));
  for (const ext of source.extension ?? []) {
    if (existingUrls.has(ext.url)) continue;
    const reference = ext.valueReference?.reference;
    if (reference?.startsWith("#")) {
      const localId = reference.slice(1);
      const contained = (source.contained ?? []).find(
        (resource) => resource.id === localId,
      );
      if (!contained) continue;
      target.contained = target.contained ?? [];
      if (!target.contained.some((resource) => resource.id === localId)) {
        target.contained.push(contained as FhirResource);
      }
    }
    target.extension = target.extension ?? [];
    target.extension.push(ext);
  }
}
