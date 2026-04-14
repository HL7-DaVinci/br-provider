import type { Appointment, Coverage, Practitioner } from "fhir/r4";
import { CalendarPlus, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { usePractitioners } from "@/hooks/use-appointment-api";
import { useCoverage } from "@/hooks/use-clinical-api";
import { formatPatientName } from "@/lib/clinical-formatters";

const SERVICE_TYPES = [
  {
    value: "cardiology",
    label: "Cardiology Consultation",
    system: "http://snomed.info/sct",
    code: "394579002",
    snomedDisplay: "Cardiology",
  },
  {
    value: "dme-evaluation",
    label: "DME Evaluation",
    system: "http://snomed.info/sct",
    code: "183524004",
    snomedDisplay: "Recommendation regarding equipment",
  },
  {
    value: "follow-up",
    label: "Follow-up Visit",
    system: "http://snomed.info/sct",
    code: "390906007",
    snomedDisplay: "Follow-up encounter",
  },
  {
    value: "general-checkup",
    label: "General Checkup",
    system: "http://snomed.info/sct",
    code: "185349003",
    snomedDisplay: "Encounter for check up",
  },
  {
    value: "specialist",
    label: "Specialist Consultation",
    system: "http://snomed.info/sct",
    code: "11429006",
    snomedDisplay: "Consultation",
  },
] as const;

interface FormValues {
  practitionerId: string;
  date: string;
  time: string;
  serviceType: string;
  reason: string;
  coverageRef: string;
}

function formatPractitionerName(p: Practitioner): string {
  return formatPatientName(p.name) || p.id || "Unknown";
}

function formatCoverageName(coverage: Coverage): string {
  const payor =
    coverage.payor?.[0]?.display ?? coverage.payor?.[0]?.reference ?? "Unknown";
  const subscriberId = coverage.subscriberId ?? "";
  return `${payor}${subscriberId ? ` - ${subscriberId}` : ""}`;
}

interface AppointmentBookingFormProps {
  patientId: string;
  patientDisplay: string;
  isSubmitting: boolean;
  onSubmit: (appointment: Appointment, coverageRef: string | undefined) => void;
}

export function AppointmentBookingForm({
  patientId,
  patientDisplay,
  isSubmitting,
  onSubmit,
}: AppointmentBookingFormProps) {
  const [form, setForm] = useState<FormValues>(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return {
      practitionerId: "",
      date: tomorrow.toISOString().split("T")[0],
      time: "09:00",
      serviceType: "",
      reason: "",
      coverageRef: "",
    };
  });

  const { data: practitionerBundle } = usePractitioners();
  const { data: coverageBundle } = useCoverage(patientId);

  const practitioners =
    practitionerBundle?.entry
      ?.map((e) => e.resource)
      .filter((r): r is Practitioner => r?.resourceType === "Practitioner") ??
    [];

  const coverages =
    coverageBundle?.entry
      ?.map((e) => e.resource)
      .filter((r): r is Coverage => r?.resourceType === "Coverage") ?? [];

  const update = (fields: Partial<FormValues>) =>
    setForm((prev) => ({ ...prev, ...fields }));

  const canSubmit =
    form.practitionerId && form.date && form.time && form.serviceType;

  function handleSubmit() {
    if (!canSubmit) return;

    const serviceTypeDef = SERVICE_TYPES.find(
      (s) => s.value === form.serviceType,
    );
    const practitioner = practitioners.find(
      (p) => p.id === form.practitionerId,
    );

    const startDate = new Date(`${form.date}T${form.time}`);
    const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);

    const appointment: Appointment = {
      resourceType: "Appointment",
      status: "proposed",
      serviceType: serviceTypeDef
        ? [
            {
              coding: [
                {
                  system: serviceTypeDef.system,
                  code: serviceTypeDef.code,
                  display: serviceTypeDef.snomedDisplay,
                },
              ],
              text: serviceTypeDef.label,
            },
          ]
        : undefined,
      reasonCode: form.reason ? [{ text: form.reason }] : undefined,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      minutesDuration: 30,
      participant: [
        {
          actor: {
            reference: `Patient/${patientId}`,
            display: patientDisplay,
          },
          required: "required",
          status: "accepted",
        },
        {
          actor: {
            reference: `Practitioner/${form.practitionerId}`,
            display: practitioner
              ? formatPractitionerName(practitioner)
              : undefined,
          },
          required: "required",
          status: "needs-action",
        },
      ],
    };

    onSubmit(appointment, form.coverageRef || undefined);
  }

  return (
    <div className="space-y-4">
      {/* Practitioner */}
      <div className="space-y-1.5">
        <Label>Practitioner</Label>
        <Select
          value={form.practitionerId}
          onValueChange={(v) => update({ practitionerId: v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a practitioner" />
          </SelectTrigger>
          <SelectContent>
            {practitioners.map((p) => (
              <SelectItem key={p.id} value={p.id ?? ""}>
                {formatPractitionerName(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Date & Time */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Date</Label>
          <Input
            type="date"
            value={form.date}
            onChange={(e) => update({ date: e.target.value })}
            min={new Date().toISOString().split("T")[0]}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Time</Label>
          <Input
            type="time"
            value={form.time}
            onChange={(e) => update({ time: e.target.value })}
          />
        </div>
      </div>

      {/* Service Type */}
      <div className="space-y-1.5">
        <Label>Service Type</Label>
        <Select
          value={form.serviceType}
          onValueChange={(v) => update({ serviceType: v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select service type" />
          </SelectTrigger>
          <SelectContent>
            {SERVICE_TYPES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Insurance / Coverage */}
      <div className="space-y-1.5">
        <Label>Insurance / Coverage</Label>
        <Select
          value={form.coverageRef}
          onValueChange={(v) => update({ coverageRef: v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select coverage (optional)" />
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

      {/* Reason */}
      <div className="space-y-1.5">
        <Label>Reason (optional)</Label>
        <Textarea
          placeholder="Reason for visit..."
          value={form.reason}
          onChange={(e) => update({ reason: e.target.value })}
          rows={2}
        />
      </div>

      {/* Submit */}
      <Button
        className="w-full"
        disabled={!canSubmit || isSubmitting}
        onClick={handleSubmit}
      >
        {isSubmitting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <CalendarPlus className="mr-2 h-4 w-4" />
        )}
        {isSubmitting ? "Checking Coverage..." : "Check Coverage & Book"}
      </Button>
    </div>
  );
}
