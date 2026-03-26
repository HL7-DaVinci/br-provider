import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Bundle, Questionnaire, QuestionnaireResponse } from "fhir/r4";
import { useFhirServer } from "./use-fhir-server";

interface QuestionnairePackageParams {
  payerFhirUrl: string;
  providerFhirUrl: string;
  coverageRef?: string;
  orderRef?: string;
  coverageAssertionId?: string;
  questionnaire?: string;
}

/**
 * Fetches a questionnaire package from the payer via the BFF proxy.
 * Builds the FHIR Parameters per the DTR spec: the coverage and order
 * parameters require full embedded resources, not references.
 */
export function useQuestionnairePackage(params: QuestionnairePackageParams) {
  return useQuery({
    queryKey: [
      "dtr",
      "questionnaire-package",
      params.payerFhirUrl,
      params.providerFhirUrl,
      params.coverageRef,
      params.orderRef,
      params.questionnaire,
      params.coverageAssertionId,
    ],
    queryFn: async () => {
      const body = await buildQuestionnairePackageParams(params);

      const response = await fetch("/api/dtr/questionnaire-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payerFhirUrl: params.payerFhirUrl, body }),
        credentials: "same-origin",
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(
          errorBody?.error ??
            `Failed to fetch questionnaire package: ${response.status}`,
        );
      }

      const data = await response.json();
      const { contentServerUrl, terminologyServerUrl } = deriveServerUrls(data);
      return {
        bundle: data as Bundle,
        questionnaire: findResourceInResponse<Questionnaire>(
          data,
          "Questionnaire",
        ),
        questionnaireResponse: findResourceInResponse<QuestionnaireResponse>(
          data,
          "QuestionnaireResponse",
        ),
        contentServerUrl,
        terminologyServerUrl,
      };
    },
    enabled:
      !!params.payerFhirUrl &&
      !!params.providerFhirUrl &&
      (!!params.coverageRef || !!params.orderRef || !!params.questionnaire),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/**
 * Saves a completed QuestionnaireResponse to the provider FHIR server.
 */
export function useSaveQuestionnaireResponse(providerFhirUrl?: string) {
  const { serverUrl: selectedServerUrl } = useFhirServer();
  const queryClient = useQueryClient();
  const serverUrl = providerFhirUrl ?? selectedServerUrl;

  return useMutation({
    mutationFn: async (questionnaireResponse: QuestionnaireResponse) => {
      const method = questionnaireResponse.id ? "PUT" : "POST";
      const fhirUrl = questionnaireResponse.id
        ? `${serverUrl}/QuestionnaireResponse/${questionnaireResponse.id}`
        : `${serverUrl}/QuestionnaireResponse`;
      const proxyUrl = `/api/fhir-proxy?${new URLSearchParams({ url: fhirUrl })}`;

      const response = await fetch(proxyUrl, {
        method,
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(questionnaireResponse),
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error(
          `Failed to save QuestionnaireResponse: ${response.status}`,
        );
      }

      return response.json() as Promise<QuestionnaireResponse>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["fhir", "QuestionnaireResponse"],
      });
    },
  });
}

/**
 * Pre-populates a QuestionnaireResponse via server-side Questionnaire/$populate.
 * The BFF builds FHIR Endpoint resources for contentEndpoint/terminologyEndpoint
 * so HAPI CR resolves Libraries and ValueSets from their origin servers.
 */
export function useProviderPopulate(params: {
  payerFhirUrl: string;
  contentServerUrl?: string | null;
  terminologyServerUrl?: string | null;
  questionnaire: Questionnaire | null;
  patientId?: string;
}) {
  const contentUrl = params.contentServerUrl ?? params.payerFhirUrl;
  const terminologyUrl = params.terminologyServerUrl ?? contentUrl;

  return useQuery({
    queryKey: [
      "dtr",
      "provider-populate",
      params.questionnaire?.url,
      params.patientId,
    ],
    queryFn: async (): Promise<QuestionnaireResponse | null> => {
      const fhirParams = {
        resourceType: "Parameters",
        parameter: [
          { name: "questionnaire", resource: params.questionnaire },
          { name: "patientId", valueString: params.patientId },
          { name: "contentServerUrl", valueString: contentUrl },
          { name: "terminologyServerUrl", valueString: terminologyUrl },
        ],
      };

      const response = await fetch("/api/dtr/populate", {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(fhirParams),
        credentials: "same-origin",
      });

      if (!response.ok) {
        const err = await response.text().catch(() => "");
        console.warn(`Provider populate failed (${response.status}):`, err);
        return null;
      }

      const data = await response.json();
      return data?.resourceType === "QuestionnaireResponse"
        ? (data as QuestionnaireResponse)
        : null;
    },
    enabled:
      !!params.questionnaire && !!params.patientId && !!params.payerFhirUrl,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Mutation for adaptive questionnaire $next-question operations.
 */
export function useNextQuestion(payerFhirUrl: string) {
  return useMutation({
    mutationFn: async (questionnaireResponse: QuestionnaireResponse) => {
      const response = await fetch("/api/dtr/next-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payerFhirUrl,
          questionnaireResponse,
        }),
        credentials: "same-origin",
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(
          errorBody?.error ?? `Failed to get next question: ${response.status}`,
        );
      }

      return response.json() as Promise<QuestionnaireResponse>;
    },
  });
}

// -- Parameters builder --

/**
 * Builds a FHIR Parameters resource for the $questionnaire-package operation
 * per the DTR spec. Fetches the full Coverage and order resources from the
 * provider FHIR server and embeds them as "resource" parameters.
 */
async function buildQuestionnairePackageParams(
  params: QuestionnairePackageParams,
): Promise<Record<string, unknown>> {
  const parameterList: Record<string, unknown>[] = [];

  // Fetch coverage and order in parallel since they are independent
  const [coverage, order] = await Promise.all([
    params.coverageRef
      ? fetchProviderResource(params.providerFhirUrl, params.coverageRef)
      : null,
    params.orderRef
      ? fetchProviderResource(params.providerFhirUrl, params.orderRef)
      : null,
  ]);

  if (coverage) {
    parameterList.push({ name: "coverage", resource: coverage });
  }
  if (order) {
    parameterList.push({ name: "order", resource: order });
  }

  if (params.questionnaire) {
    parameterList.push({
      name: "questionnaire",
      valueCanonical: params.questionnaire,
    });
  }

  if (params.coverageAssertionId) {
    parameterList.push({
      name: "context",
      valueString: params.coverageAssertionId,
    });
  }

  return { resourceType: "Parameters", parameter: parameterList };
}

/**
 * Fetches a FHIR resource from the provider server via the BFF proxy.
 * Returns null if the resource is not found.
 */
async function fetchProviderResource(
  providerFhirUrl: string,
  ref: string,
): Promise<unknown | null> {
  const url = `/api/fhir-proxy?${new URLSearchParams({ url: `${providerFhirUrl}/${ref}` })}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return null;
  return res.json();
}

// -- Response parsing --

/**
 * Finds the first resource of the given type from a $questionnaire-package
 * response. Handles both the DTR spec format (Parameters with packagebundle
 * entries) and direct Bundle responses.
 */
function findResourceInResponse<T>(
  data: unknown,
  resourceType: string,
): T | null {
  const obj = data as Record<string, unknown>;

  if (obj.resourceType === "Parameters" && Array.isArray(obj.parameter)) {
    for (const param of obj.parameter as {
      name: string;
      resource?: Bundle;
    }[]) {
      if (param.name === "packagebundle" && param.resource) {
        const found = findResourceInBundle<T>(param.resource, resourceType);
        if (found) return found;
      }
    }
  }

  if (obj.resourceType === "Bundle") {
    return findResourceInBundle<T>(obj as unknown as Bundle, resourceType);
  }

  return null;
}

/**
 * Finds the first resource of the given type in a bundle,
 * including one level of nested Bundles.
 */
function findResourceInBundle<T>(
  bundle: Bundle,
  resourceType: string,
): T | null {
  if (!bundle.entry) return null;

  for (const entry of bundle.entry) {
    if (entry.resource?.resourceType === resourceType) {
      return entry.resource as T;
    }
    if (entry.resource?.resourceType === "Bundle") {
      const inner = entry.resource as Bundle;
      for (const innerEntry of inner.entry ?? []) {
        if (innerEntry.resource?.resourceType === resourceType) {
          return innerEntry.resource as T;
        }
      }
    }
  }

  return null;
}

// -- Server URL derivation --

/**
 * Derives content and terminology server base URLs from bundle entry
 * fullUrl values in a single pass. Walks Parameters packagebundle
 * entries and direct Bundles.
 */
function deriveServerUrls(data: unknown): {
  contentServerUrl: string | null;
  terminologyServerUrl: string | null;
} {
  const urls: { content: string | null; terminology: string | null } = {
    content: null,
    terminology: null,
  };
  const obj = data as Record<string, unknown>;

  function scanBundle(bundle: Bundle): void {
    for (const entry of bundle.entry ?? []) {
      const rt = entry.resource?.resourceType;
      if (rt === "Library" && !urls.content && entry.fullUrl) {
        urls.content = extractFhirBaseUrl(entry.fullUrl);
      } else if (rt === "ValueSet" && !urls.terminology && entry.fullUrl) {
        urls.terminology = extractFhirBaseUrl(entry.fullUrl);
      } else if (rt === "Bundle") {
        scanBundle(entry.resource as Bundle);
      }
      if (urls.content && urls.terminology) return;
    }
  }

  if (obj.resourceType === "Parameters" && Array.isArray(obj.parameter)) {
    for (const param of obj.parameter as {
      name: string;
      resource?: Bundle;
    }[]) {
      if (param.name === "packagebundle" && param.resource) {
        scanBundle(param.resource);
        if (urls.content && urls.terminology) break;
      }
    }
  } else if (obj.resourceType === "Bundle") {
    scanBundle(obj as unknown as Bundle);
  }

  return {
    contentServerUrl: urls.content ?? null,
    terminologyServerUrl: urls.terminology ?? null,
  };
}

/**
 * Extracts the FHIR base URL from a fullUrl by finding the last
 * occurrence of a known resource type path segment.
 */
function extractFhirBaseUrl(url: string): string | null {
  const withoutVersion = url.split("|")[0];
  const segments = [
    "/Library/",
    "/ValueSet/",
    "/CodeSystem/",
    "/Questionnaire/",
  ];
  for (const segment of segments) {
    const idx = withoutVersion.lastIndexOf(segment);
    if (idx !== -1) return withoutVersion.substring(0, idx);
  }
  return null;
}
