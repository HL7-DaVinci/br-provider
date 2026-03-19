import React from "react";

interface CoverageInfoProps {
  coverage: any;
  coverageLoading: boolean;
  orgLoading: boolean;
  orgData: any;
  orgId: string;
}
const CoverageInfo = ({
  coverage,
  coverageLoading,
  orgLoading,
  orgData,
  orgId,
}: CoverageInfoProps) => {
  const memberId = coverage?.subscriberId || coverage?.identifier?.[0]?.value || "N/A";
  const coverageId = coverage?.id || "N/A";
  const coveragePeriod = coverage?.period
    ? `${coverage.period.start ? new Date(coverage.period.start).toLocaleDateString() : ""} - ${coverage.period.end ? new Date(coverage.period.end).toLocaleDateString() : ""}`
    : "N/A";
  const status = coverage?.status || "N/A";

  const planClass = coverage?.class?.find(
    (c: any) => c.type?.coding?.some((cd: any) => cd.code === "plan")
  );
  const groupClass = coverage?.class?.find(
    (c: any) => c.type?.coding?.some((cd: any) => cd.code === "group")
  );
  const planName = planClass?.name || planClass?.value || "N/A";
  const groupName = groupClass?.name || groupClass?.value || undefined;

  const badgeColor =
    status === "active"
      ? "bg-green-100 text-green-800"
      : status === "inactive"
      ? "bg-red-100 text-red-800"
      : status === "draft"
      ? "bg-yellow-100 text-yellow-800"
      : "bg-gray-100 text-gray-800";

  if (coverageLoading) {
    return <span>Loading coverage...</span>;
  }

  if (!coverage) {
    return <span>Coverage: None</span>;
  }

  const Label = ({ children }: { children: React.ReactNode }) => (
    <span className="text-muted-foreground uppercase tracking-wide text-xs">{children}</span>
  );

  return (
    <span className="flex flex-wrap gap-x-1 items-center text-sm">
      <Label>Coverage:</Label>
      <span className="mx-1 text-border">|</span>
      <Label>Id:</Label>
      <span>{coverageId}</span>
      <span className="mx-1 text-border">|</span>
      <Label>Type:</Label>
      <span>{coverage.type?.text || coverage.type?.coding?.[0]?.code || "N/A"}</span>
      {groupName && <><span className="mx-1 text-border">|</span><Label>Group:</Label><span>{groupName}</span></>}
      <span className="mx-1 text-border">|</span>
      <Label>Plan:</Label>
      <span>{planName}</span>
      <span className="mx-1 text-border">|</span>
      <Label>Payor:</Label>
      <span>{orgLoading ? "Loading..." : orgData?.name || orgId || "N/A"}</span>
      <span className="mx-1 text-border">|</span>
      <Label>Member ID:</Label>
      <span>{memberId}</span>
      <span className="mx-1 text-border">|</span>
      <Label>Period:</Label>
      <span>{coveragePeriod}</span>
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
