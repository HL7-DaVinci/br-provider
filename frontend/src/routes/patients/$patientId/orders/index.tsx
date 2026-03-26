import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { ClinicalTable } from "@/components/clinical-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OrderEntry } from "@/hooks/use-clinical-api";
import { useOrders } from "@/hooks/use-clinical-api";
import {
  formatClinicalDate,
  formatCodeableConcept,
  formatOrderType,
  getOrderCode,
  getOrderDate,
} from "@/lib/clinical-formatters";

export const Route = createFileRoute("/patients/$patientId/orders/")({
  component: OrdersList,
});

function OrdersList() {
  const { patientId } = Route.useParams();
  const { data: orders, isLoading, isError, error } = useOrders(patientId);

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
    <div className="p-6 max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">
          Orders
          {!isLoading && orders && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              (<span className="tabular">{orders.length}</span>)
            </span>
          )}
        </h2>
        <Link to="/patients/$patientId/orders/new" params={{ patientId }}>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1" />
            New Order
          </Button>
        </Link>
      </div>
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
        ]}
        data={orders ?? []}
        emptyMessage="No orders found for this patient."
      />
    </div>
  );
}
