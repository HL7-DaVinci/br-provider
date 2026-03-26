export type CdsHookName = "encounter-start" | "order-select" | "order-sign";

// Resource types supported by CRD hooks
export type OrderResourceType =
  | "MedicationRequest"
  | "ServiceRequest"
  | "DeviceRequest"
  | "NutritionOrder"
  | "VisionPrescription"
  | "CommunicationRequest";

// CDS Service Discovery
export interface CdsServiceDiscovery {
  services: CdsServiceDefinition[];
}

export interface CdsServiceDefinition {
  hook: string;
  id: string;
  title?: string;
  description: string;
  prefetch?: Record<string, string>;
}

// Hook Context Variants
export interface EncounterStartContext {
  userId: string; // Practitioner/{id}
  patientId: string; // Patient/{id}
  encounterId: string; // Encounter/{id}
}

export interface OrderSelectContext {
  userId: string;
  patientId: string;
  encounterId?: string;
  selections: string[]; // IDs of selected resources
  draftOrders: { resourceType: "Bundle"; entry: unknown[] };
}

export interface OrderSignContext {
  userId: string;
  patientId: string;
  encounterId?: string;
  draftOrders: { resourceType: "Bundle"; entry: unknown[] };
}

export interface OrderDispatchContext {
  patientId: string;
  dispatchedOrders: string[];
  performer: string; // Practitioner/{id} or Organization/{id}
  fulfillmentTask?: unknown;
}

export type HookContext =
  | EncounterStartContext
  | OrderSelectContext
  | OrderSignContext
  | OrderDispatchContext;

// CDS Hook Request
export interface CdsHookRequest {
  hook: string;
  hookInstance: string; // UUID per invocation
  context: HookContext;
  prefetch?: Record<string, unknown>;
  fhirServer?: string;
  fhirAuthorization?: FhirAuthorization;
}

export interface FhirAuthorization {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
  subject: string;
  patient?: string;
}

// CDS Hook Response
export interface CdsHookResponse {
  cards: CdsCard[];
  systemActions?: SystemAction[];
}

export interface CdsCard {
  uuid?: string;
  summary: string;
  detail?: string;
  indicator: "info" | "warning" | "critical";
  source: { label: string; url?: string; icon?: string };
  suggestions?: CdsSuggestion[];
  links?: CdsLink[];
  overrideReasons?: { code: string; display: string }[];
  selectionBehavior?: "at-most-one" | "any";
}

export interface CdsSuggestion {
  label: string;
  uuid?: string;
  isRecommended?: boolean;
  actions?: SuggestionAction[];
}

export interface SuggestionAction {
  type: "create" | "update" | "delete";
  description: string;
  resource?: unknown;
  resourceId?: string;
}

export interface CdsLink {
  label: string;
  url: string;
  type: "absolute" | "smart";
  appContext?: string;
}

export interface SystemAction {
  type: "update" | "create" | "delete";
  resource: unknown;
}

// CRD Coverage Information (parsed from system action extensions)
export interface CoverageInformation {
  coverage?: string; // Reference to Coverage resource
  covered?: "covered" | "not-covered" | "conditional";
  paNeeded?: "auth-needed" | "no-auth" | "satisfied";
  docNeeded?: "no-doc" | "clinical" | "admin" | "both";
  infoNeeded?: string[]; // performer, location, billing-code
  billingCode?: { system: string; code: string; display?: string };
  reasonCode?: { system: string; code: string; display?: string }[];
  coverageAssertionId?: string;
  satisfiedPaId?: string;
  questionnaire?: string; // Canonical URL for the DTR questionnaire
  date?: string;
  detail?: string[];
  contactUrl?: string;
}
