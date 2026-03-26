import { Loader2, Send } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useCdsHooks } from "@/hooks/use-cds-hooks";
import { useSaveOrders } from "@/hooks/use-clinical-api";
import { useOrderContext } from "@/hooks/use-order-context";
import { usePayerServer } from "@/hooks/use-payer-server";
import type { OrderSelectContext, OrderSignContext } from "@/lib/cds-types";
import {
  buildDraftOrdersBundle,
  buildSignedOrdersTransactionBundle,
} from "@/lib/draft-orders";
import { EncounterHeader } from "./encounter-header";
import { OrderTemplateCatalog } from "./order-template-catalog";
import { SelectedOrdersList } from "./selected-orders-list";
import { SharedOrderFields } from "./shared-order-fields";

export function OrderForm() {
  const { state, dispatch } = useOrderContext();
  const { cdsUrl } = usePayerServer();
  const { fireHook, discovery, isLoading: isHookLoading } = useCdsHooks(cdsUrl);
  const saveOrders = useSaveOrders(state.patientId);

  const hasFiredEncounterStart = useRef(false);
  const orderSelectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fire encounter-start once when encounter is available
  useEffect(() => {
    if (
      !state.encounter ||
      hasFiredEncounterStart.current ||
      !discovery?.services
    ) {
      return;
    }
    hasFiredEncounterStart.current = true;
    fireHook("encounter-start", {
      userId: `Practitioner/${state.practitionerId}`,
      patientId: state.patientId,
      encounterId: state.encounter.id ?? "",
    });
  }, [
    state.encounter,
    state.practitionerId,
    state.patientId,
    discovery,
    fireHook,
  ]);

  // Fire order-select debounced when selectedOrders changes
  useEffect(() => {
    if (state.selectedOrders.length === 0) return;
    if (!discovery?.services) return;

    if (orderSelectTimer.current) {
      clearTimeout(orderSelectTimer.current);
    }

    orderSelectTimer.current = setTimeout(() => {
      const bundle = buildDraftOrdersBundle(
        state.selectedOrders,
        state.patientId,
        state.sharedFields,
        {
          encounterId: state.encounter?.id,
          practitionerId: state.practitionerId,
        },
      );
      const context: OrderSelectContext = {
        userId: `Practitioner/${state.practitionerId}`,
        patientId: state.patientId,
        encounterId: state.encounter?.id,
        selections: state.selectedOrders.map(
          (o) => `${o.template.resourceType}/draft-${o.templateId}`,
        ),
        draftOrders: bundle,
      };
      fireHook("order-select", context);
    }, 500);

    return () => {
      if (orderSelectTimer.current) {
        clearTimeout(orderSelectTimer.current);
      }
    };
  }, [
    state.selectedOrders,
    state.practitionerId,
    state.patientId,
    state.encounter,
    state.sharedFields,
    discovery,
    fireHook,
  ]);

  const handleSignAll = useCallback(async () => {
    if (state.selectedOrders.length === 0 || !discovery?.services) return;

    const bundle = buildDraftOrdersBundle(
      state.selectedOrders,
      state.patientId,
      state.sharedFields,
      {
        encounterId: state.encounter?.id,
        practitionerId: state.practitionerId,
      },
    );
    const context: OrderSignContext = {
      userId: `Practitioner/${state.practitionerId}`,
      patientId: state.patientId,
      encounterId: state.encounter?.id,
      draftOrders: bundle,
    };
    await fireHook("order-sign", context);

    const savedOrderIds = await saveOrders.mutateAsync(
      buildSignedOrdersTransactionBundle(
        state.selectedOrders,
        state.patientId,
        state.sharedFields,
        {
          encounterId: state.encounter?.id,
          practitionerId: state.practitionerId,
        },
      ),
    );

    dispatch({ type: "SIGN_COMPLETE", payload: savedOrderIds });
  }, [state, fireHook, discovery, saveOrders, dispatch]);

  return (
    <div className="space-y-4">
      <EncounterHeader />

      <OrderTemplateCatalog />

      <Separator />

      <SelectedOrdersList />

      <Separator />

      {/* Shared fields (coverage, reason, intent, priority, notes) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Common Fields</CardTitle>
        </CardHeader>
        <CardContent>
          <SharedOrderFields />
        </CardContent>
      </Card>

      {/* Sign All Orders */}
      <Button
        className="w-full"
        onClick={handleSignAll}
        disabled={
          isHookLoading ||
          !discovery?.services ||
          saveOrders.isPending ||
          state.selectedOrders.length === 0
        }
      >
        {saveOrders.isPending ? (
          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
        ) : (
          <Send className="h-4 w-4 mr-1.5" />
        )}
        {saveOrders.isPending
          ? "Saving Signed Orders..."
          : `Sign All Orders (${state.selectedOrders.length})`}
      </Button>
    </div>
  );
}
