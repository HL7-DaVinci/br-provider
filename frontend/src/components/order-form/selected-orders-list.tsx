import { ChevronDown, ChevronRight, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useDeleteDraftOrder } from "@/hooks/use-clinical-api";
import { useOrderContext } from "@/hooks/use-order-context";
import type { SelectedOrder } from "@/lib/order-templates";
import { OrderCustomizationFields } from "./order-customization-fields";

export function SelectedOrdersList() {
  const { state, dispatch } = useOrderContext();
  const deleteDraft = useDeleteDraftOrder();
  const { selectedOrders } = state;

  const handleRemove = (order: SelectedOrder) => {
    dispatch({ type: "REMOVE_ORDER", payload: order.templateId });
    if (order.serverId) {
      deleteDraft.mutate({
        resourceType: order.template.resourceType,
        id: order.serverId,
      });
    }
  };

  if (selectedOrders.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
        No orders selected. Add orders from the catalog above.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        Selected Orders ({selectedOrders.length})
      </h3>

      {selectedOrders.map((order) => (
        <SelectedOrderItem
          key={order.templateId}
          order={order}
          onRemove={() => handleRemove(order)}
          onToggle={() =>
            dispatch({
              type: "TOGGLE_ORDER_EXPANDED",
              payload: order.templateId,
            })
          }
        />
      ))}
    </div>
  );
}

function SelectedOrderItem({
  order,
  onRemove,
  onToggle,
}: {
  order: SelectedOrder;
  onRemove: () => void;
  onToggle: () => void;
}) {
  return (
    <Collapsible open={order.expanded} onOpenChange={onToggle}>
      <div className="rounded-md border">
        <div className="flex items-center gap-2 px-3 py-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
              {order.expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </Button>
          </CollapsibleTrigger>
          <Badge variant="outline" className="shrink-0 font-mono text-xs">
            {order.template.code}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {order.template.display}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <CollapsibleContent>
          <div className="border-t px-3 py-3">
            <OrderCustomizationFields order={order} />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
