import { Checkbox } from "@/components/ui/checkbox";
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

const FREQUENCY_OPTIONS = [
  { value: "QD", label: "Daily (QD)" },
  { value: "BID", label: "Twice daily (BID)" },
  { value: "TID", label: "Three times daily (TID)" },
  { value: "QID", label: "Four times daily (QID)" },
  { value: "PRN", label: "As needed (PRN)" },
] as const;

const ROUTE_OPTIONS = [
  { value: "oral", label: "Oral" },
  { value: "IV", label: "Intravenous (IV)" },
  { value: "IM", label: "Intramuscular (IM)" },
  { value: "SC", label: "Subcutaneous (SC)" },
  { value: "topical", label: "Topical" },
] as const;

/** RxNorm value set for medication code search */
const RXNORM_VS =
  "http://hl7.org/fhir/us/core/ValueSet/us-core-medication-codes";

interface MedicationRequestFieldsProps {
  data: Record<string, unknown>;
  onUpdate: (fields: Record<string, unknown>) => void;
}

export function MedicationRequestFields({
  data,
  onUpdate,
}: MedicationRequestFieldsProps) {
  return (
    <div className="space-y-4">
      {/* Medication code */}
      <CodeSearch
        label="Medication"
        valueSetUrl={RXNORM_VS}
        value={
          data.medicationCode as { code?: string; display?: string } | undefined
        }
        onChange={(v) => onUpdate({ medicationCode: v })}
        placeholder="Search medications (RxNorm)..."
      />

      {/* Dosage instruction (sig) */}
      <div className="space-y-1.5">
        <Label>Sig / Dosage Instruction</Label>
        <Input
          placeholder="e.g. Take 1 tablet by mouth daily"
          value={(data.sig as string) ?? ""}
          onChange={(e) => onUpdate({ sig: e.target.value })}
        />
      </div>

      {/* Frequency */}
      <div className="space-y-1.5">
        <Label>Frequency</Label>
        <Select
          value={(data.frequency as string) ?? ""}
          onValueChange={(v) => onUpdate({ frequency: v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select frequency" />
          </SelectTrigger>
          <SelectContent>
            {FREQUENCY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Route */}
      <div className="space-y-1.5">
        <Label>Route</Label>
        <Select
          value={(data.route as string) ?? ""}
          onValueChange={(v) => onUpdate({ route: v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select route" />
          </SelectTrigger>
          <SelectContent>
            {ROUTE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Dose quantity */}
      <div className="space-y-1.5">
        <Label>Dose</Label>
        <div className="flex gap-2">
          <NumberInput
            className="flex-1"
            placeholder="Amount"
            min={0}
            step={0.5}
            value={(data.doseValue as string) ?? ""}
            onChange={(e) => onUpdate({ doseValue: e.currentTarget.value })}
          />
          <Input
            className="w-24"
            placeholder="Unit"
            value={(data.doseUnit as string) ?? ""}
            onChange={(e) => onUpdate({ doseUnit: e.target.value })}
          />
        </div>
      </div>

      {/* Dispense request */}
      <fieldset className="space-y-3 rounded border p-3">
        <legend className="text-sm font-medium px-1">Dispense Request</legend>

        <div className="space-y-1.5">
          <Label>Quantity</Label>
          <NumberInput
            placeholder="Dispense quantity"
            min={0}
            value={(data.dispenseQuantity as string) ?? ""}
            onChange={(e) =>
              onUpdate({ dispenseQuantity: e.currentTarget.value })
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label>Refills Allowed</Label>
          <NumberInput
            placeholder="Number of refills"
            min={0}
            step={1}
            value={(data.refills as string) ?? ""}
            onChange={(e) => onUpdate({ refills: e.currentTarget.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Expected Supply Duration (days)</Label>
          <NumberInput
            placeholder="Days"
            min={0}
            step={1}
            value={(data.supplyDuration as string) ?? ""}
            onChange={(e) =>
              onUpdate({ supplyDuration: e.currentTarget.value })
            }
          />
        </div>
      </fieldset>

      {/* Substitution */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="substitution"
          checked={(data.substitutionAllowed as boolean) ?? true}
          onCheckedChange={(checked) =>
            onUpdate({ substitutionAllowed: checked === true })
          }
        />
        <Label htmlFor="substitution">Substitution allowed</Label>
      </div>
    </div>
  );
}
