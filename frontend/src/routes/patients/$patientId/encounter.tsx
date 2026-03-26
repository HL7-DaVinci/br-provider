import { createFileRoute } from "@tanstack/react-router";
import type { Encounter } from "fhir/r4";
import { Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClinicalTable } from "@/components/clinical-table";
import { EncounterPhaseIndicator } from "@/components/encounter/encounter-phase-indicator";
import { EncounterTimeline } from "@/components/encounter/encounter-timeline";
import { PhaseSelectOrders } from "@/components/encounter/phase-select-orders";
import { PhaseSign } from "@/components/encounter/phase-sign";
import { PhaseSummary } from "@/components/encounter/phase-summary";
import { CdsResponsePanel } from "@/components/order-form/cds-response-panel";
import { EncounterHeader } from "@/components/order-form/encounter-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useCdsHooks } from "@/hooks/use-cds-hooks";
import { useEncounters, useSaveOrders } from "@/hooks/use-clinical-api";
import { useFhirServer } from "@/hooks/use-fhir-server";
import { OrderFormProvider, useOrderContext } from "@/hooks/use-order-context";
import { usePayerServer } from "@/hooks/use-payer-server";
import type { OrderSelectContext, OrderSignContext } from "@/lib/cds-types";
import { formatClinicalDate } from "@/lib/clinical-formatters";
import {
  buildDraftOrdersBundle,
  buildSignedOrdersTransactionBundle,
} from "@/lib/draft-orders";

export const Route = createFileRoute("/patients/$patientId/encounter")({
  component: EncounterPage,
});

function EncounterPage() {
  const { patientId } = Route.useParams();
  const { fhirUser } = useAuth();
  const practitionerId = fhirUser?.replace(/^Practitioner\//, "") ?? "";
  const [activeEncounterId, setActiveEncounterId] = useState<string | null>(
    null,
  );

  if (activeEncounterId) {
    return (
      <OrderFormProvider patientId={patientId} practitionerId={practitionerId}>
        <ActiveEncounterWorkflow
          patientId={patientId}
          encounterId={activeEncounterId}
          onExit={() => setActiveEncounterId(null)}
        />
      </OrderFormProvider>
    );
  }

  return (
    <EncounterList
      patientId={patientId}
      practitionerId={practitionerId}
      onStart={setActiveEncounterId}
    />
  );
}

// -- Encounter List Mode --

function EncounterList({
  patientId,
  practitionerId,
  onStart,
}: {
  patientId: string;
  practitionerId: string;
  onStart: (encounterId: string) => void;
}) {
  const { serverUrl } = useFhirServer();
  const { data, isLoading } = useEncounters(patientId);
  const [isCreating, setIsCreating] = useState(false);
  const createGuard = useRef(false);

  const encounters: Encounter[] =
    data?.entry?.map((e) => e.resource).filter((r): r is Encounter => !!r) ??
    [];

  const handleStartNew = useCallback(async () => {
    if (createGuard.current || !serverUrl) return;
    createGuard.current = true;
    setIsCreating(true);

    try {
      const encounter: Partial<Encounter> = {
        resourceType: "Encounter",
        status: "in-progress",
        class: {
          system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
          code: "AMB",
          display: "ambulatory",
        },
        subject: { reference: `Patient/${patientId}` },
        participant: practitionerId
          ? [
              {
                individual: {
                  reference: `Practitioner/${practitionerId}`,
                },
              },
            ]
          : [],
        period: { start: new Date().toISOString() },
      };

      const proxyUrl = `/api/fhir-proxy?${new URLSearchParams({ url: `${serverUrl}/Encounter` })}`;
      const response = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(encounter),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Failed to create encounter: ${response.status}`);
      }

      const created = (await response.json()) as Encounter;
      onStart(created.id ?? "");
    } catch {
      createGuard.current = false;
      setIsCreating(false);
    }
  }, [serverUrl, patientId, practitionerId, onStart]);

  return (
    <div className="p-6 max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Encounters</h2>
        <Button size="sm" onClick={handleStartNew} disabled={isCreating}>
          <Play className="h-3.5 w-3.5 mr-1" />
          {isCreating ? "Starting..." : "Start New Encounter"}
        </Button>
      </div>

      <ClinicalTable<Encounter>
        loading={isLoading}
        keyExtractor={(e) => e.id ?? ""}
        columns={[
          {
            header: "Status",
            accessor: (e) => (
              <Badge
                variant={e.status === "in-progress" ? "default" : "secondary"}
              >
                {e.status}
              </Badge>
            ),
          },
          {
            header: "Class",
            accessor: (e) => e.class?.display ?? e.class?.code ?? "",
          },
          {
            header: "Date",
            accessor: (e) => formatClinicalDate(e.period?.start),
          },
          {
            header: "ID",
            accessor: (e) => <span className="font-mono text-xs">{e.id}</span>,
          },
        ]}
        data={encounters}
        emptyMessage="No encounters found for this patient."
      />
    </div>
  );
}

// -- Active Encounter Workflow --

function ActiveEncounterWorkflow({
  patientId,
  encounterId,
  onExit,
}: {
  patientId: string;
  encounterId: string;
  onExit: () => void;
}) {
  const { state, dispatch } = useOrderContext();
  const { serverUrl } = useFhirServer();
  const { cdsUrl } = usePayerServer();
  const { fireHook, discovery } = useCdsHooks(cdsUrl);
  const saveOrders = useSaveOrders(state.patientId);

  const hasFiredEncounterStart = useRef(false);
  const orderSelectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevOrderCount = useRef(0);

  // Fetch the encounter by ID (single GET, no POST)
  useEffect(() => {
    if (state.encounter || !serverUrl) return;

    const fetchEncounter = async () => {
      try {
        const proxyUrl = `/api/fhir-proxy?${new URLSearchParams({ url: `${serverUrl}/Encounter/${encounterId}` })}`;
        const response = await fetch(proxyUrl, {
          credentials: "include",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const encounter = (await response.json()) as Encounter;
        dispatch({ type: "SET_ENCOUNTER", payload: encounter });
        dispatch({ type: "ADVANCE_PHASE", payload: "select" });
        dispatch({
          type: "ADD_TIMELINE_EVENT",
          payload: {
            message: `Encounter started (${encounter.id})`,
            type: "info",
          },
        });
      } catch (err) {
        dispatch({
          type: "ADD_TIMELINE_EVENT",
          payload: {
            message: `Failed to load encounter: ${err instanceof Error ? err.message : "unknown"}`,
            type: "error",
          },
        });
      }
    };

    fetchEncounter();
  }, [serverUrl, encounterId, state.encounter, dispatch]);

  // Fire encounter-start CDS hook once when encounter is available
  useEffect(() => {
    if (
      !state.encounter ||
      hasFiredEncounterStart.current ||
      !discovery?.services
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
  ]);

  // Fire order-select debounced when selectedOrders changes (only during select phase)
  useEffect(() => {
    if (state.currentPhase !== "select") return;
    if (state.selectedOrders.length === 0) return;
    if (!discovery?.services) return;

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
    state.practitionerId,
    state.patientId,
    state.encounter,
    state.sharedFields,
    fireHook,
    dispatch,
    discovery,
  ]);

  // Order-sign handler
  const handleOrderSign = useCallback(async () => {
    if (state.selectedOrders.length === 0) {
      throw new Error("No orders selected.");
    }
    if (!discovery?.services) {
      throw new Error("CDS services are not available yet.");
    }

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

    dispatch({
      type: "ADD_TIMELINE_EVENT",
      payload: { message: "Firing order-sign hook", type: "cds" },
    });

    await fireHook("order-sign", context);

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

    dispatch({
      type: "ADD_TIMELINE_EVENT",
      payload: {
        message: `${savedOrderIds.length} order(s) saved to the FHIR server`,
        type: "action",
      },
    });

    return savedOrderIds;
  }, [state, fireHook, dispatch, discovery, saveOrders]);

  function renderPhase() {
    switch (state.currentPhase) {
      case "start":
        return <EncounterHeader />;
      case "select":
        return <PhaseSelectOrders />;
      case "sign":
        return <PhaseSign onConfirmSign={handleOrderSign} />;
      case "summary":
        return <PhaseSummary patientId={patientId} onExit={onExit} />;
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto border-r p-4">
        <EncounterPhaseIndicator />
        {state.currentPhase !== "start" && <EncounterHeader />}
        <div className="mt-4">{renderPhase()}</div>
      </div>

      <div className="w-100 min-w-87.5 overflow-y-auto p-4 bg-muted/30">
        <CdsResponsePanel />
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <EncounterTimeline />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
