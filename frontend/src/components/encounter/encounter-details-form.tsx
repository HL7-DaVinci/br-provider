import type { Encounter } from "fhir/r4";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ENCOUNTER_STATUSES = [
  "planned",
  "arrived",
  "triaged",
  "in-progress",
  "onleave",
  "finished",
  "cancelled",
  "entered-in-error",
  "unknown",
] as const;

export const TERMINAL_STATUSES = new Set([
  "finished",
  "cancelled",
  "entered-in-error",
]);

export const ENCOUNTER_CLASSES = [
  { code: "AMB", display: "ambulatory" },
  { code: "EMER", display: "emergency" },
  { code: "IMP", display: "inpatient encounter" },
  { code: "HH", display: "home health" },
  { code: "VR", display: "virtual" },
] as const;

export const CLASS_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ActCode";

function toDatetimeLocal(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function fromDatetimeLocal(value: string): string {
  if (!value) return "";
  return new Date(value).toISOString();
}

export interface EncounterDetailsFormHandle {
  buildUpdatedEncounter: () => Encounter | null;
}

interface EncounterDetailsFormProps {
  encounter: Encounter;
  readOnly?: boolean;
}

export const EncounterDetailsForm = forwardRef<
  EncounterDetailsFormHandle,
  EncounterDetailsFormProps
>(function EncounterDetailsForm({ encounter, readOnly }, ref) {
  const [formState, setFormState] = useState({
    status: encounter.status,
    classCode: encounter.class?.code ?? "AMB",
    periodStart: toDatetimeLocal(encounter.period?.start),
    periodEnd: toDatetimeLocal(encounter.period?.end),
    reasonText: encounter.reasonCode?.[0]?.text ?? "",
  });

  useEffect(() => {
    setFormState({
      status: encounter.status,
      classCode: encounter.class?.code ?? "AMB",
      periodStart: toDatetimeLocal(encounter.period?.start),
      periodEnd: toDatetimeLocal(encounter.period?.end),
      reasonText: encounter.reasonCode?.[0]?.text ?? "",
    });
  }, [encounter]);

  const isDirty =
    formState.status !== encounter.status ||
    formState.classCode !== (encounter.class?.code ?? "AMB") ||
    formState.periodStart !== toDatetimeLocal(encounter.period?.start) ||
    formState.periodEnd !== toDatetimeLocal(encounter.period?.end) ||
    formState.reasonText !== (encounter.reasonCode?.[0]?.text ?? "");

  useImperativeHandle(ref, () => ({
    buildUpdatedEncounter: () => {
      if (!isDirty) return null;

      const classEntry = ENCOUNTER_CLASSES.find(
        (c) => c.code === formState.classCode,
      );

      const updated: Encounter = {
        ...encounter,
        status: formState.status as Encounter["status"],
        class: {
          system: CLASS_SYSTEM,
          code: formState.classCode,
          display: classEntry?.display ?? formState.classCode,
        },
        period: {
          start: formState.periodStart
            ? fromDatetimeLocal(formState.periodStart)
            : undefined,
          end: formState.periodEnd
            ? fromDatetimeLocal(formState.periodEnd)
            : undefined,
        },
      };

      if (formState.reasonText) {
        updated.reasonCode = [{ text: formState.reasonText }];
      } else if (encounter.reasonCode) {
        updated.reasonCode = undefined;
      }

      return updated;
    },
  }));

  function handleStatusChange(newStatus: Encounter["status"]) {
    const updates: Partial<typeof formState> = { status: newStatus };
    if (TERMINAL_STATUSES.has(newStatus) && !formState.periodEnd) {
      updates.periodEnd = toDatetimeLocal(new Date().toISOString());
    }
    setFormState((prev) => ({ ...prev, ...updates }));
  }

  const participants = encounter.participant ?? [];

  const classDisplay =
    ENCOUNTER_CLASSES.find((c) => c.code === formState.classCode)?.display ??
    formState.classCode;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Encounter Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {readOnly ? (
          <>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <ReadOnlyField label="Status" value={encounter.status} />
              <ReadOnlyField label="Class" value={classDisplay} />
              <ReadOnlyField
                label="Period Start"
                value={formState.periodStart?.replace("T", " ") || "N/A"}
              />
              <ReadOnlyField
                label="Period End"
                value={formState.periodEnd?.replace("T", " ") || "N/A"}
              />
            </dl>
            {formState.reasonText && (
              <ReadOnlyField label="Reason" value={formState.reasonText} />
            )}
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={formState.status}
                  onValueChange={handleStatusChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENCOUNTER_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Class</Label>
                <Select
                  value={formState.classCode}
                  onValueChange={(v) =>
                    setFormState((prev) => ({ ...prev, classCode: v }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENCOUNTER_CLASSES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.display}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Period Start</Label>
                <Input
                  type="datetime-local"
                  value={formState.periodStart}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      periodStart: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label>Period End</Label>
                <Input
                  type="datetime-local"
                  value={formState.periodEnd}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      periodEnd: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Input
                placeholder="Reason for encounter"
                value={formState.reasonText}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    reasonText: e.target.value,
                  }))
                }
              />
            </div>
          </>
        )}

        {participants.length > 0 && (
          <div className="space-y-1.5">
            <Label>Participants</Label>
            <div className="text-sm text-muted-foreground space-y-0.5">
              {participants.map((p, i) => (
                <div key={p.individual?.reference ?? i}>
                  {p.individual?.display ??
                    p.individual?.reference ??
                    "Unknown"}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

function ReadOnlyField({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-right">{value || "N/A"}</dd>
    </div>
  );
}
