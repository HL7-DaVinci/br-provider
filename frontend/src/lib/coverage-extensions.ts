import type { DomainResource, Extension } from "fhir/r4";
import type { CoverageInformation } from "@/lib/cds-types";

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
