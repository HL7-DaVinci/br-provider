import { Badge } from "@/components/ui/badge";
import type { CoverageInformation } from "@/lib/cds-types";
import { cn } from "@/lib/utils";

interface CoverageDeterminationProps {
  coverageInfo: CoverageInformation[];
}

export function CoverageDetermination({
  coverageInfo,
}: CoverageDeterminationProps) {
  return (
    <div className="space-y-3">
      {coverageInfo.map((info, i) => (
        <CoverageInfoEntry key={info.coverageAssertionId ?? i} info={info} />
      ))}
    </div>
  );
}

function CoverageInfoEntry({ info }: { info: CoverageInformation }) {
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      {/* Status badges */}
      <div className="flex flex-wrap gap-1.5">
        {info.covered && <CoveredBadge value={info.covered} />}
        {info.paNeeded && <PaNeededBadge value={info.paNeeded} />}
        {info.docNeeded && <DocNeededBadge value={info.docNeeded} />}
      </div>

      {/* Info needed indicators */}
      {info.infoNeeded && info.infoNeeded.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
            Additional information needed for coverage determination:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {info.infoNeeded.map((code) => (
              <InfoNeededBadge key={code} value={code} />
            ))}
          </div>
        </div>
      )}

      {/* Billing code */}
      {info.billingCode && (
        <p className="text-muted-foreground">
          <span className="font-medium">Billing: </span>
          {info.billingCode.display ?? info.billingCode.code}
          <span className="text-xs ml-1">({info.billingCode.system})</span>
        </p>
      )}

      {/* Satisfied PA ID */}
      {info.satisfiedPaId && (
        <p className="text-muted-foreground">
          <span className="font-medium">PA#: </span>
          <code className="text-xs bg-muted px-1 py-0.5 rounded">
            {info.satisfiedPaId}
          </code>
        </p>
      )}

      {/* Coverage assertion ID */}
      {info.coverageAssertionId && (
        <p className="text-xs text-muted-foreground">
          Assertion:{" "}
          <code className="bg-muted px-1 py-0.5 rounded">
            {info.coverageAssertionId}
          </code>
        </p>
      )}

      {/* Detail messages */}
      {info.detail?.map((d) => (
        <p key={d} className="text-xs text-muted-foreground">
          {d}
        </p>
      ))}
    </div>
  );
}

function CoveredBadge({
  value,
}: {
  value: NonNullable<CoverageInformation["covered"]>;
}) {
  const config = {
    covered: {
      label: "Covered",
      className: "bg-green-600 text-white border-green-600",
    },
    "not-covered": {
      label: "Not Covered",
      className: "bg-red-600 text-white border-red-600",
    },
    conditional: {
      label: "Conditional",
      className: "bg-amber-500 text-white border-amber-500",
    },
  } as const;

  const { label, className } = config[value];
  return <Badge className={cn(className)}>{label}</Badge>;
}

function PaNeededBadge({
  value,
}: {
  value: NonNullable<CoverageInformation["paNeeded"]>;
}) {
  const config = {
    "no-auth": {
      label: "No Auth Required",
      className: "bg-green-600 text-white border-green-600",
    },
    "auth-needed": {
      label: "Auth Required",
      className: "bg-red-600 text-white border-red-600",
    },
    satisfied: {
      label: "PA Satisfied",
      className: "bg-blue-600 text-white border-blue-600",
    },
  } as const;

  const { label, className } = config[value];
  return <Badge className={cn(className)}>{label}</Badge>;
}

function DocNeededBadge({
  value,
}: {
  value: NonNullable<CoverageInformation["docNeeded"]>;
}) {
  const config = {
    "no-doc": {
      label: "No Documentation",
      className: "bg-green-600 text-white border-green-600",
    },
    clinical: {
      label: "Clinical Needed",
      className: "bg-amber-500 text-white border-amber-500",
    },
    admin: {
      label: "Admin Needed",
      className: "bg-amber-500 text-white border-amber-500",
    },
    both: {
      label: "Both Needed",
      className: "bg-red-600 text-white border-red-600",
    },
  } as const;

  const { label, className } = config[value];
  return <Badge className={cn(className)}>{label}</Badge>;
}

const INFO_NEEDED_LABELS: Record<string, string> = {
  performer: "Performer Required",
  location: "Location Required",
  "billing-code": "Billing Code Required",
  timeframe: "Timeframe Required",
  "detail-code": "Detail Code Required",
  "contract-window": "Contract Window Required",
  OTH: "Additional Info Required",
};

function InfoNeededBadge({ value }: { value: string }) {
  const label = INFO_NEEDED_LABELS[value] ?? value;
  return (
    <Badge className={cn("bg-amber-500 text-white border-amber-500")}>
      {label}
    </Badge>
  );
}
