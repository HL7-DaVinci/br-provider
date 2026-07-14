import type { Extension } from "fhir/r4";
import type {
  EncounterOrderResourceType,
  OrderResourceType,
} from "./order-types";

const HCPCS_SYSTEM = "http://www.cms.gov/Medicare/Coding/HCPCSReleaseCodeSets";
const RXNORM_SYSTEM = "http://www.nlm.nih.gov/research/umls/rxnorm";
const CPT_SYSTEM = "http://www.ama-assn.org/go/cpt";

export type TemplateCategory = "DME" | "Services" | "Medications";

export interface OrderTemplate {
  id: string;
  code: string;
  display: string;
  description: string;
  category: TemplateCategory;
  resourceType: OrderResourceType;
  codeSystem: string;
}

export interface SelectedOrder {
  templateId: string;
  template: OrderTemplate;
  customizations: Record<string, unknown>;
  expanded: boolean;
  serverId?: string;
  persistedExtensions?: Extension[];
}

// Templates are aligned with payer RI library.
const TEMPLATES: OrderTemplate[] = [
  // DME (DeviceRequest)
  {
    id: "dme-e0424",
    code: "E0424",
    display: "Stationary Oxygen System",
    description:
      "Payer requires prior authorization and provides a questionnaire to complete",
    category: "DME",
    resourceType: "DeviceRequest",
    codeSystem: HCPCS_SYSTEM,
  },
  {
    id: "dme-e0431",
    code: "E0431",
    display: "Portable Gaseous Oxygen System",
    description:
      "Payer checks whether the supplier is in network when the order is dispatched",
    category: "DME",
    resourceType: "DeviceRequest",
    codeSystem: HCPCS_SYSTEM,
  },
  {
    id: "dme-e1390",
    code: "E1390",
    display: "Oxygen Concentrator",
    description:
      "Payer checks whether the supplier is in network when the order is dispatched",
    category: "DME",
    resourceType: "DeviceRequest",
    codeSystem: HCPCS_SYSTEM,
  },
  {
    id: "dme-e0250",
    code: "E0250",
    display: "Hospital Bed with Side Rails",
    description:
      "Covered by the payer; supporting documentation may be requested",
    category: "DME",
    resourceType: "DeviceRequest",
    codeSystem: HCPCS_SYSTEM,
  },
  {
    id: "dme-e0251",
    code: "E0251",
    display: "Hospital Bed without Mattress",
    description: "Payer responds with a covered alternative (E0250) to swap in",
    category: "DME",
    resourceType: "DeviceRequest",
    codeSystem: HCPCS_SYSTEM,
  },
  {
    id: "dme-e0466",
    code: "E0466",
    display: "Home Ventilator, Non-Invasive Interface",
    description:
      "Payer requires prior authorization with supporting documentation",
    category: "DME",
    resourceType: "DeviceRequest",
    codeSystem: HCPCS_SYSTEM,
  },
  {
    id: "dme-l8000",
    code: "L8000",
    display: "Breast Prosthesis, Mastectomy Bra",
    description: "Payer requires prior authorization",
    category: "DME",
    resourceType: "DeviceRequest",
    codeSystem: HCPCS_SYSTEM,
  },
  {
    id: "dme-j3490",
    code: "J3490",
    display: "Unclassified Drug (Investigational)",
    description: "Not covered; payer responds that this service is excluded",
    category: "DME",
    resourceType: "DeviceRequest",
    codeSystem: HCPCS_SYSTEM,
  },

  // Services (ServiceRequest)
  {
    id: "svc-g0151",
    code: "G0151",
    display: "Home Health Physical Therapy",
    description: "Payer requires prior authorization for home health services",
    category: "Services",
    resourceType: "ServiceRequest",
    codeSystem: HCPCS_SYSTEM,
  },
  {
    id: "svc-g0299",
    code: "G0299",
    display: "Home Health RN Services",
    description: "Payer requires prior authorization for home health services",
    category: "Services",
    resourceType: "ServiceRequest",
    codeSystem: HCPCS_SYSTEM,
  },
  {
    id: "svc-72148",
    code: "72148",
    display: "MRI Lumbar Spine without Contrast",
    description:
      "Payer checks whether the imaging facility is in network when the order is dispatched",
    category: "Services",
    resourceType: "ServiceRequest",
    codeSystem: CPT_SYSTEM,
  },

  // Medications (MedicationRequest) - codes match payer library focus codes
  {
    id: "med-azathioprine-105585",
    code: "105585",
    display: "Azathioprine",
    description:
      "Payer requests supporting documentation for immunosuppressive drugs",
    category: "Medications",
    resourceType: "MedicationRequest",
    codeSystem: RXNORM_SYSTEM,
  },
  {
    id: "med-cyclosporine-105611",
    code: "105611",
    display: "Cyclosporine",
    description:
      "Payer requests supporting documentation for immunosuppressive drugs",
    category: "Medications",
    resourceType: "MedicationRequest",
    codeSystem: RXNORM_SYSTEM,
  },
  {
    id: "med-morphine-197696",
    code: "197696",
    display: "Morphine Sulfate",
    description:
      "Payer runs opioid safety checks and may require prior authorization",
    category: "Medications",
    resourceType: "MedicationRequest",
    codeSystem: RXNORM_SYSTEM,
  },
  {
    id: "med-hydrocodone-acetaminophen-1049502",
    code: "1049502",
    display: "Hydrocodone/Acetaminophen",
    description:
      "Payer runs opioid safety checks and may require prior authorization",
    category: "Medications",
    resourceType: "MedicationRequest",
    codeSystem: RXNORM_SYSTEM,
  },
];

const CUSTOM_TEMPLATES_STORAGE_KEY = "custom-order-templates";

const CATEGORY_BY_RESOURCE_TYPE: Record<
  EncounterOrderResourceType,
  TemplateCategory
> = {
  DeviceRequest: "DME",
  ServiceRequest: "Services",
  MedicationRequest: "Medications",
};

export function categoryForResourceType(
  resourceType: EncounterOrderResourceType,
): TemplateCategory {
  return CATEGORY_BY_RESOURCE_TYPE[resourceType];
}

export interface CustomTemplateInput {
  code: string;
  display: string;
  codeSystem: string;
  resourceType: EncounterOrderResourceType;
}

export function getCustomTemplates(): OrderTemplate[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TEMPLATES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCustomTemplate(input: CustomTemplateInput): OrderTemplate {
  const template: OrderTemplate = {
    id: `custom-${input.resourceType}-${input.code}`,
    code: input.code,
    display: input.display || input.code,
    description: `Custom order code (${input.codeSystem})`,
    category: categoryForResourceType(input.resourceType),
    resourceType: input.resourceType,
    codeSystem: input.codeSystem,
  };
  const existing = getCustomTemplates().filter((t) => t.id !== template.id);
  localStorage.setItem(
    CUSTOM_TEMPLATES_STORAGE_KEY,
    JSON.stringify([...existing, template]),
  );
  return template;
}

export function deleteCustomTemplate(id: string): void {
  const remaining = getCustomTemplates().filter((t) => t.id !== id);
  localStorage.setItem(CUSTOM_TEMPLATES_STORAGE_KEY, JSON.stringify(remaining));
}

export function getTemplatesByCategory(): Record<
  TemplateCategory,
  OrderTemplate[]
> {
  const grouped: Record<TemplateCategory, OrderTemplate[]> = {
    DME: [],
    Services: [],
    Medications: [],
  };
  for (const template of TEMPLATES) {
    grouped[template.category].push(template);
  }
  return grouped;
}

export function getTemplateById(id: string): OrderTemplate | undefined {
  return getAllTemplates().find((t) => t.id === id);
}

export function getAllTemplates(): OrderTemplate[] {
  return [...TEMPLATES, ...getCustomTemplates()];
}
