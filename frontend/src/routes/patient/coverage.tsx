import { createFileRoute, Link } from "@tanstack/react-router";
import type { Coverage } from "fhir/r4";
import { ChevronLeft, Loader2, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useCoverage, useOrganization } from "@/hooks/use-clinical-api";
import { formatClinicalDate } from "@/lib/clinical-formatters";

export const Route = createFileRoute("/patient/coverage")({
  component: CoveragePage,
});

const statusBadgeClass: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
  draft: "bg-yellow-100 text-yellow-800",
  "entered-in-error": "bg-gray-100 text-gray-800",
};

function CoveragePage() {
  const { fhirUser } = useAuth();
  const patientId = fhirUser?.replace(/^Patient\//, "") ?? "";

  const { data, isLoading, isError, error } = useCoverage(patientId);

  const coverages: Coverage[] =
    data?.entry
      ?.map((e) => e.resource)
      .filter((r): r is Coverage => r?.resourceType === "Coverage") ?? [];

  return (
    <div className="p-6 md:p-10 max-w-6xl space-y-6">
      <div className="flex items-center gap-2">
        <Link
          to="/patient"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Back to dashboard"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-semibold">My Coverage</h1>
      </div>

      {isError && (
        <p className="text-sm text-red-600">
          Failed to load coverage: {error?.message}
        </p>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && coverages.length === 0 && !isError && (
        <p className="text-sm text-muted-foreground">
          No coverage records on file.
        </p>
      )}

      <div className="space-y-4">
        {coverages.map((c) => (
          <CoverageCard key={c.id} coverage={c} />
        ))}
      </div>
    </div>
  );
}

function CoverageCard({ coverage }: { coverage: Coverage }) {
  const orgRef = coverage.payor?.[0]?.reference;
  const orgId = orgRef?.split("/")[1];
  const { data: orgData, isLoading: orgLoading } = useOrganization(orgId);

  const planClass = coverage.class?.find((c) =>
    c.type?.coding?.some((cd) => cd.code === "plan"),
  );
  const groupClass = coverage.class?.find((c) =>
    c.type?.coding?.some((cd) => cd.code === "group"),
  );

  const planName = planClass?.name || planClass?.value;
  const groupName = groupClass?.name || groupClass?.value;

  const memberId =
    coverage.subscriberId || coverage.identifier?.[0]?.value || "--";

  const typeLabel =
    coverage.type?.text || coverage.type?.coding?.[0]?.display || "--";

  const relationship =
    coverage.relationship?.coding?.[0]?.display ||
    coverage.relationship?.coding?.[0]?.code ||
    "--";

  const periodStart = formatClinicalDate(coverage.period?.start);
  const periodEnd = formatClinicalDate(coverage.period?.end);
  const period =
    periodStart && periodEnd
      ? `${periodStart} – ${periodEnd}`
      : periodStart
        ? `${periodStart} – Present`
        : "--";

  const status = coverage.status ?? "unknown";
  const badgeColor = statusBadgeClass[status] ?? "bg-gray-100 text-gray-800";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-green-600" />
            {planName || orgData?.name || "Coverage"}
          </CardTitle>
          <Badge
            variant="outline"
            className={`capitalize ${badgeColor} border-transparent`}
          >
            {status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Field label="Payor">
            {orgLoading ? "Loading..." : orgData?.name || orgId || "--"}
          </Field>
          <Field label="Type">{typeLabel}</Field>
          <Field label="Member ID">
            <span className="tabular">{memberId}</span>
          </Field>
          <Field label="Relationship">
            <span className="capitalize">{relationship}</span>
          </Field>
          <Field label="Plan">{planName || "--"}</Field>
          {groupName && <Field label="Group">{groupName}</Field>}
          <Field label="Period">{period}</Field>
          <Field label="Coverage ID">
            <span className="tabular text-xs">{coverage.id}</span>
          </Field>
        </dl>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-foreground">{children}</dd>
    </div>
  );
}
