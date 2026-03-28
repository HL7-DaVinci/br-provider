import { Check, Loader2, PenTool } from "lucide-react";
import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useOrderContext } from "@/hooks/use-order-context";
import type { SelectedOrder } from "@/lib/order-templates";

interface PhaseSignProps {
  onConfirmSign: () => Promise<string[]>;
}

export function PhaseSign({ onConfirmSign }: PhaseSignProps) {
  const { state, dispatch } = useOrderContext();
  const [isSigning, setIsSigning] = useState(false);

  const handleSign = useCallback(async () => {
    setIsSigning(true);
    dispatch({
      type: "ADD_TIMELINE_EVENT",
      payload: { message: "Signing orders...", type: "action" },
    });

    try {
      const orderIds = await onConfirmSign();
      if (orderIds.length === 0) {
        throw new Error("No signed orders were returned by the FHIR server.");
      }

      dispatch({ type: "SIGN_COMPLETE", payload: orderIds });

      dispatch({
        type: "ADD_TIMELINE_EVENT",
        payload: {
          message: `${orderIds.length} order(s) signed`,
          type: "action",
        },
      });
      dispatch({ type: "ADVANCE_PHASE", payload: "review" });
    } catch (err) {
      dispatch({
        type: "ADD_TIMELINE_EVENT",
        payload: {
          message: `Sign failed: ${err instanceof Error ? err.message : "unknown error"}`,
          type: "error",
        },
      });
    } finally {
      setIsSigning(false);
    }
  }, [onConfirmSign, dispatch]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <PenTool className="h-4 w-4 text-muted-foreground" />
            Review Orders ({state.selectedOrders.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {state.selectedOrders.map((order) => (
            <SignOrderRow key={order.templateId} order={order} />
          ))}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => dispatch({ type: "ADVANCE_PHASE", payload: "select" })}
          disabled={isSigning}
        >
          Back to Orders
        </Button>
        <Button
          className="flex-1"
          onClick={handleSign}
          disabled={isSigning || state.selectedOrders.length === 0}
        >
          {isSigning ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Check className="h-4 w-4 mr-1.5" />
          )}
          {isSigning ? "Signing..." : "Confirm & Sign"}
        </Button>
      </div>
    </div>
  );
}

function SignOrderRow({ order }: { order: SelectedOrder }) {
  const fields = order.customizations;
  const details: string[] = [];
  if (fields.occurrenceDate) details.push(`Date: ${fields.occurrenceDate}`);

  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      <Badge variant="outline" className="shrink-0 font-mono text-xs">
        {order.template.code}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{order.template.display}</p>
        {details.length > 0 && (
          <p className="text-xs text-muted-foreground">{details.join(" / ")}</p>
        )}
      </div>
      <Badge variant="secondary" className="text-xs shrink-0">
        {order.template.resourceType}
      </Badge>
    </div>
  );
}
