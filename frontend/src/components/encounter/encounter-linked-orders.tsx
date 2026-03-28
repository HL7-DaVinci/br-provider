import type { Resource } from "fhir/r4";
import { Loader2, Send } from "lucide-react";
import { useCallback, useState } from "react";
import { ClinicalTable } from "@/components/clinical-table";
import { OrderCoverageActions } from "@/components/order-coverage-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEncounterOrders } from "@/hooks/use-clinical-api";
import {
  formatClinicalDate,
  formatCodeableConcept,
} from "@/lib/clinical-formatters";
import type { OrderEntry } from "@/lib/order-types";
import { formatOrderType, getOrderCode, getOrderDate } from "@/lib/order-types";

interface EncounterLinkedOrdersProps {
  encounterId: string;
  patientId: string;
  onDispatch?: () => Promise<void>;
}

export function EncounterLinkedOrders({
  encounterId,
  patientId,
  onDispatch,
}: EncounterLinkedOrdersProps) {
  const { data: orders, isLoading } = useEncounterOrders(
    encounterId,
    patientId,
  );

  const [isDispatching, setIsDispatching] = useState(false);

  const handleDispatch = useCallback(async () => {
    if (!onDispatch) return;
    setIsDispatching(true);
    try {
      await onDispatch();
    } finally {
      setIsDispatching(false);
    }
  }, [onDispatch]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Linked Orders</CardTitle>
          {onDispatch && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={isDispatching || !orders?.length}
              onClick={handleDispatch}
            >
              {isDispatching ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Send className="h-3 w-3 mr-1" />
              )}
              {isDispatching ? "Dispatching..." : "Dispatch Orders"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <ClinicalTable<OrderEntry>
          loading={isLoading}
          keyExtractor={(o) => (o.resource as Resource).id ?? ""}
          emptyMessage="No orders linked to this encounter."
          columns={[
            {
              header: "Type",
              accessor: (o) => (
                <Badge variant="outline" className="text-xs">
                  {formatOrderType(o.resourceType)}
                </Badge>
              ),
            },
            {
              header: "ID",
              accessor: (o) => o.resource.id ?? "",
              className: "text-muted-foreground",
            },
            {
              header: "Description",
              accessor: (o) => formatCodeableConcept(getOrderCode(o.resource)),
            },
            {
              header: "Status",
              accessor: (o) => o.resource.status ?? "",
              className: "text-muted-foreground",
            },
            {
              header: "Date",
              accessor: (o) => formatClinicalDate(getOrderDate(o.resource)),
              className: "text-muted-foreground",
            },
            {
              header: "",
              accessor: (o) => (
                <OrderCoverageActions
                  order={o}
                  patientId={patientId}
                  encounterId={encounterId}
                />
              ),
            },
          ]}
          data={orders ?? []}
        />
      </CardContent>
    </Card>
  );
}
