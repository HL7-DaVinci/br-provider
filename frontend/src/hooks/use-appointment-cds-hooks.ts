import { useRef } from "react";
import type { CdsHookName, HookContext } from "@/lib/cds-types";
import { useAppointmentContext } from "./use-appointment-context";
import {
  type CdsHooksCallbacks,
  type FireHookResult,
  useCdsHooksCore,
} from "./use-cds-hooks";
import { useFhirServer } from "./use-fhir-server";

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

  return {
    fireHook: fireHook as (
      hookName: CdsHookName,
      context: HookContext,
    ) => Promise<FireHookResult | undefined>,
    discovery,
    isDiscovering,
    isLoading: state.isHookLoading,
  };
}
