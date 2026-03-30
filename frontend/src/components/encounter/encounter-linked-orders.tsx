import type { Resource } from "fhir/r4";
import { Loader2, Send } from "lucide-react";
import { useCallback, useState } from "react";
import { ClinicalTable } from "@/components/clinical-table";
import { DtrAction, PaAction } from "@/components/order-coverage-actions";
import { PipelineStageCell } from "@/components/order-pipeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type OrderPaStatus,
  useEncounterOrders,
} from "@/hooks/use-clinical-api";
import {
  formatClinicalDate,
  formatCodeableConcept,
} from "@/lib/clinical-formatters";
import type { OrderEntry } from "@/lib/order-types";
import { formatOrderType, getOrderCode, getOrderDate } from "@/lib/order-types";

interface EncounterLinkedOrdersProps {
  encounterId: string;
  patientId: string;
  paStatusMap: Map<string, OrderPaStatus>;
  onDispatch?: () => Promise<void>;
}

export function EncounterLinkedOrders({
  encounterId,
  patientId,
  paStatusMap,
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
              header: "Code",
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
              header: "Coverage",
              className: "whitespace-nowrap",
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
              accessor: (o) => (
                <DtrAction
                  order={o}
                  patientId={patientId}
                  encounterId={encounterId}
                />
              ),
            },
            {
              header: "Prior Auth",
              className: "whitespace-nowrap",
              accessor: (o) => <PaAction order={o} patientId={patientId} />,
            },
          ]}
          data={orders ?? []}
        />
      </CardContent>
    </Card>
  );
}
