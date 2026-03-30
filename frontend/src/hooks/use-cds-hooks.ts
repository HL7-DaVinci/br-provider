import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  Bundle,
  DomainResource,
  OperationOutcomeIssue,
  Resource,
} from "fhir/r4";
import { useCallback, useRef } from "react";
import { ACTIVE_PROVIDER_FHIR_BASE_HEADER, fhirProxyUrl } from "@/lib/api";
import type {
  CdsHookName,
  CdsHookRequest,
  CdsHookResponse,
  CdsServiceDefinition,
  CdsServiceDiscovery,
  CoverageInformation,
  HookContext,
} from "@/lib/cds-types";
import { parseCoverageInfoFromResource } from "@/lib/coverage-extensions";
import { loggedFetch } from "@/lib/logged-fetch";
import { useFhirServer } from "./use-fhir-server";
import { useOrderContext } from "./use-order-context";

export interface FireHookResult {
  systemActionResources: Map<string, Resource>;
}

interface UseCdsHooksResult {
  fireHook: (
    hookName: CdsHookName,
    context: HookContext,
  ) => Promise<FireHookResult | undefined>;
  discovery: CdsServiceDiscovery | undefined;
  isDiscovering: boolean;
  isLoading: boolean;
  clearResponses: () => void;
}

/**
 * Manages the CDS Hooks lifecycle: discovers available services, resolves
 * prefetch data from discovery templates, fires hooks via the backend relay,
 * parses responses, and syncs coverage info + cards into the order context.
 */
export function useCdsHooks(cdsServerUrl: string): UseCdsHooksResult {
  const { dispatch, state } = useOrderContext();
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();

  // Refs for values read inside fireHook to keep the callback identity stable
  const stateRef = useRef(state);
  stateRef.current = state;

  const { data: discovery, isLoading: isDiscovering } = useQuery({
    queryKey: ["cds", "discovery", cdsServerUrl],
    queryFn: async () => {
      const res = await loggedFetch(
        `/api/cds-services?server=${encodeURIComponent(cdsServerUrl)}`,
        { credentials: "same-origin" },
        { payerUrl: cdsServerUrl, operationName: "CDS Discovery" },
      );
      if (!res.ok) throw new Error("CDS service discovery failed");
      return res.json() as Promise<CdsServiceDiscovery>;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
    enabled: !!cdsServerUrl,
  });

  const fireHook = useCallback(
    async (
      hookName: CdsHookName,
      context: HookContext,
    ): Promise<FireHookResult | undefined> => {
      if (!discovery?.services) {
        dispatch({
          type: "SET_HOOK_ERROR",
          payload: new Error("CDS services not yet discovered"),
        });
        return undefined;
      }

      const service = discovery.services.find(
        (s: CdsServiceDefinition) => s.hook === hookName,
      );
      if (!service) {
        dispatch({
          type: "SET_HOOK_ERROR",
          payload: new Error(`No CDS service found for hook: ${hookName}`),
        });
        return;
      }

      dispatch({ type: "SET_HOOK_LOADING", payload: true });

      try {
        // Resolve prefetch data from the service's discovery templates
        const selectedCoverageRef =
          (stateRef.current.sharedFields?.insuranceRef as string) || undefined;
        let prefetchData: Record<string, unknown> | undefined;
        if (
          service.prefetch &&
          Object.keys(service.prefetch).length > 0 &&
          serverUrl
        ) {
          prefetchData = await resolvePrefetch(
            service.prefetch,
            context,
            serverUrl,
            selectedCoverageRef,
            queryClient,
          );
        }

        const request: CdsHookRequest = {
          hook: hookName,
          hookInstance: crypto.randomUUID(),
          context,
          ...(serverUrl ? { fhirServer: serverUrl } : {}),
          ...(prefetchData ? { prefetch: prefetchData } : {}),
        };

        const response = await loggedFetch(
          `/api/cds-services/${service.id}?server=${encodeURIComponent(cdsServerUrl)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(serverUrl
                ? { [ACTIVE_PROVIDER_FHIR_BASE_HEADER]: serverUrl }
                : {}),
            },
            body: JSON.stringify(request),
            credentials: "same-origin",
          },
          { payerUrl: cdsServerUrl, operationName: `CDS ${hookName}` },
        );

        if (!response.ok) {
          const message = await parseErrorMessage(
            response,
            `CDS hook ${hookName} (service: ${service.id}) failed: ${response.status} ${response.statusText}`,
          );
          throw new Error(message);
        }

        const data: CdsHookResponse = await response.json();

        const actions = data.systemActions ?? [];
        const newCoverageInfo: CoverageInformation[] = [];
        const updateResources = new Map<string, Resource>();
        for (const action of actions) {
          if (action.type !== "update" || !action.resource) continue;
          const r = action.resource;
          if (r.resourceType) {
            const key = r.id ? `${r.resourceType}/${r.id}` : r.resourceType;
            updateResources.set(key, r);
          }
          newCoverageInfo.push(
            ...parseCoverageInfoFromResource(r as DomainResource),
          );
        }

        dispatch({
          type: "SET_CDS_RESPONSE",
          payload: {
            coverageInfo:
              newCoverageInfo.length > 0
                ? newCoverageInfo
                : stateRef.current.coverageInfo,
            cards: data.cards ?? [],
            hookName,
            rawResponse: data,
            systemActionResources:
              updateResources.size > 0
                ? updateResources
                : stateRef.current.systemActionResources,
          },
        });

        return { systemActionResources: updateResources };
      } catch (e) {
        const hookError = e instanceof Error ? e : new Error("CDS hook failed");
        dispatch({ type: "SET_HOOK_ERROR", payload: hookError });
      }
    },
    [cdsServerUrl, discovery, dispatch, serverUrl, queryClient],
  );

  const clearResponses = useCallback(() => {
    dispatch({
      type: "SET_CDS_RESPONSE",
      payload: {
        coverageInfo: [],
        cards: [],
        hookName: "",
        rawResponse: null,
        systemActionResources: new Map(),
      },
    });
  }, [dispatch]);

  return {
    fireHook,
    discovery,
    isDiscovering,
    isLoading: state.isHookLoading,
    clearResponses,
  };
}

// -- Prefetch resolution --

/**
 * Resolves prefetch data by executing the FHIR queries declared in the
 * service's discovery prefetch templates. Replaces {{context.*}} tokens
 * with actual values from the hook context, then fetches each resource
 * via the BFF proxy.
 *
 * If a selectedCoverageRef is provided and a prefetch key returns a
 * Coverage search Bundle with multiple entries, filters to only the
 * selected Coverage.
 */
async function resolvePrefetch(
  templates: Record<string, string>,
  context: HookContext,
  serverUrl: string,
  selectedCoverageRef: string | undefined,
  qc: QueryClient,
): Promise<Record<string, unknown>> {
  const prefetch: Record<string, unknown> = {};

  const ctx = context as unknown as Record<string, unknown>;
  const tokenValues: Record<string, string> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (typeof value === "string") {
      tokenValues[`context.${key}`] = value;
    }
  }

  const entries = Object.entries(templates);
  const results = await Promise.allSettled(
    entries.map(async ([key, template]) => {
      let query = template;
      for (const [token, value] of Object.entries(tokenValues)) {
        query = query.replaceAll(`{{${token}}}`, value);
      }

      if (query.includes("{{")) return { key, data: undefined };

      const url = query.startsWith("http") ? query : `${serverUrl}/${query}`;
      const proxyUrl = fhirProxyUrl(url);

      try {
        const data = await qc.fetchQuery({
          queryKey: ["cds-prefetch", url],
          queryFn: async () => {
            const res = await fetch(proxyUrl, { credentials: "include" });
            if (!res.ok) return undefined;
            return res.json();
          },
          staleTime: 60 * 1000,
        });
        return { key, data };
      } catch {
        return { key, data: undefined };
      }
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.data !== undefined) {
      prefetch[result.value.key] = result.value.data;
    }
  }

  // CRD requires exactly one Coverage in prefetch. If the user selected a
  // specific coverage, filter to that one. Otherwise, keep only the first.
  for (const [key, value] of Object.entries(prefetch)) {
    if (isCoverageBundle(value)) {
      prefetch[key] = filterToSingleCoverage(value, selectedCoverageRef);
    }
  }

  return prefetch;
}

/**
 * Checks if a value looks like a FHIR search Bundle containing Coverage resources.
 */
function isCoverageBundle(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const bundle = value as Bundle;
  if (bundle.resourceType !== "Bundle") return false;
  return (
    bundle.entry?.some((e) => e.resource?.resourceType === "Coverage") ?? false
  );
}

/**
 * Ensures a Coverage search Bundle contains at most one entry.
 * If selectedRef is provided, filters to that specific Coverage.
 * Otherwise, keeps only the first entry.
 */
function filterToSingleCoverage(
  bundle: unknown,
  selectedRef?: string,
): unknown {
  const b = bundle as Bundle;
  const entries = b.entry ?? [];

  if (entries.length <= 1) return bundle;

  let selected: typeof entries;
  if (selectedRef) {
    const selectedId = selectedRef.replace(/^Coverage\//, "");
    selected = entries.filter(
      (e) =>
        e.resource?.id === selectedId ||
        e.fullUrl?.endsWith(`/Coverage/${selectedId}`),
    );
    if (selected.length === 0) selected = entries.slice(0, 1);
  } else {
    selected = entries.slice(0, 1);
  }

  return {
    ...b,
    entry: selected,
    total: selected.length,
  };
}

// -- Error parsing --

async function parseErrorMessage(
  response: Response,
  defaultMessage: string,
): Promise<string> {
  try {
    const body = await response.json();
    if (
      body?.resourceType === "OperationOutcome" &&
      Array.isArray(body.issue)
    ) {
      const diagnostics = body.issue
        .map(
          (issue: OperationOutcomeIssue) =>
            issue.diagnostics || issue.details?.text,
        )
        .filter(Boolean);
      if (diagnostics.length > 0) {
        return diagnostics.join("; ");
      }
    }
    if (body?.error_description || body?.error) {
      return body.error_description || body.error;
    }
    if (body?.message) {
      return body.message;
    }
  } catch {
    // Response body wasn't JSON
  }
  return defaultMessage;
}
