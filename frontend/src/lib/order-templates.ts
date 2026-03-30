import type { Extension } from "fhir/r4";
import type { OrderResourceType } from "./order-types";

const HCPCS_SYSTEM = "http://www.cms.gov/Medicare/Coding/HCPCSReleaseCodeSets";

export type TemplateCategory = "DME" | "Services";

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

const TEMPLATES: OrderTemplate[] = [
  // DME (DeviceRequest)
  {
    id: "dme-e0601",
    code: "E0601",
    display: "CPAP Device",
    description: "Continuous positive airway pressure device",
    category: "DME",
    resourceType: "DeviceRequest",
    codeSystem: HCPCS_SYSTEM,
  },
  {
    id: "dme-e0470",
    code: "E0470",
    display: "BiPAP Device",
    description: "Respiratory assist device, bi-level (without backup rate)",
    category: "DME",
    resourceType: "DeviceRequest",
    codeSystem: HCPCS_SYSTEM,
  },
  {
    id: "dme-e0424",
    code: "E0424",
    display: "Stationary Oxygen System",
    description: "Stationary compressed gaseous oxygen system, rental",
    category: "DME",
    resourceType: "DeviceRequest",
    codeSystem: HCPCS_SYSTEM,
  },
  {
    id: "dme-e0250",
    code: "E0250",
    display: "Hospital Bed with Side Rails",
    description:
      "Hospital bed, fixed height, with any type side rails, with mattress",
    category: "DME",
    resourceType: "DeviceRequest",
    codeSystem: HCPCS_SYSTEM,
  },
  {
    id: "dme-e0465",
    code: "E0465",
    display: "Home Spirometer",
    description: "Home ventilator, any type, used with supplemental oxygen",
    category: "DME",
    resourceType: "DeviceRequest",
    codeSystem: HCPCS_SYSTEM,
  },
  {
    id: "dme-a4217",
    code: "A4217",
    display: "Sterile Water/Saline 500ml",
    description: "Sterile water/saline, 500 ml",
    category: "DME",
    resourceType: "DeviceRequest",
    codeSystem: HCPCS_SYSTEM,
  },
  {
    id: "dme-l8000",
    code: "L8000",
    display: "Breast prosthesis, mastectomy bra",
    description: "Breast prosthesis, mastectomy bra",
    category: "DME",
    resourceType: "DeviceRequest",
    codeSystem: HCPCS_SYSTEM,
  },

  // Services (ServiceRequest)
  {
    id: "svc-g0151",
    code: "G0151",
    display: "Home Health Services",
    description:
      "Services performed by a qualified physical therapist in the home health setting",
    category: "Services",
    resourceType: "ServiceRequest",
    codeSystem: HCPCS_SYSTEM,
  },
  {
    id: "svc-g0155",
    code: "G0155",
    display: "Clinical Social Worker",
    description:
      "Services of clinical social worker in home or hospice setting",
    category: "Services",
    resourceType: "ServiceRequest",
    codeSystem: HCPCS_SYSTEM,
  },
  {
    id: "svc-a0426",
    code: "A0426",
    display: "ALS Non-Emergency Transport",
    description:
      "Ambulance service, advanced life support, non-emergency transport",
    category: "Services",
    resourceType: "ServiceRequest",
    codeSystem: HCPCS_SYSTEM,
  },
];

export function getTemplatesByCategory(): Record<
  TemplateCategory,
  OrderTemplate[]
> {
  const grouped: Record<TemplateCategory, OrderTemplate[]> = {
    DME: [],
    Services: [],
  };
  for (const template of TEMPLATES) {
    grouped[template.category].push(template);
  }
  return grouped;
}

export function getTemplateById(id: string): OrderTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function getAllTemplates(): OrderTemplate[] {
  return TEMPLATES;
}
