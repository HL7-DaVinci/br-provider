import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Mail,
  MapPin,
  Phone,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type OrderPaStatus,
  useOrderPaStatusMap,
  usePatient,
} from "@/hooks/use-clinical-api";
import {
  calculateAge,
  formatClinicalDate,
  formatPatientName,
  getPrimaryIdentifier,
} from "@/lib/clinical-formatters";

export const Route = createFileRoute("/patients/$patientId/")({
  component: PatientSummary,
});

function PatientSummary() {
  const { patientId } = useParams({ from: "/patients/$patientId/" });
  const { data: patient, isLoading } = usePatient(patientId);
  const paStatusMap = useOrderPaStatusMap(patientId);

  if (isLoading || !patient) {
    return (
      <div className="p-6 max-w-7xl space-y-4">
        <div className="skeleton h-4 w-32" />
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders never reorder
            <div key={i} className="skeleton h-20 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  const address = patient.address?.[0];
  const phone = patient.telecom?.find((t) => t.system === "phone");
  const email = patient.telecom?.find((t) => t.system === "email");

  const addressStr = address
    ? [
        address.line?.join(", "),
        address.city,
        address.state,
        address.postalCode,
      ]
        .filter(Boolean)
        .join(", ")
    : undefined;

  const paStatuses = Array.from(paStatusMap.values());
  const pendingStatuses = paStatuses.filter((s) => s.pended);
  const resolvedStatuses = paStatuses.filter((s) => !s.pended);

  return (
    <div className="p-6 max-w-7xl space-y-6">
      {/* Demographics */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Demographics</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <Field label="Full Name" value={formatPatientName(patient.name)} />
            <Field
              label="Date of Birth"
              value={formatClinicalDate(patient.birthDate)}
            />
            <Field label="Age" value={calculateAge(patient.birthDate)} />
            <Field
              label="Gender"
              value={
                patient.gender
                  ? patient.gender.charAt(0).toUpperCase() +
                    patient.gender.slice(1)
                  : undefined
              }
            />
            <Field
              label="MRN"
              value={getPrimaryIdentifier(patient.identifier)}
            />
            <Field
              label="Language"
              value={
                patient.communication?.[0]?.language?.coding?.[0]?.display ??
                patient.communication?.[0]?.language?.text
              }
            />
          </dl>
        </CardContent>
      </Card>

      {/* Contact */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Contact</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {addressStr && (
            <div className="flex items-start gap-2 text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{addressStr}</span>
            </div>
          )}
          {phone?.value && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-3.5 w-3.5 shrink-0" />
              <span>{phone.value}</span>
            </div>
          )}
          {email?.value && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span>{email.value}</span>
            </div>
          )}
          {!addressStr && !phone?.value && !email?.value && (
            <p className="text-muted-foreground">
              No contact information available.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Prior Authorization Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Prior Authorization Status</CardTitle>
        </CardHeader>
        <CardContent>
          {paStatuses.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No prior authorization requests for this patient.
            </p>
          ) : (
            <div className="space-y-4">
              {pendingStatuses.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Pending
                  </h4>
                  {pendingStatuses.map((status) => (
                    <PaStatusRow
                      key={`${status.orderType}/${status.orderId}`}
                      status={status}
                      patientId={patientId}
                    />
                  ))}
                </div>
              )}
              {resolvedStatuses.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Resolved
                  </h4>
                  {resolvedStatuses.map((status) => (
                    <PaStatusRow
                      key={`${status.orderType}/${status.orderId}`}
                      status={status}
                      patientId={patientId}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-right">{value}</dd>
    </div>
  );
}

const OUTCOME_CONFIG: Record<
  string,
  {
    icon: typeof CheckCircle2;
    variant: "default" | "secondary" | "destructive";
    label: string;
  }
> = {
  complete: { icon: CheckCircle2, variant: "default", label: "Approved" },
  error: { icon: AlertCircle, variant: "destructive", label: "Denied" },
  queued: { icon: Clock, variant: "secondary", label: "Pending" },
  partial: { icon: Clock, variant: "secondary", label: "Partial" },
};

function PaStatusRow({
  status,
  patientId,
}: {
  status: OrderPaStatus;
  patientId: string;
}) {
  const config = status.pended
    ? OUTCOME_CONFIG.queued
    : (OUTCOME_CONFIG[status.outcome] ?? OUTCOME_CONFIG.queued);
  const Icon = config.icon;
  const created = formatClinicalDate(status.created);

  return (
    <div className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Badge variant={config.variant} className="text-xs">
            {config.label}
          </Badge>
          {status.preAuthRef && (
            <span className="text-xs text-muted-foreground font-mono truncate">
              PA# {status.preAuthRef}
            </span>
          )}
        </div>
        {created && (
          <div className="text-xs text-muted-foreground mt-0.5">{created}</div>
        )}
      </div>
      <Link
        to="/patients/$patientId/orders/$orderId/pas"
        params={{ patientId, orderId: status.orderId }}
        search={{
          orderType: status.orderType,
          coverageId: status.coverageId,
          claimResponseId: status.claimResponseId,
        }}
        className="text-muted-foreground hover:text-foreground"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
