import type {
  CodeableConcept,
  CommunicationRequest,
  DeviceRequest,
  Dosage,
  HumanName,
  Identifier,
  MedicationRequest,
  NutritionOrder,
  Resource,
  ServiceRequest,
  VisionPrescription,
} from "fhir/r4";

/**
 * Format a FHIR HumanName array into a display string.
 * Prefers "official" use, falls back to first available name.
 */
export function formatPatientName(names?: HumanName[]): string {
  if (!names?.length) return "Unknown";

  const name =
    names.find((n) => n.use === "official") ??
    names.find((n) => n.use === "usual") ??
    names[0];

  if (name.text) return name.text;

  const parts: string[] = [];
  if (name.family) parts.push(name.family);
  if (name.given?.length) {
    parts.push(name.given.join(" "));
  }

  if (parts.length === 0) return "Unknown";

  // "Family, Given" format if we have both
  if (name.family && name.given?.length) {
    return `${name.family}, ${name.given.join(" ")}`;
  }

  return parts.join(" ");
}

/**
 * Calculate age from a birth date string (YYYY-MM-DD).
 */
export function calculateAge(birthDate?: string): string {
  if (!birthDate) return "";

  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }

  return `${age}y`;
}

/**
 * Format a date string for clinical display (MM/DD/YYYY).
 * Handles FHIR date formats: YYYY, YYYY-MM, YYYY-MM-DD, and full dateTime.
 */
export function formatClinicalDate(dateStr?: string): string {
  if (!dateStr) return "";

  // Handle partial dates
  if (/^\d{4}$/.test(dateStr)) return dateStr;
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    const [year, month] = dateStr.split("-");
    return `${month}/${year}`;
  }

  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;

  return date.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

/**
 * Format a CodeableConcept for display.
 * Prefers text, then first coding display, then first coding code.
 */
export function formatCodeableConcept(concept?: CodeableConcept): string {
  if (!concept) return "";
  if (concept.text) return concept.text;
  if (concept.coding?.length) {
    return concept.coding[0].display ?? concept.coding[0].code ?? "";
  }
  return "";
}

/**
 * Format dosage instructions for display.
 */
export function formatDosage(dosage?: Dosage[]): string {
  if (!dosage?.length) return "";

  const first = dosage[0];
  if (first.text) return first.text;

  const parts: string[] = [];

  if (first.doseAndRate?.length) {
    const dose = first.doseAndRate[0];
    if (dose.doseQuantity) {
      parts.push(
        `${dose.doseQuantity.value ?? ""} ${dose.doseQuantity.unit ?? ""}`.trim(),
      );
    }
  }

  if (first.timing?.code?.text) {
    parts.push(first.timing.code.text);
  } else if (first.timing?.repeat?.frequency && first.timing?.repeat?.period) {
    parts.push(
      `${first.timing.repeat.frequency}x per ${first.timing.repeat.period} ${first.timing.repeat.periodUnit ?? ""}`.trim(),
    );
  }

  if (first.route?.text) {
    parts.push(first.route.text);
  }

  return parts.join(", ") || "";
}

/**
 * Get the primary identifier (MRN) from identifiers.
 * Looks for type "MR" (Medical Record Number) first, then falls back to first identifier.
 */
export function getPrimaryIdentifier(
  identifiers?: Identifier[],
): string | undefined {
  if (!identifiers?.length) return undefined;

  const mrn = identifiers.find((id) =>
    id.type?.coding?.some((c) => c.code === "MR"),
  );

  return mrn?.value ?? identifiers[0]?.value;
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  ServiceRequest: "Service",
  MedicationRequest: "Medication",
  DeviceRequest: "Device",
  NutritionOrder: "Nutrition",
  VisionPrescription: "Vision",
  CommunicationRequest: "Communication",
};

/**
 * Human-friendly label for a FHIR order resource type.
 */
export function formatOrderType(resourceType: string): string {
  return ORDER_TYPE_LABELS[resourceType] ?? resourceType;
}

/**
 * Extract the primary CodeableConcept from any CRD order resource.
 */
export function getOrderCode(resource: Resource): CodeableConcept | undefined {
  switch (resource.resourceType) {
    case "ServiceRequest":
      return (resource as ServiceRequest).code;
    case "MedicationRequest":
      return (resource as MedicationRequest).medicationCodeableConcept;
    case "DeviceRequest":
      return (resource as DeviceRequest).codeCodeableConcept;
    case "NutritionOrder":
      return (resource as NutritionOrder).oralDiet?.type?.[0];
    case "VisionPrescription":
      return undefined; // VisionPrescription uses lensSpecification, no single code
    case "CommunicationRequest":
      return (resource as CommunicationRequest).category?.[0];
    default:
      return undefined;
  }
}

/**
 * Extract the most relevant date from any CRD order resource.
 */
export function getOrderDate(resource: Resource): string | undefined {
  switch (resource.resourceType) {
    case "ServiceRequest":
      return (
        (resource as ServiceRequest).authoredOn ?? resource.meta?.lastUpdated
      );
    case "MedicationRequest":
      return (
        (resource as MedicationRequest).authoredOn ?? resource.meta?.lastUpdated
      );
    case "DeviceRequest":
      return (
        (resource as DeviceRequest).authoredOn ?? resource.meta?.lastUpdated
      );
    case "NutritionOrder":
      return (
        (resource as NutritionOrder).dateTime ?? resource.meta?.lastUpdated
      );
    case "VisionPrescription":
      return (
        (resource as VisionPrescription).dateWritten ??
        resource.meta?.lastUpdated
      );
    case "CommunicationRequest":
      return (
        (resource as CommunicationRequest).authoredOn ??
        resource.meta?.lastUpdated
      );
    default:
      return resource.meta?.lastUpdated;
  }
}
