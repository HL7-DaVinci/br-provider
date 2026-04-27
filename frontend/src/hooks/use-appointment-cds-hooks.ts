import type { Appointment, Bundle } from "fhir/r4";
import { useCallback, useRef } from "react";
import type {
  AppointmentBookContext,
  CdsHookName,
  HookContext,
} from "@/lib/cds-types";
import { useAppointmentContext } from "./use-appointment-context";
import {
  type CdsHooksCallbacks,
  type FireHookOptions,
  type FireHookResult,
  useCdsHooksCore,
} from "./use-cds-hooks";
import { useFhirServer } from "./use-fhir-server";

export function buildAppointmentBookContext(
  appointment: Appointment,
  patientId: string,
): AppointmentBookContext {
  const appointmentsBundle: Bundle = {
    resourceType: "Bundle",
    type: "collection",
    entry: [{ resource: appointment }],
  };

  return {
    userId: `Patient/${patientId}`,
    patientId,
    appointments: appointmentsBundle,
  };
}

/**
 * CDS Hooks wrapper wired to the appointment context.
 * Same lifecycle as useCdsHooks but dispatches to AppointmentContext
 * instead of OrderContext.
 */
export function useAppointmentCdsHooks(cdsServerUrl: string) {
  const { dispatch, state } = useAppointmentContext();
  const { serverUrl } = useFhirServer();

  const stateRef = useRef(state);
  stateRef.current = state;

  const callbacks: CdsHooksCallbacks = {
    onLoading: (loading) =>
      dispatch({ type: "SET_HOOK_LOADING", payload: loading }),
    onError: (error) => dispatch({ type: "SET_HOOK_ERROR", payload: error }),
    onResponse: (response) =>
      dispatch({ type: "SET_CDS_RESPONSE", payload: response }),
    getCoverageRef: () => stateRef.current.selectedCoverageRef,
    getPreviousCoverageInfo: () => stateRef.current.coverageInfo,
    getPreviousSystemActions: () => stateRef.current.systemActionResources,
  };

  const { fireHook, discovery, isDiscovering } = useCdsHooksCore(
    cdsServerUrl,
    serverUrl,
    callbacks,
  );

  const checkAppointmentCoverage = useCallback(
    (
      appointment: Appointment,
      options: FireHookOptions = { preservePreviousCoverageInfo: false },
    ) =>
      fireHook(
        "appointment-book",
        buildAppointmentBookContext(appointment, stateRef.current.patientId),
        options,
      ),
    [fireHook],
  );

  return {
    fireHook: fireHook as (
      hookName: CdsHookName,
      context: HookContext,
      options?: FireHookOptions,
    ) => Promise<FireHookResult | undefined>,
    checkAppointmentCoverage,
    discovery,
    isDiscovering,
    isLoading: state.isHookLoading,
  };
}
