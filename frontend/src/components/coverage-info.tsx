import type { Coverage, Organization } from "fhir/r4";
import type React from "react";

interface CoverageInfoProps {
  coverage: Coverage | undefined;
  coverageLoading: boolean;
  orgLoading: boolean;
  orgData: Organization | undefined;
  orgId: string | undefined;
}
const CoverageInfo = ({
  coverage,
  coverageLoading,
  orgLoading,
  orgData,
  orgId,
}: CoverageInfoProps) => {
  const memberId =
    coverage?.subscriberId || coverage?.identifier?.[0]?.value || "N/A";
  const coverageId = coverage?.id || "N/A";
  const coveragePeriod = coverage?.period
    ? `${coverage.period.start ? new Date(coverage.period.start).toLocaleDateString() : ""} - ${coverage.period.end ? new Date(coverage.period.end).toLocaleDateString() : ""}`
    : "N/A";
  const status = coverage?.status || "N/A";

  const planClass = coverage?.class?.find((c) =>
    c.type?.coding?.some((cd) => cd.code === "plan"),
  );
  const groupClass = coverage?.class?.find((c) =>
    c.type?.coding?.some((cd) => cd.code === "group"),
  );
  const planName = planClass?.name || planClass?.value || "N/A";
  const groupName = groupClass?.name || groupClass?.value || undefined;

  const badgeColors: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
    draft: "bg-yellow-100 text-yellow-800",
    "entered-in-error": "bg-gray-100 text-gray-800",
    "N/A": "bg-gray-100 text-gray-800",
  };

  const badgeColor = badgeColors[status] ?? "bg-gray-100 text-gray-800";

  if (coverageLoading) {
    return <span>Loading coverage...</span>;
  }

  if (!coverage) {
    return <span>Coverage: None</span>;
  }

  const Label = ({ children }: { children: React.ReactNode }) => (
    <span className="text-muted-foreground uppercase tracking-wide text-xs">
      {children}
    </span>
  );

  const Value = ({ children }: { children: React.ReactNode }) => {
    const isPlaceholder = children === "N/A";
    return (
      <span
        className={isPlaceholder ? "text-muted-foreground" : "text-foreground"}
      >
        {children}
      </span>
    );
  };

  const typeValue =
    coverage.type?.text || coverage.type?.coding?.[0]?.code || "N/A";
  const payorValue = orgLoading
    ? "Loading..."
    : orgData?.name || orgId || "N/A";

  return (
    <span className="flex flex-wrap gap-x-1 items-center text-sm">
      <Label>Coverage:</Label>
      <span className="mx-1 text-border">|</span>
      <Label>Id:</Label>
      <Value>{coverageId}</Value>
      <span className="mx-1 text-border">|</span>
      <Label>Type:</Label>
      <Value>{typeValue}</Value>
      {groupName && (
        <>
          <span className="mx-1 text-border">|</span>
          <Label>Group:</Label>
          <Value>{groupName}</Value>
        </>
      )}
      <span className="mx-1 text-border">|</span>
      <Label>Plan:</Label>
      <Value>{planName}</Value>
      <span className="mx-1 text-border">|</span>
      <Label>Payor:</Label>
      <Value>{payorValue}</Value>
      <span className="mx-1 text-border">|</span>
      <Label>Member ID:</Label>
      <Value>{memberId}</Value>
      <span className="mx-1 text-border">|</span>
      <Label>Period:</Label>
      <Value>{coveragePeriod}</Value>
      <span className="mx-1 text-border">|</span>
      <Label>Status:</Label>
      <span
        className={`ml-1 px-2 py-1 rounded-full font-semibold shadow-sm text-xs ${badgeColor}`}
        style={{ verticalAlign: "middle" }}
      >
        {status}
      </span>
    </span>
  );
};
export { CoverageInfo };
