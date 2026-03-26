import type { Condition, Coverage } from "fhir/r4";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useConditions, useCoverage } from "@/hooks/use-clinical-api";
import { useOrderContext } from "@/hooks/use-order-context";

const INTENT_OPTIONS = [
  { value: "order", label: "Order" },
  { value: "plan", label: "Plan" },
  { value: "proposal", label: "Proposal" },
] as const;

const PRIORITY_OPTIONS = [
  { value: "routine", label: "Routine" },
  { value: "urgent", label: "Urgent" },
  { value: "asap", label: "ASAP" },
  { value: "stat", label: "Stat" },
] as const;

function formatCoverageName(coverage: Coverage): string {
  const payor =
    coverage.payor?.[0]?.display ?? coverage.payor?.[0]?.reference ?? "Unknown";
  const subscriberId = coverage.subscriberId ?? "";
  return `${payor}${subscriberId ? ` - ${subscriberId}` : ""}`;
}

function formatConditionDisplay(condition: Condition): string {
  const code = condition.code?.coding?.[0];
  const text = condition.code?.text ?? code?.display ?? "Unknown";
  return code?.code ? `${text} (${code.code})` : text;
}

/**
 * Fields common to all order types: coverage, reason, intent, priority, notes.
 */
export function SharedOrderFields() {
  const { state, dispatch } = useOrderContext();
  const { sharedFields, patientId } = state;

  const { data: coverageBundle } = useCoverage(patientId);
  const { data: conditionsBundle } = useConditions(patientId);

  const coverages =
    coverageBundle?.entry
      ?.map((e) => e.resource)
      .filter((r): r is Coverage => r?.resourceType === "Coverage") ?? [];

  const conditions =
    conditionsBundle?.entry
      ?.map((e) => e.resource)
      .filter((r): r is Condition => r?.resourceType === "Condition") ?? [];

  const update = (fields: Record<string, unknown>) =>
    dispatch({ type: "UPDATE_SHARED", payload: fields });

  return (
    <div className="space-y-4">
      {/* Insurance / Coverage */}
      <div className="space-y-1.5">
        <Label>Insurance / Coverage</Label>
        <Select
          value={(sharedFields.insuranceRef as string) ?? ""}
          onValueChange={(v) => update({ insuranceRef: v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select coverage" />
          </SelectTrigger>
          <SelectContent>
            {coverages.map((cov) => (
              <SelectItem key={cov.id} value={`Coverage/${cov.id}`}>
                {formatCoverageName(cov)}
              </SelectItem>
            ))}
            {coverages.length === 0 && (
              <SelectItem value="none" disabled>
                No coverages found
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Reason Code (condition) */}
      <div className="space-y-1.5">
        <Label>Reason (Condition)</Label>
        <Select
          value={(sharedFields.reasonRef as string) ?? ""}
          onValueChange={(v) => update({ reasonRef: v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select condition" />
          </SelectTrigger>
          <SelectContent>
            {conditions.map((cond) => (
              <SelectItem key={cond.id} value={`Condition/${cond.id}`}>
                {formatConditionDisplay(cond)}
              </SelectItem>
            ))}
            {conditions.length === 0 && (
              <SelectItem value="none" disabled>
                No conditions found
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Intent */}
      <div className="space-y-1.5">
        <Label>Intent</Label>
        <Select
          value={(sharedFields.intent as string) ?? "order"}
          onValueChange={(v) => update({ intent: v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INTENT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Priority */}
      <div className="space-y-1.5">
        <Label>Priority</Label>
        <Select
          value={(sharedFields.priority as string) ?? "routine"}
          onValueChange={(v) => update({ priority: v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Note */}
      <div className="space-y-1.5">
        <Label>Note</Label>
        <Textarea
          placeholder="Additional notes..."
          value={(sharedFields.note as string) ?? ""}
          onChange={(e) => update({ note: e.target.value })}
          rows={2}
        />
      </div>
    </div>
  );
}
