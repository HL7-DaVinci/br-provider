import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import type {
  CdsHookName,
  CdsHookRequest,
  CdsHookResponse,
  CdsServiceDefinition,
  CdsServiceDiscovery,
  CoverageInformation,
  HookContext,
  SystemAction,
} from "@/lib/cds-types";
import { useFhirServer } from "./use-fhir-server";
import { useOrderContext } from "./use-order-context";

const COVERAGE_INFO_EXT_URL =
  "http://hl7.org/fhir/us/davinci-crd/StructureDefinition/ext-coverage-information";

interface UseCdsHooksResult {
  fireHook: (hookName: CdsHookName, context: HookContext) => Promise<void>;
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

  // Refs for values read inside fireHook to keep the callback identity stable
  const stateRef = useRef(state);
  stateRef.current = state;

  const { data: discovery, isLoading: isDiscovering } = useQuery({
    queryKey: ["cds", "discovery", cdsServerUrl],
    queryFn: async () => {
      const res = await fetch(
        `/api/cds-services?server=${encodeURIComponent(cdsServerUrl)}`,
        { credentials: "same-origin" },
      );
      if (!res.ok) throw new Error("CDS service discovery failed");
      return res.json() as Promise<CdsServiceDiscovery>;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
    enabled: !!cdsServerUrl,
  });

  const fireHook = useCallback(
    async (hookName: CdsHookName, context: HookContext) => {
      if (!discovery?.services) {
        dispatch({
          type: "SET_HOOK_ERROR",
          payload: new Error("CDS services not yet discovered"),
        });
        return;
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
          );
        }

        const request: CdsHookRequest = {
          hook: hookName,
          hookInstance: crypto.randomUUID(),
          context,
          ...(prefetchData ? { prefetch: prefetchData } : {}),
        };

        const response = await fetch(
          `/api/cds-services/${service.id}?server=${encodeURIComponent(cdsServerUrl)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
            credentials: "same-origin",
          },
        );

        if (!response.ok) {
          const message = await parseErrorMessage(
            response,
            `CDS hook ${hookName} (service: ${service.id}) failed: ${response.status} ${response.statusText}`,
          );
          throw new Error(message);
        }

        const data: CdsHookResponse = await response.json();

        const newCoverageInfo = parseCoverageInformation(
          data.systemActions ?? [],
        );

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
          },
        });
      } catch (e) {
        const hookError = e instanceof Error ? e : new Error("CDS hook failed");
        dispatch({ type: "SET_HOOK_ERROR", payload: hookError });
      }
    },
    [cdsServerUrl, discovery, dispatch, serverUrl],
  );

  const clearResponses = useCallback(() => {
    dispatch({
      type: "SET_CDS_RESPONSE",
      payload: { coverageInfo: [], cards: [], hookName: "", rawResponse: null },
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
  selectedCoverageRef?: string,
): Promise<Record<string, unknown>> {
  const prefetch: Record<string, unknown> = {};

  // Build token replacement map from context fields
  const ctx = context as unknown as Record<string, unknown>;
  const tokenValues: Record<string, string> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (typeof value === "string") {
      tokenValues[`context.${key}`] = value;
    }
  }

  // Resolve each prefetch template in parallel
  const entries = Object.entries(templates);
  const results = await Promise.allSettled(
    entries.map(async ([key, template]) => {
      let query = template;
      for (const [token, value] of Object.entries(tokenValues)) {
        query = query.replaceAll(`{{${token}}}`, value);
      }

      // Skip if any unresolved tokens remain
      if (query.includes("{{")) return { key, data: undefined };

      const url = query.startsWith("http") ? query : `${serverUrl}/${query}`;
      const proxyUrl = `/api/fhir-proxy?${new URLSearchParams({ url })}`;
      const res = await fetch(proxyUrl, { credentials: "include" });
      if (!res.ok) return { key, data: undefined };
      return { key, data: await res.json() };
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
  const bundle = value as Record<string, unknown>;
  if (bundle.resourceType !== "Bundle") return false;
  const entries = bundle.entry as
    | Array<{ resource?: { resourceType?: string } }>
    | undefined;
  return entries?.some((e) => e.resource?.resourceType === "Coverage") ?? false;
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
  const b = bundle as Record<string, unknown>;
  const entries = (b.entry ?? []) as Array<{
    resource?: { resourceType?: string; id?: string };
    fullUrl?: string;
  }>;

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
          (issue: {
            diagnostics?: string;
            details?: { text?: string };
            severity?: string;
            code?: string;
          }) => issue.diagnostics || issue.details?.text,
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

// -- Extension parsing helpers --

interface FhirExtension {
  url: string;
  valueString?: string;
  valueCode?: string;
  valueReference?: { reference?: string };
  valueCoding?: { system?: string; code?: string; display?: string };
  valueCanonical?: string;
  valueDate?: string;
  valueUrl?: string;
  extension?: FhirExtension[];
}

interface FhirResource {
  resourceType?: string;
  extension?: FhirExtension[];
}

export function parseCoverageInformation(
  systemActions: SystemAction[],
): CoverageInformation[] {
  const results: CoverageInformation[] = [];

  for (const action of systemActions) {
    if (action.type !== "update") continue;

    const resource = action.resource as FhirResource;
    if (!resource?.extension) continue;

    for (const ext of resource.extension) {
      if (ext.url !== COVERAGE_INFO_EXT_URL) continue;
      if (!ext.extension) continue;

      const info = parseExtensionFields(ext.extension);
      results.push(info);
    }
  }

  return results;
}

function parseExtensionFields(
  extensions: FhirExtension[],
): CoverageInformation {
  const info: CoverageInformation = {};
  const details: string[] = [];
  const reasonCodes: { system: string; code: string; display?: string }[] = [];

  for (const ext of extensions) {
    switch (ext.url) {
      case "coverage":
        info.coverage = ext.valueReference?.reference;
        break;
      case "covered":
        info.covered = ext.valueCode as CoverageInformation["covered"];
        break;
      case "pa-needed":
        info.paNeeded = ext.valueCode as CoverageInformation["paNeeded"];
        break;
      case "doc-needed":
        info.docNeeded = ext.valueCode as CoverageInformation["docNeeded"];
        break;
      case "info-needed": {
        if (!info.infoNeeded) info.infoNeeded = [];
        if (ext.valueCode) info.infoNeeded.push(ext.valueCode);
        break;
      }
      case "billingCode":
        if (ext.valueCoding) {
          info.billingCode = {
            system: ext.valueCoding.system ?? "",
            code: ext.valueCoding.code ?? "",
            display: ext.valueCoding.display,
          };
        }
        break;
      case "reasonCode":
        if (ext.valueCoding) {
          reasonCodes.push({
            system: ext.valueCoding.system ?? "",
            code: ext.valueCoding.code ?? "",
            display: ext.valueCoding.display,
          });
        }
        break;
      case "coverage-assertion-id":
        info.coverageAssertionId = ext.valueString;
        break;
      case "satisfied-pa-id":
        info.satisfiedPaId = ext.valueString;
        break;
      case "questionnaire":
        info.questionnaire = ext.valueCanonical ?? ext.valueUrl;
        break;
      case "date":
        info.date = ext.valueDate;
        break;
      case "detail":
        if (ext.valueString) details.push(ext.valueString);
        break;
      case "contact":
        info.contactUrl = ext.valueUrl;
        break;
    }
  }

  if (details.length > 0) info.detail = details;
  if (reasonCodes.length > 0) info.reasonCode = reasonCodes;

  return info;
}
