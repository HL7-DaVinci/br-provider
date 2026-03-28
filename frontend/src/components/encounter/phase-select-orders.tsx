import { CheckCircle, Loader2, Save, Send } from "lucide-react";
import { useCallback, useState } from "react";
import { OrderTemplateCatalog } from "@/components/order-form/order-template-catalog";
import { SelectedOrdersList } from "@/components/order-form/selected-orders-list";
import { SharedOrderFields } from "@/components/order-form/shared-order-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useSaveDraftOrders } from "@/hooks/use-clinical-api";
import { useOrderContext } from "@/hooks/use-order-context";
import {
  buildDraftSaveTransactionBundle,
  buildOrderIdMap,
} from "@/lib/draft-orders";

interface PhaseSelectOrdersProps {
  onSaveEncounter?: () => Promise<void>;
  onFinish: () => Promise<void>;
}

export function PhaseSelectOrders({
  onSaveEncounter,
  onFinish,
}: PhaseSelectOrdersProps) {
  const { state, dispatch } = useOrderContext();
  const saveDrafts = useSaveDraftOrders();
  const [isFinishing, setIsFinishing] = useState(false);

  const handleFinish = useCallback(async () => {
    setIsFinishing(true);
    try {
      await onFinish();
    } finally {
      setIsFinishing(false);
    }
  }, [onFinish]);

  const handleAdvanceToSign = () => {
    dispatch({ type: "ADVANCE_PHASE", payload: "sign" });
    dispatch({
      type: "ADD_TIMELINE_EVENT",
      payload: { message: "Proceeding to sign orders", type: "action" },
    });
  };

  const handleSaveDraft = async () => {
    await onSaveEncounter?.();

    const bundle = buildDraftSaveTransactionBundle(
      state.selectedOrders,
      state.patientId,
      state.sharedFields,
      {
        encounterId: state.encounter?.id,
        practitionerId: state.practitionerId,
        systemActionResources: state.systemActionResources,
      },
    );

    const serverIds = await saveDrafts.mutateAsync(bundle);

    const idMap = buildOrderIdMap(state.selectedOrders, serverIds);
    if (idMap.size > 0) {
      dispatch({ type: "SET_ORDER_SERVER_IDS", payload: idMap });
    }

    dispatch({
      type: "ADD_TIMELINE_EVENT",
      payload: {
        message: `${state.selectedOrders.length} draft order(s) saved`,
        type: "action",
      },
    });
  };

  return (
    <div className="space-y-4">
      <OrderTemplateCatalog />

      <Separator />

      <SelectedOrdersList />

      <Separator />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Common Fields</CardTitle>
        </CardHeader>
        <CardContent>
          <SharedOrderFields />
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={handleSaveDraft}
          disabled={state.selectedOrders.length === 0 || saveDrafts.isPending}
        >
          <Save className="h-4 w-4 mr-1.5" />
          {saveDrafts.isPending ? "Saving..." : "Save Draft"}
        </Button>

        <Button
          className="flex-1"
          onClick={handleAdvanceToSign}
          disabled={state.selectedOrders.length === 0}
        >
          <Send className="h-4 w-4 mr-1.5" />
          Sign All Orders ({state.selectedOrders.length})
        </Button>
      </div>

      {state.selectedOrders.length === 0 && (
        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">
            or complete without orders
          </span>
          <Separator className="flex-1" />
        </div>
      )}

      <Button
        variant="outline"
        className="w-full"
        onClick={handleFinish}
        disabled={isFinishing || state.selectedOrders.length > 0}
      >
        {isFinishing ? (
          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
        ) : (
          <CheckCircle className="h-4 w-4 mr-1.5" />
        )}
        {isFinishing ? "Finishing..." : "Complete Encounter"}
      </Button>
    </div>
  );
}
