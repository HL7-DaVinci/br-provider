import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CodeSearch } from "./code-search";

const EYE_OPTIONS = [
  { value: "right", label: "Right (OD)" },
  { value: "left", label: "Left (OS)" },
] as const;

/** Lens product type value set */
const LENS_PRODUCT_VS = "http://hl7.org/fhir/ValueSet/vision-product";

interface VisionPrescriptionFieldsProps {
  data: Record<string, unknown>;
  onUpdate: (fields: Record<string, unknown>) => void;
}

export function VisionPrescriptionFields({
  data,
  onUpdate,
}: VisionPrescriptionFieldsProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Lens Specification</p>

      {/* Product */}
      <CodeSearch
        label="Product"
        valueSetUrl={LENS_PRODUCT_VS}
        value={
          data.lensProduct as { code?: string; display?: string } | undefined
        }
        onChange={(v) => onUpdate({ lensProduct: v })}
        placeholder="Search lens products..."
      />

      {/* Eye */}
      <div className="space-y-1.5">
        <Label>Eye</Label>
        <Select
          value={(data.eye as string) ?? ""}
          onValueChange={(v) => onUpdate({ eye: v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select eye" />
          </SelectTrigger>
          <SelectContent>
            {EYE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Sphere, Cylinder, Axis in a row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <Label>Sphere</Label>
          <NumberInput
            placeholder="+/-"
            step={0.25}
            value={(data.sphere as string) ?? ""}
            onChange={(e) => onUpdate({ sphere: e.currentTarget.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Cylinder</Label>
          <NumberInput
            placeholder="+/-"
            step={0.25}
            value={(data.cylinder as string) ?? ""}
            onChange={(e) => onUpdate({ cylinder: e.currentTarget.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Axis</Label>
          <NumberInput
            placeholder="0-180"
            min={0}
            max={180}
            step={1}
            value={(data.axis as string) ?? ""}
            onChange={(e) => onUpdate({ axis: e.currentTarget.value })}
          />
        </div>
      </div>

      {/* Add and Power */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label>Add (near)</Label>
          <NumberInput
            placeholder="+0.00"
            step={0.25}
            min={0}
            value={(data.add as string) ?? ""}
            onChange={(e) => onUpdate({ add: e.currentTarget.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Power</Label>
          <NumberInput
            placeholder="+/-"
            step={0.25}
            value={(data.power as string) ?? ""}
            onChange={(e) => onUpdate({ power: e.currentTarget.value })}
          />
        </div>
      </div>
    </div>
  );
}
