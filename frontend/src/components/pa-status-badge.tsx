import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import type { OrderPaStatus } from "@/hooks/use-clinical-api";

const PA_STATUS_CONFIG = {
  approved: {
    label: "Approved",
    variant: "default" as const,
    className: "bg-green-600",
  },
  partial: {
    label: "Partially Approved",
    variant: "secondary" as const,
    className: "bg-amber-500 text-white",
  },
  denied: {
    label: "Denied",
    variant: "destructive" as const,
    className: "",
  },
  pended: {
    label: "Pended",
    variant: "secondary" as const,
    className: "bg-amber-500 text-white",
  },
} as const;

interface PaStatusBadgeProps {
  status: OrderPaStatus;
  patientId: string;
}

export function PaStatusBadge({ status, patientId }: PaStatusBadgeProps) {
  const config =
    status.decision === "unknown"
      ? {
          label: status.outcome,
          variant: "outline" as const,
          className: "",
        }
      : PA_STATUS_CONFIG[status.decision];

  return (
    <Link
      to="/patients/$patientId/orders/$orderId/pas"
      params={{ patientId, orderId: status.orderId }}
      search={{
        orderType: status.orderType,
        coverageId: status.coverageId,
        claimResponseId: status.claimResponseId,
      }}
      className="inline-flex items-center gap-1.5 no-underline"
    >
      <Badge variant={config.variant} className={config.className}>
        {config.label}
      </Badge>
      {status.preAuthRef && (
        <span className="font-mono text-xs text-muted-foreground">
          {status.preAuthRef}
        </span>
      )}
    </Link>
  );
}
