import type { QuestionnaireResponse } from "fhir/r4";

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
  intendedUse: IntendedUse;
}

/**
 * Upserts the DTR QuestionnaireResponse context extensions required by the DTR 2.2.0
 * dtr-questionnaireresponse profile: one qr-context per order reference, the required
 * qr-coverage reference, and the required intendedUse. Mutates `qr.extension` in place.
 */
export function upsertQrDtrExtensions(
  qr: QuestionnaireResponse,
  { orderRefs, coverageRef, intendedUse }: UpsertQrDtrExtensionsOptions,
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
  for (const ref of orderRefs) {
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
