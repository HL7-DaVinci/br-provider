import { Send } from "lucide-react";
import { OrderTemplateCatalog } from "@/components/order-form/order-template-catalog";
import { SelectedOrdersList } from "@/components/order-form/selected-orders-list";
import { SharedOrderFields } from "@/components/order-form/shared-order-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useOrderContext } from "@/hooks/use-order-context";

export function PhaseSelectOrders() {
  const { state, dispatch } = useOrderContext();

  const handleAdvanceToSign = () => {
    dispatch({ type: "ADVANCE_PHASE", payload: "sign" });
    dispatch({
      type: "ADD_TIMELINE_EVENT",
      payload: { message: "Proceeding to sign orders", type: "action" },
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

      <Button
        className="w-full"
        onClick={handleAdvanceToSign}
        disabled={state.selectedOrders.length === 0}
      >
        <Send className="h-4 w-4 mr-1.5" />
        Sign All Orders ({state.selectedOrders.length})
      </Button>
    </div>
  );
}
