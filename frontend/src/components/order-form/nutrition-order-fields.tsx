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
import { Textarea } from "@/components/ui/textarea";

type NutritionSection = "oralDiet" | "supplement" | "enteralFormula";

const SECTION_OPTIONS: { value: NutritionSection; label: string }[] = [
  { value: "oralDiet", label: "Oral Diet" },
  { value: "supplement", label: "Supplement" },
  { value: "enteralFormula", label: "Enteral Formula" },
];

const ORAL_DIET_TYPES = [
  "Regular",
  "Clear Liquid",
  "Full Liquid",
  "Mechanical Soft",
  "Pureed",
  "Low Sodium",
  "Low Fat",
  "Diabetic",
  "Renal",
  "High Protein",
] as const;

const SUPPLEMENT_TYPES = [
  "Standard Oral Supplement",
  "High Calorie Supplement",
  "High Protein Supplement",
  "Fiber Supplement",
  "Electrolyte Supplement",
] as const;

const FORMULA_TYPES = [
  "Standard Enteral Formula",
  "High Protein Formula",
  "Fiber-Enriched Formula",
  "Diabetic Formula",
  "Renal Formula",
  "Peptide-Based Formula",
] as const;

const SCHEDULE_OPTIONS = [
  { value: "with-meals", label: "With meals" },
  { value: "between-meals", label: "Between meals" },
  { value: "continuous", label: "Continuous" },
  { value: "BID", label: "Twice daily" },
  { value: "TID", label: "Three times daily" },
] as const;

function ScheduleSelect({
  value,
  onChange,
  label = "Schedule",
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select schedule" />
        </SelectTrigger>
        <SelectContent>
          {SCHEDULE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface NutritionOrderFieldsProps {
  data: Record<string, unknown>;
  onUpdate: (fields: Record<string, unknown>) => void;
}

export function NutritionOrderFields({
  data,
  onUpdate,
}: NutritionOrderFieldsProps) {
  const section = (data.nutritionSection as NutritionSection) ?? "oralDiet";

  return (
    <div className="space-y-4">
      {/* Section selector */}
      <div className="space-y-1.5">
        <Label>Nutrition Type</Label>
        <Select
          value={section}
          onValueChange={(v) =>
            onUpdate({ nutritionSection: v as NutritionSection })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SECTION_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {section === "oralDiet" && (
        <>
          <div className="space-y-1.5">
            <Label>Diet Type</Label>
            <Select
              value={(data.oralDietType as string) ?? ""}
              onValueChange={(v) => onUpdate({ oralDietType: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select diet type" />
              </SelectTrigger>
              <SelectContent>
                {ORAL_DIET_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ScheduleSelect
            value={(data.schedule as string) ?? ""}
            onChange={(v) => onUpdate({ schedule: v })}
          />

          <div className="space-y-1.5">
            <Label>Instructions</Label>
            <Textarea
              placeholder="Additional dietary instructions..."
              value={(data.dietInstructions as string) ?? ""}
              onChange={(e) => onUpdate({ dietInstructions: e.target.value })}
              rows={2}
            />
          </div>
        </>
      )}

      {section === "supplement" && (
        <>
          <div className="space-y-1.5">
            <Label>Supplement Type</Label>
            <Select
              value={(data.supplementType as string) ?? ""}
              onValueChange={(v) => onUpdate({ supplementType: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select supplement" />
              </SelectTrigger>
              <SelectContent>
                {SUPPLEMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ScheduleSelect
            value={(data.schedule as string) ?? ""}
            onChange={(v) => onUpdate({ schedule: v })}
          />

          <div className="space-y-1.5">
            <Label>Quantity</Label>
            <div className="flex gap-2">
              <NumberInput
                className="flex-1"
                placeholder="Amount"
                min={0}
                value={(data.supplementQuantity as string) ?? ""}
                onChange={(e) =>
                  onUpdate({ supplementQuantity: e.currentTarget.value })
                }
              />
              <Input
                className="w-24"
                placeholder="Unit"
                value={(data.supplementUnit as string) ?? "mL"}
                onChange={(e) => onUpdate({ supplementUnit: e.target.value })}
              />
            </div>
          </div>
        </>
      )}

      {section === "enteralFormula" && (
        <>
          <div className="space-y-1.5">
            <Label>Formula Type</Label>
            <Select
              value={(data.formulaType as string) ?? ""}
              onValueChange={(v) => onUpdate({ formulaType: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select formula" />
              </SelectTrigger>
              <SelectContent>
                {FORMULA_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ScheduleSelect
            label="Administration Schedule"
            value={(data.schedule as string) ?? ""}
            onChange={(v) => onUpdate({ schedule: v })}
          />

          <div className="space-y-1.5">
            <Label>Rate (mL/hr)</Label>
            <NumberInput
              placeholder="Rate"
              min={0}
              value={(data.formulaRate as string) ?? ""}
              onChange={(e) => onUpdate({ formulaRate: e.currentTarget.value })}
            />
          </div>
        </>
      )}
    </div>
  );
}
