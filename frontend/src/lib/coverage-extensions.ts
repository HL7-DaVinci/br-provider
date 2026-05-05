import type { DomainResource, Extension } from "fhir/r4";
import type { CoverageInformation } from "@/lib/cds-types";
import type { OrderEntry } from "./order-types";

export const COVERAGE_INFO_EXT_URL =
  "http://hl7.org/fhir/us/davinci-crd/StructureDefinition/ext-coverage-information";

export function parseExtensionFields(
  extensions: Extension[],
): CoverageInformation {
  const info: CoverageInformation = {};
  const details: string[] = [];
  const reasonCodes: { system: string; code: string; display?: string }[] = [];

  for (const ext of extensions) {
    switch (ext.url) {
      case "coverage":
        info.coverage = ext.valueReference?.reference;
        break;
      case "covered":
        info.covered = ext.valueCode as CoverageInformation["covered"];
        break;
      case "pa-needed":
        info.paNeeded = ext.valueCode as CoverageInformation["paNeeded"];
        break;
      case "doc-needed":
        info.docNeeded = ext.valueCode as CoverageInformation["docNeeded"];
        break;
      case "info-needed": {
        if (!info.infoNeeded) info.infoNeeded = [];
        if (ext.valueCode) info.infoNeeded.push(ext.valueCode);
        break;
      }
      case "billingCode":
        if (ext.valueCoding) {
          info.billingCode = {
            system: ext.valueCoding.system ?? "",
            code: ext.valueCoding.code ?? "",
            display: ext.valueCoding.display,
          };
        }
        break;
      case "reasonCode":
        if (ext.valueCoding) {
          reasonCodes.push({
            system: ext.valueCoding.system ?? "",
            code: ext.valueCoding.code ?? "",
            display: ext.valueCoding.display,
          });
        }
        break;
      case "coverage-assertion-id":
        info.coverageAssertionId = ext.valueString;
        break;
      case "satisfied-pa-id":
        info.satisfiedPaId = ext.valueString;
        break;
      case "questionnaire": {
        const qUrl = ext.valueCanonical ?? ext.valueUrl;
        if (qUrl) {
          if (!info.questionnaire) info.questionnaire = [];
          info.questionnaire.push(qUrl);
        }
        break;
      }
      case "date":
        info.date = ext.valueDate;
        break;
      case "detail":
        if (ext.valueString) details.push(ext.valueString);
        break;
      case "contact":
        info.contactUrl = ext.valueUrl;
        break;
    }
  }

  if (details.length > 0) info.detail = details;
  if (reasonCodes.length > 0) info.reasonCode = reasonCodes;

  return info;
}

export function parseCoverageInfoFromResource(
  resource: DomainResource,
): CoverageInformation[] {
  if (!resource.extension) return [];

  const results: CoverageInformation[] = [];
  for (const ext of resource.extension) {
    if (ext.url !== COVERAGE_INFO_EXT_URL) continue;
    if (!ext.extension) continue;
    results.push(parseExtensionFields(ext.extension));
  }
  return results;
}

/** Whether a coverage-information block indicates DTR documentation is available. */
export const hasDtrDoc = (ci: CoverageInformation): boolean =>
  !!ci.docNeeded &&
  ci.docNeeded !== "no-doc" &&
  (ci.questionnaire?.length ?? 0) > 0;

/**
 * Returns refs (`ResourceType/id`) of orders, other than the focus order, that
 * list at least one of `focusCanonicals` in a DTR-relevant CoverageInformation
 * entry. Used to coordinate cross-order questionnaire reuse during DTR launch.
 */
export function findOrdersSharingCanonicals(
  orders: OrderEntry[],
  focusOrderRef: string,
  focusCanonicals: string[],
): string[] {
  if (focusCanonicals.length === 0) return [];
  const focusSet = new Set(focusCanonicals);
  const refs = new Set<string>();
  for (const entry of orders) {
    const id = entry.resource.id;
    if (!id) continue;
    const ref = `${entry.resourceType}/${id}`;
    if (ref === focusOrderRef) continue;
    const cis = parseCoverageInfoFromResource(entry.resource).filter(hasDtrDoc);
    for (const ci of cis) {
      const matched = (ci.questionnaire ?? []).some((c) => focusSet.has(c));
      if (matched) {
        refs.add(ref);
        break;
      }
    }
  }
  return Array.from(refs);
}

/**
 * Returns true iff `a` and `b` share the DTR-IG-defined primary key for
 * a CoverageInformation extension repetition: the combination of `coverage`
 * AND `coverage-assertion-id`. Both halves must be present on both sides;
 * a CI missing either half cannot participate in a primary-key match.
 */
export function coverageInfoPrimaryKeyEquals(
  a: CoverageInformation,
  b: CoverageInformation,
): boolean {
  if (!a.coverage || !a.coverageAssertionId) return false;
  if (!b.coverage || !b.coverageAssertionId) return false;
  return (
    a.coverage === b.coverage && a.coverageAssertionId === b.coverageAssertionId
  );
}
