import type { Extension } from "fhir/r4";

export const QR_CONTEXT_EXT_URL =
  "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/qr-context";
export const QR_COVERAGE_EXT_URL =
  "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/qr-coverage";

/**
 * Upserts the DTR QuestionnaireResponse context extensions: one qr-context per order reference, plus
 * the qr-coverage reference required by the DTR 2.2.0 dtr-questionnaireresponse profile.
 */
export function upsertQrDtrExtensions(
  extensions: Extension[],
  orderRefs: string[],
  coverageRef?: string,
): Extension[] {
  const filtered = extensions.filter(
    (e) => e.url !== QR_CONTEXT_EXT_URL && e.url !== QR_COVERAGE_EXT_URL,
  );
  for (const ref of orderRefs) {
    filtered.push({
      url: QR_CONTEXT_EXT_URL,
      valueReference: { reference: ref },
    });
  }
  if (coverageRef) {
    filtered.push({
      url: QR_COVERAGE_EXT_URL,
      valueReference: { reference: coverageRef },
    });
  }
  return filtered;
}
