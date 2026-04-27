import { createFileRoute } from "@tanstack/react-router";
import { ClinicalTable } from "@/components/clinical-table";
import { DtrAction, PaAction } from "@/components/order-coverage-actions";
import { PipelineStageCell } from "@/components/order-pipeline";
import { Badge } from "@/components/ui/badge";
import { useOrderPaStatusMap, useOrders } from "@/hooks/use-clinical-api";
import {
  formatClinicalDate,
  formatCodeableConcept,
} from "@/lib/clinical-formatters";
import type { OrderEntry } from "@/lib/order-types";
import { formatOrderType, getOrderCode, getOrderDate } from "@/lib/order-types";

export const Route = createFileRoute("/patients/$patientId/orders/")({
  component: OrdersList,
});

function OrdersList() {
  const { patientId } = Route.useParams();
  const { data: orders, isLoading, isError, error } = useOrders(patientId);
  const paStatusMap = useOrderPaStatusMap(patientId);

  if (isError) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load orders"}
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl space-y-4">
      <h2 className="text-base font-semibold">
        Orders
        {!isLoading && orders && (
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            (<span className="tabular">{orders.length}</span>)
          </span>
        )}
      </h2>
      <ClinicalTable<OrderEntry>
        loading={isLoading}
        skeletonRows={5}
        keyExtractor={(o) => `${o.resourceType}/${o.resource.id}`}
        columns={[
          {
            header: "Type",
            accessor: (o) => (
              <Badge variant="outline">{formatOrderType(o.resourceType)}</Badge>
            ),
          },
          {
            header: "Code",
            accessor: (o) => formatCodeableConcept(getOrderCode(o.resource)),
          },
          {
            header: "Status",
            accessor: (o) => {
              const status = (o.resource as { status?: string }).status;
              if (!status) return "";
              const isActive = status === "active" || status === "draft";
              return (
                <Badge variant={isActive ? "default" : "secondary"}>
                  {status}
                </Badge>
              );
            },
          },
          {
            header: "Date",
            accessor: (o) => formatClinicalDate(getOrderDate(o.resource)),
          },
          {
            header: "Coverage",
            className: "whitespace-nowrap",
            tooltip:
              "CRD stage — whether the payer's Coverage Requirements Discovery hook has returned coverage guidance for this order.",
            accessor: (o) => (
              <PipelineStageCell
                order={o}
                patientId={patientId}
                paStatusMap={paStatusMap}
                stage="coverage"
              />
            ),
          },
          {
            header: "Documentation",
            className: "whitespace-nowrap",
            tooltip:
              "DTR stage — whether the questionnaires required by the payer (if any) have been completed for this order.",
            accessor: (o) => (
              <PipelineStageCell
                order={o}
                patientId={patientId}
                paStatusMap={paStatusMap}
                stage="documentation"
              />
            ),
          },
          {
            header: "Authorization",
            className: "whitespace-nowrap",
            tooltip:
              "PAS stage — whether a prior authorization decision has been received from the payer for this order.",
            accessor: (o) => (
              <PipelineStageCell
                order={o}
                patientId={patientId}
                paStatusMap={paStatusMap}
                stage="authorization"
              />
            ),
          },
          {
            header: "DTR",
            className: "whitespace-nowrap",
            tooltip:
              "Launch the DTR workspace for this order to fill or view payer documentation.",
            accessor: (o) => <DtrAction order={o} patientId={patientId} />,
          },
          {
            header: "Prior Auth",
            className: "whitespace-nowrap",
            tooltip:
              "Submit or track a Prior Authorization Support (PAS) request for this order.",
            accessor: (o) => <PaAction order={o} patientId={patientId} />,
          },
        ]}
        data={orders ?? []}
        emptyMessage="No orders found for this patient."
      />
    </div>
  );
}
