import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OrderResourceType } from "@/lib/order-types";

const ORDER_TYPE_LABELS: Record<OrderResourceType, string> = {
  MedicationRequest: "Medication Order",
  ServiceRequest: "Service/Procedure Order",
  DeviceRequest: "Device Order",
  NutritionOrder: "Nutrition Order",
  VisionPrescription: "Vision Prescription",
  CommunicationRequest: "Communication Request",
};

const ORDER_TYPES = Object.keys(ORDER_TYPE_LABELS) as OrderResourceType[];

interface OrderTypeSelectorProps {
  value: OrderResourceType;
  onValueChange: (value: OrderResourceType) => void;
}

export function OrderTypeSelector({
  value,
  onValueChange,
}: OrderTypeSelectorProps) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" htmlFor="order-type">
        Order Type
      </label>
      <Select
        value={value}
        onValueChange={(v) => onValueChange(v as OrderResourceType)}
      >
        <SelectTrigger id="order-type" className="w-full">
          <SelectValue placeholder="Select order type" />
        </SelectTrigger>
        <SelectContent>
          {ORDER_TYPES.map((type) => (
            <SelectItem key={type} value={type}>
              {ORDER_TYPE_LABELS[type]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
