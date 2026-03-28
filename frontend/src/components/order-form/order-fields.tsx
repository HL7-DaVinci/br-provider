import type { OrderResourceType } from "@/lib/order-types";
import { CommunicationRequestFields } from "./communication-request-fields";
import { DeviceRequestFields } from "./device-request-fields";
import { MedicationRequestFields } from "./medication-request-fields";
import { NutritionOrderFields } from "./nutrition-order-fields";
import { ServiceRequestFields } from "./service-request-fields";
import { VisionPrescriptionFields } from "./vision-prescription-fields";

interface OrderFieldsProps {
  orderType: OrderResourceType;
  data: Record<string, unknown>;
  onUpdate: (fields: Record<string, unknown>) => void;
}

/**
 * Renders the resource-specific order fields based on the given order type.
 */
export function OrderFields({ orderType, data, onUpdate }: OrderFieldsProps) {
  switch (orderType) {
    case "MedicationRequest":
      return <MedicationRequestFields data={data} onUpdate={onUpdate} />;
    case "ServiceRequest":
      return <ServiceRequestFields data={data} onUpdate={onUpdate} />;
    case "DeviceRequest":
      return <DeviceRequestFields data={data} onUpdate={onUpdate} />;
    case "NutritionOrder":
      return <NutritionOrderFields data={data} onUpdate={onUpdate} />;
    case "VisionPrescription":
      return <VisionPrescriptionFields data={data} onUpdate={onUpdate} />;
    case "CommunicationRequest":
      return <CommunicationRequestFields data={data} onUpdate={onUpdate} />;
    default: {
      const _exhaustive: never = orderType;
      throw new Error(`Unhandled order type: ${_exhaustive}`);
    }
  }
}
