import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  Bundle,
  OperationOutcome,
  ParametersParameter,
  Questionnaire,
  QuestionnaireResponse,
} from "fhir/r4";
import { fhirProxyUrl, fhirSend } from "@/lib/api";
import {
  extractPackageBundle,
  inlineBundleValueSets,
} from "@/lib/dtr-ingestion";
import { extractFhirError } from "@/lib/fhir-types";
import { loggedFetch } from "@/lib/logged-fetch";
import { useFhirServer } from "./use-fhir-server";

interface QuestionnairePackageParams {
  payerFhirUrl: string;
  providerFhirUrl: string;
  coverageRef?: string;
  orderRef?: string;
  coverageAssertionId?: string;
  questionnaire?: string[];
  enabled?: boolean;
}

interface QuestionnairePackageResult {
  bundle: Bundle | null;
  questionnaire: Questionnaire | null;
  questionnaireResponse: QuestionnaireResponse | null;
  contentServerUrl: string | null;
  terminologyServerUrl: string | null;
}

async function fetchQuestionnairePackage(
  params: QuestionnairePackageParams,
): Promise<QuestionnairePackageResult> {
  const body = await buildQuestionnairePackageParams(params);

  const response = await loggedFetch(
    fhirProxyUrl(
      `${params.payerFhirUrl}/Questionnaire/$questionnaire-package`,
      { payer: true, op: "dtr" },
    ),
    {
      method: "POST",
      headers: { "Content-Type": "application/fhir+json" },
      body: JSON.stringify(body),
    },
    {
      payerUrl: params.payerFhirUrl,
      operationName: "$questionnaire-package",
    },
  );

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(
      extractFhirError(errorBody) ??
        `Failed to fetch questionnaire package: ${response.status}`,
    );
  }

  const data = await response.json();
  const { contentServerUrl, terminologyServerUrl } = deriveServerUrls(data);
  // Payers may return Parameters wrapping the bundle; $populate consumers
  // expect a bare Bundle with populated .entry.
  const bundle = extractPackageBundle(data, params.questionnaire?.[0]);
  const questionnaire = bundle
    ? findResourceInBundle<Questionnaire>(bundle, "Questionnaire")
    : null;
  return {
    bundle,
    // Resolve answerValueSet references against the bundle's expanded
    // ValueSets so choice items render without a terminology server
    questionnaire:
      questionnaire && bundle
        ? inlineBundleValueSets(questionnaire, bundle)
        : questionnaire,
    questionnaireResponse: bundle
      ? findResourceInBundle<QuestionnaireResponse>(
          bundle,
          "QuestionnaireResponse",
        )
      : null,
    contentServerUrl,
    terminologyServerUrl,
  };
}

function questionnairePackageQueryKey(
  params: QuestionnairePackageParams,
): unknown[] {
  return [
    "dtr",
    "questionnaire-package",
    params.payerFhirUrl,
    params.providerFhirUrl,
    params.coverageRef,
    params.orderRef,
    params.questionnaire ?? [],
    params.coverageAssertionId,
  ];
}

function isPackageEnabled(params: QuestionnairePackageParams): boolean {
  if (params.enabled === false) return false;
  return (
    !!params.payerFhirUrl &&
    !!params.providerFhirUrl &&
    (!!params.coverageRef ||
      !!params.orderRef ||
      (params.questionnaire?.length ?? 0) > 0)
  );
}

/**
 * Fetches a questionnaire package from the payer via the BFF proxy.
 * Builds the FHIR Parameters per the DTR spec: the coverage and order
 * parameters require full embedded resources, not references.
 */
export function useQuestionnairePackage(params: QuestionnairePackageParams) {
  return useQuery({
    queryKey: questionnairePackageQueryKey(params),
    queryFn: () => fetchQuestionnairePackage(params),
    enabled: isPackageEnabled(params),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export interface QuestionnairePackageEntry {
  canonical: string;
  bundle: Bundle | null;
  questionnaire: Questionnaire | null;
  questionnaireResponse: QuestionnaireResponse | null;
  contentServerUrl: string | null;
  terminologyServerUrl: string | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

/**
 * Fetches a questionnaire package per canonical, in parallel. Each entry's
 * `$questionnaire-package` runs the payer's prepopulation library against
 * current provider FHIR data at the moment its query fires, so a sequenced
 * flow that reaches Q2 after Q1 is saved sees the freshest provider state.
 *
 * Returns one entry per input canonical, in the same order.
 */
export function useQuestionnairePackages(
  canonicals: string[],
  rest: Omit<QuestionnairePackageParams, "questionnaire">,
): QuestionnairePackageEntry[] {
  const queries = useQueries({
    queries: canonicals.map((canonical) => {
      const params: QuestionnairePackageParams = {
        ...rest,
        questionnaire: [canonical],
      };
      return {
        queryKey: questionnairePackageQueryKey(params),
        queryFn: () => fetchQuestionnairePackage(params),
        enabled: !!canonical && isPackageEnabled(params),
        staleTime: 5 * 60 * 1000,
        retry: 1,
      };
    }),
  });

  return canonicals.map((canonical, idx) => {
    const q = queries[idx];
    return {
      canonical,
      bundle: q?.data?.bundle ?? null,
      questionnaire: q?.data?.questionnaire ?? null,
      questionnaireResponse: q?.data?.questionnaireResponse ?? null,
      contentServerUrl: q?.data?.contentServerUrl ?? null,
      terminologyServerUrl: q?.data?.terminologyServerUrl ?? null,
      isLoading: q?.isLoading ?? false,
      isError: q?.isError ?? false,
      error: q?.error,
    };
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
      const response = await fhirSend(fhirUrl, {
        method,
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(questionnaireResponse),
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

export interface PopulateResult {
  response: QuestionnaireResponse | null;
  issues: OperationOutcome | null;
}

/**
 * Posts an SDC 4.0 $populate Parameters body to the provider's in-process
 * populate endpoint. Everything the engine needs from the payer (Q + Libraries
 * + ValueSets) ships inline as a `packagebundle` parameter — the controller
 * builds an InMemoryFhirRepository over it and routes through ProxyRepository
 * (content/terminology = in-memory; data = local provider FHIR).
 *
 * Body shape:
 *   subject       = Reference("Patient/<id>")
 *   questionnaire = embedded Questionnaire resource
 *   context       = one Parameters.parameter per launchContext (name + content)
 *   packagebundle = embedded Bundle (the inner packagebundle from
 *                   $questionnaire-package — Q, Libraries, ValueSets, draft QR)
 *
 * Returns both the populated QR and any issues OperationOutcome.
 */
export function useProviderPopulate(params: {
  populateUrl?: string;
  questionnaire?: Questionnaire;
  packageBundle?: Bundle;
  subject?: string;
  contexts?: Record<string, string[]>;
  providerFhirUrl?: string;
}) {
  const url = params.populateUrl ?? "/api/dtr/populate";
  const questionnaireKey = params.questionnaire
    ? `${params.questionnaire.url ?? ""}|${params.questionnaire.version ?? ""}`
    : undefined;
  const packageBundleKey = params.packageBundle?.id ?? null;
  return useQuery({
    queryKey: [
      "dtr",
      "provider-populate",
      url,
      questionnaireKey,
      packageBundleKey,
      params.subject,
      params.contexts,
      params.providerFhirUrl,
    ],
    enabled: Boolean(
      params.questionnaire && params.packageBundle && params.subject,
    ),
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PopulateResult> => {
      const contextEntries = Object.entries(params.contexts ?? {})
        .filter(([, refs]) => refs.length > 0)
        .map(([name, refs]) => ({
          name: "context",
          part: [
            { name: "name", valueString: name },
            ...refs.map((ref) => ({
              name: "content",
              valueReference: { reference: ref },
            })),
          ],
        }));
      const body = {
        resourceType: "Parameters",
        parameter: [
          { name: "subject", valueReference: { reference: params.subject } },
          { name: "questionnaire", resource: params.questionnaire },
          { name: "packagebundle", resource: params.packageBundle },
          ...contextEntries,
        ],
      };

      const res = await loggedFetch(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/fhir+json" },
          body: JSON.stringify(body),
          credentials: "same-origin",
        },
        { payerUrl: "", operationName: "$populate" },
      );
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const failureOutcome =
          data?.resourceType === "OperationOutcome"
            ? (data as OperationOutcome)
            : null;
        if (failureOutcome) {
          console.error(
            "[$populate] failure OperationOutcome:",
            failureOutcome,
          );
        } else {
          console.error(
            "[$populate] non-2xx with no OperationOutcome",
            res.status,
            data,
          );
        }
        return { response: null, issues: failureOutcome };
      }

      if (data?.resourceType === "Parameters") {
        const responseParam = (data.parameter ?? []).find(
          (p: { name?: string }) => p.name === "response",
        );
        const issuesParam = (data.parameter ?? []).find(
          (p: { name?: string }) => p.name === "issues",
        );
        const issues =
          (issuesParam?.resource as OperationOutcome | undefined) ?? null;
        if (issues?.issue?.length) {
          console.warn("[$populate] issues:", issues);
        }
        return {
          response: (responseParam?.resource as QuestionnaireResponse) ?? null,
          issues,
        };
      }
      // Tolerate non-conformant servers that return a bare QR.
      if (data?.resourceType === "QuestionnaireResponse") {
        return { response: data as QuestionnaireResponse, issues: null };
      }
      return { response: null, issues: null };
    },
  });
}

const DTR_NEXT_QUESTION_INPUT_PROFILE =
  "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/dtr-next-question-input-parameters";

/**
 * Mutation for adaptive questionnaire $next-question operations.
 * Wraps the QR in a Parameters resource per the DTR IG and unwraps
 * the Parameters response to extract the returned QR.
 */
export function useNextQuestion(payerFhirUrl: string) {
  return useMutation({
    mutationFn: async (
      questionnaireResponse: QuestionnaireResponse,
    ): Promise<QuestionnaireResponse> => {
      // Wrap QR in Parameters per DTR IG
      const parametersRequest = {
        resourceType: "Parameters",
        meta: { profile: [DTR_NEXT_QUESTION_INPUT_PROFILE] },
        parameter: [
          { name: "questionnaire-response", resource: questionnaireResponse },
        ],
      };

      const response = await loggedFetch(
        fhirProxyUrl(`${payerFhirUrl}/Questionnaire/$next-question`, {
          payer: true,
          op: "dtr",
        }),
        {
          method: "POST",
          headers: { "Content-Type": "application/fhir+json" },
          body: JSON.stringify(parametersRequest),
        },
        { payerUrl: payerFhirUrl, operationName: "$next-question" },
      );

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(
          extractFhirError(errorBody) ??
            `Failed to get next question: ${response.status}`,
        );
      }

      const data = await response.json();
      return extractQrFromNextQuestionResponse(data);
    },
  });
}

/** Unwrap a QR from a $next-question Parameters response. */
function extractQrFromNextQuestionResponse(
  data: unknown,
): QuestionnaireResponse {
  const params = data as {
    resourceType?: string;
    parameter?: Array<{ name?: string; resource?: QuestionnaireResponse }>;
  };

  if (params.resourceType === "Parameters" && params.parameter) {
    for (const param of params.parameter) {
      if (
        (param.name === "questionnaire-response" || param.name === "return") &&
        param.resource?.resourceType === "QuestionnaireResponse"
      ) {
        return param.resource;
      }
    }
  }

  // Fallback: raw QR (some servers may not wrap in Parameters)
  if (
    (data as QuestionnaireResponse).resourceType === "QuestionnaireResponse"
  ) {
    return data as QuestionnaireResponse;
  }

  throw new Error("No QuestionnaireResponse found in $next-question response");
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
  // Fetch coverage and order in parallel since they are independent
  const [coverage, order] = await Promise.all([
    params.coverageRef
      ? fetchProviderResource(params.providerFhirUrl, params.coverageRef)
      : null,
    params.orderRef
      ? fetchProviderResource(params.providerFhirUrl, params.orderRef)
      : null,
  ]);

  return {
    resourceType: "Parameters",
    parameter: buildPackageParameterList(coverage, order, params),
  };
}

/**
 * Selects the $questionnaire-package input parameters. questionnaire, context,
 * and order are alternative questionnaire-discovery mechanisms: the payer
 * resolves a package bundle per questionnaire found via each provided input and
 * returns one bundle per resolved questionnaire. Sending more than one selector
 * therefore yields redundant (and possibly mismatched) bundles, so send only
 * the most specific selector available: an explicit questionnaire canonical
 * wins over a context trace id, which in turn wins over order-based discovery.
 * Coverage is always included (the operation requires it).
 */
export function buildPackageParameterList(
  coverage: unknown | null,
  order: unknown | null,
  params: Pick<
    QuestionnairePackageParams,
    "questionnaire" | "coverageAssertionId"
  >,
): Record<string, unknown>[] {
  const parameterList: Record<string, unknown>[] = [];

  if (coverage) {
    parameterList.push({ name: "coverage", resource: coverage });
  }

  if ((params.questionnaire?.length ?? 0) > 0) {
    for (const canonical of params.questionnaire ?? []) {
      parameterList.push({ name: "questionnaire", valueCanonical: canonical });
    }
  } else if (params.coverageAssertionId) {
    parameterList.push({
      name: "context",
      valueString: params.coverageAssertionId,
    });
  } else if (order) {
    parameterList.push({ name: "order", resource: order });
  }

  return parameterList;
}

/**
 * Fetches a FHIR resource from the provider server via the BFF proxy.
 * Returns null if the resource is not found.
 */
async function fetchProviderResource(
  providerFhirUrl: string,
  ref: string,
): Promise<unknown | null> {
  const res = await fhirSend(`${providerFhirUrl}/${ref}`);
  if (!res.ok) return null;
  return res.json();
}

// -- Response parsing --

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
    for (const param of obj.parameter as ParametersParameter[]) {
      if (param.name === "packagebundle" && param.resource) {
        scanBundle(param.resource as Bundle);
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
