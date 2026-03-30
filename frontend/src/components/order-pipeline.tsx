import type { Resource } from "fhir/r4";
import { AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { OrderPaStatus } from "@/hooks/use-clinical-api";
import { usePipelineStatus } from "@/hooks/use-pipeline-status";
import type { OrderEntry } from "@/lib/order-types";
import type {
  AuthStage,
  CoverageStage,
  DocStage,
  PipelineStatus,
} from "@/lib/pipeline-status";

interface StageConfig {
  label: string;
  className: string;
}

const COVERAGE_CONFIG: Record<CoverageStage, StageConfig> = {
  covered: {
    label: "Covered",
    className: "bg-green-600 text-white border-transparent",
  },
  "not-covered": {
    label: "Not Covered",
    className: "bg-red-600 text-white border-transparent",
  },
  conditional: {
    label: "Conditional",
    className: "bg-amber-500 text-white border-transparent",
  },
  unknown: { label: "Unknown", className: "" },
};

const DOC_CONFIG: Record<DocStage, StageConfig> = {
  "not-needed": { label: "N/A", className: "" },
  needed: {
    label: "Needed",
    className: "bg-amber-500 text-white border-transparent",
  },
  "in-progress": {
    label: "In Progress",
    className: "bg-blue-500 text-white border-transparent",
  },
  completed: {
    label: "Completed",
    className: "bg-green-600 text-white border-transparent",
  },
};

const AUTH_CONFIG: Record<AuthStage, StageConfig & { icon?: boolean }> = {
  "not-needed": { label: "N/A", className: "" },
  "not-started": { label: "Not Started", className: "" },
  pended: {
    label: "Pended",
    className: "bg-amber-500 text-white border-transparent",
  },
  "pended-docs-needed": {
    label: "Docs Needed",
    className: "bg-amber-500 text-white border-transparent",
    icon: true,
  },
  approved: {
    label: "Approved",
    className: "bg-green-600 text-white border-transparent",
  },
  denied: {
    label: "Denied",
    className: "bg-red-600 text-white border-transparent",
  },
};

/** Renders a single stage as a badge. Use in table columns. */
export function CoverageStageBadge({
  stage,
}: {
  stage: PipelineStatus["coverage"];
}) {
  const config = COVERAGE_CONFIG[stage];
  return <StageBadge config={config} />;
}

export function DocStageBadge({
  stage,
}: {
  stage: PipelineStatus["documentation"];
}) {
  const config = DOC_CONFIG[stage];
  return <StageBadge config={config} />;
}

export function AuthStageBadge({
  stage,
}: {
  stage: PipelineStatus["authorization"];
}) {
  const config = AUTH_CONFIG[stage];
  return <StageBadge config={config} icon={config.icon} />;
}

function StageBadge({ config, icon }: { config: StageConfig; icon?: boolean }) {
  return (
    <Badge
      variant="outline"
      className={`text-[11px] px-1.5 py-0 ${config.className}`}
    >
      {icon && <AlertCircle className="h-2.5 w-2.5" />}
      {config.label}
    </Badge>
  );
}

/** Shared per-row cell that resolves pipeline status and renders a single stage badge. */
export function PipelineStageCell({
  order,
  patientId,
  paStatusMap,
  stage,
}: {
  order: OrderEntry;
  patientId: string;
  paStatusMap: Map<string, OrderPaStatus>;
  stage: "coverage" | "documentation" | "authorization";
}) {
  const orderId = (order.resource as Resource).id;
  const paStatus = orderId
    ? paStatusMap.get(`${order.resourceType}/${orderId}`)
    : undefined;
  const status = usePipelineStatus(order, patientId, paStatus);
  if (stage === "coverage")
    return <CoverageStageBadge stage={status.coverage} />;
  if (stage === "documentation")
    return <DocStageBadge stage={status.documentation} />;
  return <AuthStageBadge stage={status.authorization} />;
}
