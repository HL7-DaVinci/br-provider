import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CodeSearch } from "./code-search";

interface DeviceParameter {
  code: string;
  value: string;
}

/** HCPCS device codes value set */
const DEVICE_VS = "http://hl7.org/fhir/ValueSet/device-type";

interface DeviceRequestFieldsProps {
  data: Record<string, unknown>;
  onUpdate: (fields: Record<string, unknown>) => void;
}

export function DeviceRequestFields({
  data,
  onUpdate,
}: DeviceRequestFieldsProps) {
  const parameters = (data.parameters as DeviceParameter[]) ?? [];

  const addParameter = () => {
    onUpdate({ parameters: [...parameters, { code: "", value: "" }] });
  };

  const updateParameter = (
    index: number,
    field: keyof DeviceParameter,
    value: string,
  ) => {
    const updated = parameters.map((p, i) =>
      i === index ? { ...p, [field]: value } : p,
    );
    onUpdate({ parameters: updated });
  };

  const removeParameter = (index: number) => {
    onUpdate({ parameters: parameters.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      {/* Device code */}
      <CodeSearch
        label="Device Code"
        valueSetUrl={DEVICE_VS}
        value={
          data.deviceCode as { code?: string; display?: string } | undefined
        }
        onChange={(v) => onUpdate({ deviceCode: v })}
        placeholder="Search HCPCS device codes..."
      />

      {/* Parameters */}
      <fieldset className="space-y-3 rounded border p-3">
        <legend className="text-sm font-medium px-1">Parameters</legend>

        {parameters.map((param, i) => (
          <div
            key={`param-${param.code || i}`}
            className="flex items-end gap-2"
          >
            <div className="flex-1 space-y-1">
              <Label>Code</Label>
              <Input
                placeholder="Parameter name"
                value={param.code}
                onChange={(e) => updateParameter(i, "code", e.target.value)}
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label>Value</Label>
              <Input
                placeholder="Parameter value"
                value={param.value}
                onChange={(e) => updateParameter(i, "value", e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => removeParameter(i)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addParameter}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Parameter
        </Button>
      </fieldset>

      {/* Occurrence date */}
      <div className="space-y-1.5">
        <Label>Occurrence Date</Label>
        <Input
          type="date"
          value={(data.occurrenceDate as string) ?? ""}
          onChange={(e) => onUpdate({ occurrenceDate: e.target.value })}
        />
      </div>
    </div>
  );
}
