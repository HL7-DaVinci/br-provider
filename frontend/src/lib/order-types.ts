import type {
  CodeableConcept,
  CommunicationRequest,
  DeviceRequest,
  MedicationRequest,
  NutritionOrder,
  ServiceRequest,
  VisionPrescription,
} from "fhir/r4";

export type OrderResourceType =
  | "MedicationRequest"
  | "ServiceRequest"
  | "DeviceRequest"
  | "NutritionOrder"
  | "VisionPrescription"
  | "CommunicationRequest";

export type EncounterOrderResourceType = Extract<
  OrderResourceType,
  "ServiceRequest" | "MedicationRequest" | "DeviceRequest"
>;

export type OrderResource =
  | ServiceRequest
  | MedicationRequest
  | DeviceRequest
  | NutritionOrder
  | VisionPrescription
  | CommunicationRequest;

export type EncounterOrderResource =
  | ServiceRequest
  | MedicationRequest
  | DeviceRequest;

export interface OrderEntry {
  resource: OrderResource;
  resourceType: OrderResourceType;
}

export const ENCOUNTER_ORDER_TYPES = [
  "ServiceRequest",
  "MedicationRequest",
  "DeviceRequest",
] as const satisfies readonly EncounterOrderResourceType[];

export const ORDER_TYPES = [
  "ServiceRequest",
  "MedicationRequest",
  "DeviceRequest",
  "NutritionOrder",
  "VisionPrescription",
  "CommunicationRequest",
] as const satisfies readonly OrderResourceType[];

const ORDER_TYPE_LABELS: Record<OrderResourceType, string> = {
  ServiceRequest: "Service",
  MedicationRequest: "Medication",
  DeviceRequest: "Device",
  NutritionOrder: "Nutrition",
  VisionPrescription: "Vision",
  CommunicationRequest: "Communication",
};

export function isOrderResourceType(
  resourceType: string,
): resourceType is OrderResourceType {
  return ORDER_TYPES.includes(resourceType as OrderResourceType);
}

export function isEncounterOrderResource(
  resource: OrderResource,
): resource is EncounterOrderResource {
  return ENCOUNTER_ORDER_TYPES.includes(
    resource.resourceType as EncounterOrderResourceType,
  );
}

export function formatOrderType(resourceType: string): string {
  return ORDER_TYPE_LABELS[resourceType as OrderResourceType] ?? resourceType;
}

export function getOrderCode(
  resource: OrderResource,
): CodeableConcept | undefined {
  switch (resource.resourceType) {
    case "ServiceRequest":
      return resource.code;
    case "MedicationRequest":
      return resource.medicationCodeableConcept;
    case "DeviceRequest":
      return resource.codeCodeableConcept;
    case "NutritionOrder":
      return resource.oralDiet?.type?.[0];
    case "VisionPrescription":
      return undefined;
    case "CommunicationRequest":
      return resource.category?.[0];
    default:
      return undefined;
  }
}

export function getOrderDate(resource: OrderResource): string | undefined {
  switch (resource.resourceType) {
    case "ServiceRequest":
    case "MedicationRequest":
    case "DeviceRequest":
    case "CommunicationRequest":
      return resource.authoredOn;
    case "NutritionOrder":
      return resource.dateTime;
    case "VisionPrescription":
      return resource.dateWritten;
    default:
      return undefined;
  }
}

export function getOrderOccurrenceDate(
  resource: EncounterOrderResource,
): string | undefined {
  switch (resource.resourceType) {
    case "ServiceRequest":
    case "DeviceRequest":
      return resource.occurrenceDateTime;
    case "MedicationRequest":
      return resource.authoredOn;
  }
}

export function getOrderInsuranceReference(
  resource: EncounterOrderResource,
): string | undefined {
  return resource.insurance?.[0]?.reference;
}

export function getOrderReasonReference(
  resource: EncounterOrderResource,
): string | undefined {
  return resource.reasonReference?.[0]?.reference;
}

export function getOrderPriority(
  resource: EncounterOrderResource,
): string | undefined {
  return resource.priority;
}

export function getOrderNoteText(
  resource: EncounterOrderResource,
): string | undefined {
  return resource.note?.[0]?.text;
}

export function getOrderIntent(
  resource: EncounterOrderResource,
): string | undefined {
  return resource.intent;
}
