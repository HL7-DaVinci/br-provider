import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import type { OrderPaStatus } from "@/hooks/use-clinical-api";

const PA_STATUS_CONFIG = {
  complete: {
    label: "Approved",
    variant: "default" as const,
    className: "bg-green-600",
  },
  error: {
    label: "Denied",
    variant: "destructive" as const,
    className: "",
  },
  queued: {
    label: "Pended",
    variant: "secondary" as const,
    className: "bg-amber-500 text-white",
  },
  partial: {
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
  const config = PA_STATUS_CONFIG[
    status.outcome as keyof typeof PA_STATUS_CONFIG
  ] ?? { label: status.outcome, variant: "outline" as const, className: "" };

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
