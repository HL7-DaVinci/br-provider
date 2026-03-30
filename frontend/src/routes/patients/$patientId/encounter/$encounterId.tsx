import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import {
  EncounterDetailsForm,
  type EncounterDetailsFormHandle,
  TERMINAL_STATUSES,
} from "@/components/encounter/encounter-details-form";
import { EncounterDocumentation } from "@/components/encounter/encounter-documentation";
import { EncounterLinkedOrders } from "@/components/encounter/encounter-linked-orders";
import { EncounterPhaseIndicator } from "@/components/encounter/encounter-phase-indicator";
import { EncounterSummaryPanel } from "@/components/encounter/encounter-summary-panel";
import { EncounterTimeline } from "@/components/encounter/encounter-timeline";
import { PhaseReview } from "@/components/encounter/phase-review";
import { PhaseSelectOrders } from "@/components/encounter/phase-select-orders";
import { PhaseSign } from "@/components/encounter/phase-sign";
import { PhaseSummary } from "@/components/encounter/phase-summary";
import { CdsResponsePanel } from "@/components/order-form/cds-response-panel";
import { EncounterHeader } from "@/components/order-form/encounter-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useCdsHooks } from "@/hooks/use-cds-hooks";
import {
  invalidateOrderQueries,
  useDraftOrders,
  useEncounter,
  useEncounterOrders,
  useFinishEncounter,
  useOrderPaStatusMap,
  useSaveOrders,
  useUpdateEncounter,
} from "@/hooks/use-clinical-api";
import { OrderFormProvider, useOrderContext } from "@/hooks/use-order-context";
import { usePayerServer } from "@/hooks/use-payer-server";
import { DTR_COMPLETION_CHANNEL } from "@/lib/api";
import type {
  OrderDispatchContext,
  OrderSelectContext,
  OrderSignContext,
} from "@/lib/cds-types";
import {
  buildDraftOrdersBundle,
  buildOrderIdMap,
  buildSignedOrdersTransactionBundle,
  restoreOrdersFromResources,
} from "@/lib/draft-orders";

export const Route = createFileRoute(
  "/patients/$patientId/encounter/$encounterId",
)({
  component: EncounterEditorPage,
});

function EncounterEditorPage() {
  const { patientId, encounterId } = Route.useParams();
  const { fhirUser } = useAuth();
  const practitionerId = fhirUser?.replace(/^Practitioner\//, "") ?? "";

  return (
    <OrderFormProvider
      key={encounterId}
      patientId={patientId}
      practitionerId={practitionerId}
    >
      <ActiveEncounterWorkflow
        patientId={patientId}
        encounterId={encounterId}
      />
    </OrderFormProvider>
  );
}

function ActiveEncounterWorkflow({
  patientId,
  encounterId,
}: {
  patientId: string;
  encounterId: string;
}) {
  const { state, dispatch } = useOrderContext();
  const { cdsUrl } = usePayerServer();
  const { fireHook, discovery } = useCdsHooks(cdsUrl);
  const saveOrders = useSaveOrders();
  const finishEncounter = useFinishEncounter();
  const updateEncounter = useUpdateEncounter();
  const { data: encounterData } = useEncounter(encounterId);
  const { data: existingDrafts } = useDraftOrders(encounterId, patientId);
  const { data: encounterOrders, isFetched: ordersFetched } =
    useEncounterOrders(encounterId, patientId);
  const paStatusMap = useOrderPaStatusMap(patientId);
  const detailsFormRef = useRef<EncounterDetailsFormHandle>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Listen for DTR completion in child windows and refetch order data
  useEffect(() => {
    try {
      const channel = new BroadcastChannel(DTR_COMPLETION_CHANNEL);
      channel.onmessage = () => {
        invalidateOrderQueries(queryClient);
        queryClient.invalidateQueries({
          queryKey: ["fhir", "QuestionnaireResponse"],
        });
      };
      return () => channel.close();
    } catch {
      // BroadcastChannel not supported in this browser
    }
  }, [queryClient]);

  const hasFiredEncounterStart = useRef(false);
  const hasRestoredDrafts = useRef(false);
  const skipNextOrderSelect = useRef(false);
  const orderSelectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevOrderCount = useRef(0);

  // Ref for values needed by order-select but that should not trigger re-fires
  const stateRef = useRef(state);
  stateRef.current = state;

  const isTerminal = state.encounter
    ? TERMINAL_STATUSES.has(state.encounter.status)
    : false;

  useEffect(() => {
    if (!encounterData || state.encounter) return;
    dispatch({ type: "SET_ENCOUNTER", payload: encounterData });

    if (!TERMINAL_STATUSES.has(encounterData.status)) {
      dispatch({ type: "ADVANCE_PHASE", payload: "select" });
    }
  }, [encounterData, state.encounter, dispatch]);

  // Restore draft orders when resuming an encounter
  useEffect(() => {
    if (
      hasRestoredDrafts.current ||
      !existingDrafts?.length ||
      state.selectedOrders.length > 0 ||
      state.currentPhase !== "select"
    ) {
      return;
    }

    hasRestoredDrafts.current = true;

    const restored = restoreOrdersFromResources(existingDrafts);

    if (restored.selectedOrders.length > 0) {
      skipNextOrderSelect.current = true;
      dispatch({ type: "RESTORE_DRAFTS", payload: restored });
      dispatch({
        type: "ADD_TIMELINE_EVENT",
        payload: {
          message: `Restored ${restored.selectedOrders.length} draft order(s)`,
          type: "info",
        },
      });
    }
  }, [
    existingDrafts,
    state.selectedOrders.length,
    state.currentPhase,
    dispatch,
  ]);

  // Restore signed orders when resuming an encounter where orders were already
  // signed (active) but the encounter wasn't finished yet.
  useEffect(() => {
    if (
      hasRestoredDrafts.current ||
      existingDrafts?.length ||
      !encounterOrders?.length ||
      state.selectedOrders.length > 0 ||
      state.currentPhase !== "select"
    ) {
      return;
    }

    hasRestoredDrafts.current = true;
    const restored = restoreOrdersFromResources(encounterOrders);

    if (restored.selectedOrders.length > 0) {
      dispatch({ type: "RESTORE_DRAFTS", payload: restored });
      dispatch({ type: "ADVANCE_PHASE", payload: "review" });
      dispatch({
        type: "ADD_TIMELINE_EVENT",
        payload: {
          message: `Restored ${restored.selectedOrders.length} signed order(s)`,
          type: "info",
        },
      });
    }
  }, [
    encounterOrders,
    existingDrafts,
    state.selectedOrders.length,
    state.currentPhase,
    dispatch,
  ]);

  // Fire encounter-start CDS hook only for new encounters (not resuming).
  useEffect(() => {
    if (
      !state.encounter ||
      isTerminal ||
      hasFiredEncounterStart.current ||
      !discovery?.services ||
      !ordersFetched ||
      existingDrafts?.length ||
      encounterOrders?.length
    ) {
      return;
    }

    hasFiredEncounterStart.current = true;

    dispatch({
      type: "ADD_TIMELINE_EVENT",
      payload: { message: "Firing encounter-start hook", type: "cds" },
    });

    fireHook("encounter-start", {
      userId: `Practitioner/${state.practitionerId}`,
      patientId: state.patientId,
      encounterId: state.encounter.id ?? "",
    }).then(() => {
      dispatch({
        type: "ADD_TIMELINE_EVENT",
        payload: {
          message: "CDS response received (encounter-start)",
          type: "cds",
        },
      });
    });
  }, [
    state.encounter,
    state.practitionerId,
    state.patientId,
    discovery,
    fireHook,
    dispatch,
    isTerminal,
    ordersFetched,
    existingDrafts?.length,
    encounterOrders?.length,
  ]);

  // Fire order-select debounced when selectedOrders changes
  useEffect(() => {
    if (state.currentPhase !== "select") return;
    if (state.selectedOrders.length === 0) return;
    if (!discovery?.services) return;

    const sharedFields = state.sharedFields;

    // Skip the first fire after draft restore to avoid a premature CDS call
    if (skipNextOrderSelect.current) {
      skipNextOrderSelect.current = false;
      prevOrderCount.current = state.selectedOrders.length;
      return;
    }

    const currentCount = state.selectedOrders.length;
    if (prevOrderCount.current !== currentCount && prevOrderCount.current > 0) {
      const diff = currentCount - prevOrderCount.current;
      dispatch({
        type: "ADD_TIMELINE_EVENT",
        payload: {
          message:
            diff > 0
              ? `Order added (${currentCount} total)`
              : `Order removed (${currentCount} total)`,
          type: "info",
        },
      });
    }
    prevOrderCount.current = currentCount;

    if (orderSelectTimer.current) {
      clearTimeout(orderSelectTimer.current);
    }

    orderSelectTimer.current = setTimeout(() => {
      const s = stateRef.current;
      const bundle = buildDraftOrdersBundle(
        s.selectedOrders,
        s.patientId,
        sharedFields,
        {
          encounterId: s.encounter?.id,
          practitionerId: s.practitionerId,
          systemActionResources: s.systemActionResources,
        },
      );
      const context: OrderSelectContext = {
        userId: `Practitioner/${s.practitionerId}`,
        patientId: s.patientId,
        encounterId: s.encounter?.id,
        selections: s.selectedOrders.map(
          (o) => `${o.template.resourceType}/draft-${o.templateId}`,
        ),
        draftOrders: bundle,
      };

      dispatch({
        type: "ADD_TIMELINE_EVENT",
        payload: { message: "Firing order-select hook", type: "cds" },
      });

      fireHook("order-select", context).then(() => {
        dispatch({
          type: "ADD_TIMELINE_EVENT",
          payload: {
            message: "CDS response received (order-select)",
            type: "cds",
          },
        });
      });
    }, 500);

    return () => {
      if (orderSelectTimer.current) {
        clearTimeout(orderSelectTimer.current);
      }
    };
  }, [
    state.currentPhase,
    state.selectedOrders,
    state.sharedFields,
    fireHook,
    dispatch,
    discovery,
  ]);

  const handleOrderDispatch = useCallback(async () => {
    const s = stateRef.current;
    if (!discovery?.services) return;

    // Build dispatched order references from encounterOrders (works for both
    // the active review phase and revisiting finished encounters).
    const orderRefs =
      encounterOrders
        ?.filter((o) => o.resource.id)
        .map((o) => `${o.resourceType}/${o.resource.id}`) ?? [];

    if (orderRefs.length === 0) return;

    const context: OrderDispatchContext = {
      patientId: s.patientId,
      dispatchedOrders: orderRefs,
      performer: `Practitioner/${s.practitionerId}`,
    };

    dispatch({
      type: "ADD_TIMELINE_EVENT",
      payload: { message: "Firing order-dispatch hook", type: "cds" },
    });

    await fireHook("order-dispatch", context);

    dispatch({
      type: "ADD_TIMELINE_EVENT",
      payload: {
        message: "CDS response received (order-dispatch)",
        type: "cds",
      },
    });
  }, [encounterOrders, discovery, fireHook, dispatch]);

  // Order-sign handler -- saves orders but does NOT finish the encounter.
  // The encounter stays in-progress through the review phase.
  const handleOrderSign = useCallback(async () => {
    const s = stateRef.current;
    if (s.selectedOrders.length === 0) {
      throw new Error("No orders selected.");
    }
    if (!discovery?.services) {
      throw new Error("CDS services are not available yet.");
    }

    const bundle = buildDraftOrdersBundle(
      s.selectedOrders,
      s.patientId,
      s.sharedFields,
      {
        encounterId: s.encounter?.id,
        practitionerId: s.practitionerId,
        systemActionResources: s.systemActionResources,
      },
    );
    const context: OrderSignContext = {
      userId: `Practitioner/${s.practitionerId}`,
      patientId: s.patientId,
      encounterId: s.encounter?.id,
      draftOrders: bundle,
    };

    dispatch({
      type: "ADD_TIMELINE_EVENT",
      payload: { message: "Firing order-sign hook", type: "cds" },
    });

    const hookResult = await fireHook("order-sign", context);

    dispatch({
      type: "ADD_TIMELINE_EVENT",
      payload: {
        message: "CDS response received (order-sign)",
        type: "cds",
      },
    });

    dispatch({
      type: "ADD_TIMELINE_EVENT",
      payload: { message: "Persisting signed orders", type: "action" },
    });

    const systemActionResourcesToPersist = hookResult?.systemActionResources
      ?.size
      ? hookResult.systemActionResources
      : s.systemActionResources;

    const savedOrderIds = await saveOrders.mutateAsync(
      buildSignedOrdersTransactionBundle(
        s.selectedOrders,
        s.patientId,
        s.sharedFields,
        {
          encounterId: s.encounter?.id,
          practitionerId: s.practitionerId,
          systemActionResources: systemActionResourcesToPersist,
        },
      ),
    );

    dispatch({
      type: "ADD_TIMELINE_EVENT",
      payload: {
        message: `${savedOrderIds.length} order(s) saved to the FHIR server`,
        type: "action",
      },
    });

    const idMap = buildOrderIdMap(s.selectedOrders, savedOrderIds);
    if (idMap.size > 0) {
      dispatch({ type: "SET_ORDER_SERVER_IDS", payload: idMap });
    }

    return savedOrderIds;
  }, [fireHook, dispatch, discovery, saveOrders]);

  const handleFinishEncounter = useCallback(async () => {
    const s = stateRef.current;
    const encounterToFinish =
      detailsFormRef.current?.buildUpdatedEncounter() ?? s.encounter;
    if (!encounterToFinish) return;

    try {
      const updated = await finishEncounter.mutateAsync(encounterToFinish);
      dispatch({ type: "SET_ENCOUNTER", payload: updated });
      dispatch({
        type: "ADD_TIMELINE_EVENT",
        payload: { message: "Encounter marked as finished", type: "action" },
      });

      if (discovery?.services) {
        dispatch({
          type: "ADD_TIMELINE_EVENT",
          payload: {
            message: "Firing encounter-discharge hook",
            type: "cds",
          },
        });

        fireHook("encounter-discharge", {
          userId: `Practitioner/${s.practitionerId}`,
          patientId: s.patientId,
          encounterId: updated.id ?? encounterToFinish.id ?? "",
        }).then(() => {
          dispatch({
            type: "ADD_TIMELINE_EVENT",
            payload: {
              message: "CDS response received (encounter-discharge)",
              type: "cds",
            },
          });
        });
      }

      dispatch({ type: "ADVANCE_PHASE", payload: "summary" });
    } catch (err) {
      dispatch({
        type: "ADD_TIMELINE_EVENT",
        payload: {
          message: `Failed to finish encounter: ${err instanceof Error ? err.message : "unknown"}`,
          type: "error",
        },
      });
    }
  }, [finishEncounter, dispatch, discovery, fireHook]);

  const handleSaveEncounter = useCallback(async () => {
    const updated = detailsFormRef.current?.buildUpdatedEncounter();
    if (!updated) return;
    const saved = await updateEncounter.mutateAsync(updated);
    dispatch({ type: "SET_ENCOUNTER", payload: saved });
  }, [updateEncounter, dispatch]);

  const handleExit = useCallback(() => {
    navigate({
      to: "/patients/$patientId/encounter",
      params: { patientId },
    });
  }, [navigate, patientId]);

  function renderPhase() {
    if (isTerminal) {
      return (
        <div className="space-y-4">
          <EncounterLinkedOrders
            encounterId={encounterId}
            patientId={patientId}
            paStatusMap={paStatusMap}
            onDispatch={handleOrderDispatch}
          />
          <EncounterDocumentation encounterId={encounterId} />
        </div>
      );
    }

    switch (state.currentPhase) {
      case "start":
        return null;
      case "select":
        return (
          <PhaseSelectOrders
            onSaveEncounter={handleSaveEncounter}
            onFinish={handleFinishEncounter}
          />
        );
      case "sign":
        return <PhaseSign onConfirmSign={handleOrderSign} />;
      case "review":
        return (
          <PhaseReview
            patientId={patientId}
            encounterId={encounterId}
            onFinish={handleFinishEncounter}
            onDispatch={handleOrderDispatch}
          />
        );
      case "summary":
        return <PhaseSummary patientId={patientId} onExit={handleExit} />;
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto border-r p-4">
        <Link
          to="/patients/$patientId/encounter"
          params={{ patientId }}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2 cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Encounters
        </Link>

        {!isTerminal && <EncounterPhaseIndicator />}
        {(state.currentPhase !== "start" || isTerminal) && <EncounterHeader />}

        {state.encounter &&
          state.currentPhase !== "review" &&
          state.currentPhase !== "summary" && (
            <div className="mt-4">
              <EncounterDetailsForm
                ref={detailsFormRef}
                encounter={state.encounter}
                readOnly={isTerminal}
              />
            </div>
          )}

        <div className="mt-4">{renderPhase()}</div>
      </div>

      <div className="w-100 min-w-87.5 overflow-y-auto p-4 bg-muted/30">
        {isTerminal ? (
          <EncounterSummaryPanel
            encounterId={encounterId}
            patientId={patientId}
          />
        ) : (
          <div className="space-y-4">
            {(state.currentPhase === "select" ||
              state.currentPhase === "sign" ||
              state.currentPhase === "review") && <CdsResponsePanel />}
            {state.currentPhase === "summary" && (
              <EncounterSummaryPanel
                encounterId={encounterId}
                patientId={patientId}
              />
            )}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <EncounterTimeline />
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
