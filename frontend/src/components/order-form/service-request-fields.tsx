import { Input } from "@/components/ui/input";
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

const PERFORMER_TYPES = [
  "General Practice",
  "Cardiology",
  "Orthopedics",
  "Radiology",
  "Neurology",
  "Oncology",
  "Physical Therapy",
  "Occupational Therapy",
  "Surgery",
  "Other",
] as const;

/** CPT / HCPCS value set for procedure code search */
const PROCEDURE_VS = "http://hl7.org/fhir/ValueSet/procedure-code";

interface ServiceRequestFieldsProps {
  data: Record<string, unknown>;
  onUpdate: (fields: Record<string, unknown>) => void;
}

export function ServiceRequestFields({
  data,
  onUpdate,
}: ServiceRequestFieldsProps) {
  return (
    <div className="space-y-4">
      {/* Procedure / service code */}
      <CodeSearch
        label="Procedure / Service Code"
        valueSetUrl={PROCEDURE_VS}
        value={
          data.serviceCode as { code?: string; display?: string } | undefined
        }
        onChange={(v) => onUpdate({ serviceCode: v })}
        placeholder="Search CPT/HCPCS codes..."
      />

      {/* Body site */}
      <div className="space-y-1.5">
        <Label>Body Site</Label>
        <Input
          placeholder="e.g. Left knee, Right shoulder"
          value={(data.bodySite as string) ?? ""}
          onChange={(e) => onUpdate({ bodySite: e.target.value })}
        />
      </div>

      {/* Quantity */}
      <div className="space-y-1.5">
        <Label>Quantity</Label>
        <div className="flex gap-2">
          <NumberInput
            className="flex-1"
            placeholder="Amount"
            min={0}
            value={(data.quantityValue as string) ?? ""}
            onChange={(e) => onUpdate({ quantityValue: e.currentTarget.value })}
          />
          <Input
            className="w-28"
            placeholder="Unit"
            value={(data.quantityUnit as string) ?? ""}
            onChange={(e) => onUpdate({ quantityUnit: e.target.value })}
          />
        </div>
      </div>

      {/* Occurrence date */}
      <div className="space-y-1.5">
        <Label>Occurrence Date</Label>
        <Input
          type="date"
          value={(data.occurrenceDate as string) ?? ""}
          onChange={(e) => onUpdate({ occurrenceDate: e.target.value })}
        />
      </div>

      {/* Performer type (specialty) */}
      <div className="space-y-1.5">
        <Label>Performer Specialty</Label>
        <Select
          value={(data.performerType as string) ?? ""}
          onValueChange={(v) => onUpdate({ performerType: v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select specialty" />
          </SelectTrigger>
          <SelectContent>
            {PERFORMER_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
