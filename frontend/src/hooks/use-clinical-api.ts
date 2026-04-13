import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  Bundle,
  BundleEntry,
  Claim,
  ClaimResponse,
  Condition,
  Encounter,
  MedicationRequest,
  Organization,
  Patient,
  QuestionnaireResponse,
} from "fhir/r4";
import { useMemo } from "react";
import { fhirProxyUrl } from "@/lib/api";
import {
  type buildDraftSaveTransactionBundle,
  type buildSignedOrdersTransactionBundle,
  extractTransactionOrderIds,
} from "@/lib/draft-orders";
import {
  ENCOUNTER_ORDER_TYPES,
  isOrderResourceType,
  ORDER_TYPES,
  type OrderEntry,
  type OrderResource,
} from "@/lib/order-types";
import { resolvePasOrderLink } from "@/lib/pas-utils";
import { useDtrQuestionnaireResponseIds } from "./use-dtr-qr-store";
import { fhirFetch } from "./use-fhir-api";
import { useFhirServer } from "./use-fhir-server";

interface PatientSearchParams {
  family?: string;
  given?: string;
  birthdate?: string;
  identifier?: string;
}

export function usePatientSearch(
  params: PatientSearchParams,
  pageUrl?: string,
) {
  const { serverUrl } = useFhirServer();

  const searchParams = new URLSearchParams();
  searchParams.set("_count", "50");
  searchParams.set("_sort", "-_lastUpdated");

  if (params.family) searchParams.set("family", params.family);
  if (params.given) searchParams.set("given", params.given);
  if (params.birthdate) searchParams.set("birthdate", params.birthdate);
  if (params.identifier) searchParams.set("identifier", params.identifier);

  const hasSearchParams = !!(
    params.family ||
    params.given ||
    params.birthdate ||
    params.identifier
  );
  const url = pageUrl || `${serverUrl}/Patient?${searchParams.toString()}`;

  return useQuery({
    queryKey: ["fhir", "Patient", "search", serverUrl, params, url],
    queryFn: () => fhirFetch<Bundle<Patient>>(url),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && (hasSearchParams || !!pageUrl),
  });
}

export function usePatientList(pageUrl?: string) {
  const { serverUrl } = useFhirServer();
  const url =
    pageUrl ||
    `${serverUrl}/Patient?_count=20&_sort=-_lastUpdated&_total=accurate`;

  return useQuery({
    queryKey: ["fhir", "Patient", "list", url],
    queryFn: () => fhirFetch<Bundle<Patient>>(url),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl,
  });
}

export function usePatient(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Patient", patientId, serverUrl],
    queryFn: () => fhirFetch<Patient>(`${serverUrl}/Patient/${patientId}`),
    staleTime: 60 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function useCoverage(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Coverage", patientId, serverUrl],
    queryFn: () =>
      fhirFetch<Bundle>(
        `${serverUrl}/Coverage?beneficiary=Patient/${patientId}&_count=10`,
      ),
    staleTime: 60 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function useOrganization(orgId: string | undefined) {
  const { serverUrl } = useFhirServer();
  return useQuery({
    queryKey: ["fhir", "Organization", orgId, serverUrl],
    queryFn: () =>
      orgId
        ? fhirFetch<Organization>(`${serverUrl}/Organization/${orgId}`)
        : Promise.resolve(undefined),
    enabled: !!serverUrl && !!orgId,
    staleTime: 60 * 1000,
    retry: 1,
  });
}

export function useConditions(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Condition", patientId, serverUrl],
    queryFn: () =>
      fhirFetch<Bundle<Condition>>(
        `${serverUrl}/Condition?patient=${patientId}&_sort=-recorded-date&_count=50`,
      ),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function useMedicationRequests(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "MedicationRequest", patientId, serverUrl],
    queryFn: () =>
      fhirFetch<Bundle<MedicationRequest>>(
        `${serverUrl}/MedicationRequest?patient=${patientId}&_sort=-authoredon&_count=50`,
      ),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function useConditionCount(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Condition", "count", patientId, serverUrl],
    queryFn: () =>
      fhirFetch<Bundle>(
        `${serverUrl}/Condition?patient=${patientId}&clinical-status=active&_summary=count`,
      ),
    staleTime: 60 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function useMedicationRequestCount(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "MedicationRequest", "count", patientId, serverUrl],
    queryFn: () =>
      fhirFetch<Bundle>(
        `${serverUrl}/MedicationRequest?patient=${patientId}&status=active&_summary=count`,
      ),
    staleTime: 60 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

/**
 * Gets total orders count (ServiceRequest, MedicationRequest, DeviceRequest, NutritionOrder) for a patient via FHIR batch.
 */
export function useOrderCount(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "OrderCount", patientId, serverUrl],
    queryFn: () => {
      const batchBundle = {
        resourceType: "Bundle",
        type: "batch",
        entry: [
          {
            request: {
              method: "GET",
              url: `ServiceRequest?patient=${patientId}&_summary=count`,
            },
          },
          {
            request: {
              method: "GET",
              url: `MedicationRequest?patient=${patientId}&_summary=count`,
            },
          },
          {
            request: {
              method: "GET",
              url: `DeviceRequest?patient=${patientId}&_summary=count`,
            },
          },
          {
            request: {
              method: "GET",
              url: `NutritionOrder?patient=${patientId}&_summary=count`,
            },
          },
        ],
      };
      const proxyUrl = fhirProxyUrl(serverUrl);
      return fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(batchBundle),
        credentials: "include",
      })
        .then((response) => response.json())
        .then((bundle) => {
          const total = (bundle.entry || []).reduce(
            (sum: number, entry: BundleEntry) => {
              const entryBundle = entry.resource as Bundle;
              return sum + (entryBundle.total ?? 0);
            },
            0,
          );
          return { total };
        });
    },
    staleTime: 60 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

function extractOrdersFromBatchResponse(bundle: Bundle): OrderEntry[] {
  const orders: OrderEntry[] = [];
  for (const entry of bundle.entry || []) {
    const innerBundle = entry.resource as Bundle;
    for (const innerEntry of innerBundle?.entry || []) {
      const resource = innerEntry.resource;
      if (resource && isOrderResourceType(resource.resourceType)) {
        orders.push({
          resource: resource as OrderResource,
          resourceType: resource.resourceType,
        });
      }
    }
  }
  return orders;
}

/**
 * Batch-fetches all 6 CRD order resource types for a patient,
 * returning a unified list with type metadata.
 */
export function useOrders(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Orders", patientId, serverUrl],
    queryFn: async () => {
      const batchBundle = {
        resourceType: "Bundle",
        type: "batch",
        entry: ORDER_TYPES.map((type) => ({
          request: {
            method: "GET",
            url: `${type}?patient=${patientId}&_sort=-_lastUpdated&_count=50`,
          },
        })),
      };
      const proxyUrl = fhirProxyUrl(serverUrl);
      const response = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(batchBundle),
        credentials: "include",
      });
      const bundle = (await response.json()) as Bundle;
      return extractOrdersFromBatchResponse(bundle);
    },
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function invalidateOrderQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["fhir", "Orders"] });
  queryClient.invalidateQueries({ queryKey: ["fhir", "DraftOrders"] });
  queryClient.invalidateQueries({ queryKey: ["fhir", "OrderCount"] });
}

function onEncounterMutationSuccess(
  queryClient: QueryClient,
  serverUrl: string | null,
  updated: Encounter,
) {
  queryClient.setQueryData(
    ["fhir", "Encounter", updated.id, serverUrl],
    updated,
  );
  const patientId = updated.subject?.reference?.replace(/^Patient\//, "");
  if (patientId) {
    queryClient.invalidateQueries({
      queryKey: ["fhir", "Encounter", "list", patientId, serverUrl],
    });
  }
}

export function useSaveOrders() {
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      bundle: ReturnType<typeof buildSignedOrdersTransactionBundle>,
    ) => {
      if (!serverUrl) {
        throw new Error("No provider FHIR server selected.");
      }

      const proxyUrl = fhirProxyUrl(serverUrl);
      const response = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/fhir+json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(bundle),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Failed to save orders: ${response.status}`);
      }

      const transactionResponse = (await response.json()) as Bundle;
      return extractTransactionOrderIds(transactionResponse.entry);
    },
    onSuccess: () => invalidateOrderQueries(queryClient),
  });
}

/**
 * Marks an encounter as finished by setting status and period.end.
 */
export function useFinishEncounter() {
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (encounter: Encounter) => {
      const finished: Encounter = {
        ...encounter,
        status: "finished",
        period: {
          ...encounter.period,
          end: encounter.period?.end ?? new Date().toISOString(),
        },
      };

      const proxyUrl = fhirProxyUrl(`${serverUrl}/Encounter/${encounter.id}`);

      const response = await fetch(proxyUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(finished),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Failed to finish encounter: ${response.status}`);
      }

      return (await response.json()) as Encounter;
    },
    onSuccess: (updated) =>
      onEncounterMutationSuccess(queryClient, serverUrl, updated),
  });
}

export function useEncounter(encounterId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Encounter", encounterId, serverUrl],
    queryFn: () =>
      fhirFetch<Encounter>(`${serverUrl}/Encounter/${encounterId}`),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!encounterId,
  });
}

export function useUpdateEncounter() {
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (encounter: Encounter) => {
      const proxyUrl = fhirProxyUrl(`${serverUrl}/Encounter/${encounter.id}`);
      const response = await fetch(proxyUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(encounter),
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Failed to update encounter: ${response.status}`);
      }
      return (await response.json()) as Encounter;
    },
    onSuccess: (updated) =>
      onEncounterMutationSuccess(queryClient, serverUrl, updated),
  });
}

async function fetchOrderBatch(
  serverUrl: string,
  types: readonly string[],
  queryParams: string,
): Promise<OrderEntry[]> {
  const batchBundle = {
    resourceType: "Bundle",
    type: "batch",
    entry: types.map((type) => ({
      request: { method: "GET", url: `${type}?${queryParams}&_count=50` },
    })),
  };
  const proxyUrl = fhirProxyUrl(serverUrl);
  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/fhir+json" },
    body: JSON.stringify(batchBundle),
    credentials: "include",
  });
  return extractOrdersFromBatchResponse((await response.json()) as Bundle);
}

export function useEncounterOrders(encounterId: string, patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Orders", "encounter", encounterId, serverUrl],
    queryFn: () =>
      fetchOrderBatch(
        serverUrl,
        ENCOUNTER_ORDER_TYPES,
        `patient=${patientId}&encounter=Encounter/${encounterId}`,
      ),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!encounterId && !!patientId,
  });
}

export function useDraftOrders(encounterId: string, patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "DraftOrders", encounterId, serverUrl],
    queryFn: () =>
      fetchOrderBatch(
        serverUrl,
        ENCOUNTER_ORDER_TYPES,
        `patient=${patientId}&encounter=Encounter/${encounterId}&status=draft`,
      ),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!encounterId && !!patientId,
  });
}

export function useSaveDraftOrders() {
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      bundle: ReturnType<typeof buildDraftSaveTransactionBundle>,
    ) => {
      if (!serverUrl) {
        throw new Error("No provider FHIR server selected.");
      }
      const proxyUrl = fhirProxyUrl(serverUrl);
      const response = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/fhir+json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(bundle),
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Failed to save draft orders: ${response.status}`);
      }
      const txResponse = (await response.json()) as Bundle;
      return extractTransactionOrderIds(txResponse.entry);
    },
    onSuccess: () => invalidateOrderQueries(queryClient),
  });
}

export function useDeleteDraftOrder() {
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      resourceType,
      id,
    }: {
      resourceType: string;
      id: string;
    }) => {
      const proxyUrl = fhirProxyUrl(`${serverUrl}/${resourceType}/${id}`);
      const response = await fetch(proxyUrl, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Failed to delete draft order: ${response.status}`);
      }
    },
    onSuccess: () => invalidateOrderQueries(queryClient),
  });
}

export function useClaimResponses(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "ClaimResponse", patientId, serverUrl],
    queryFn: () =>
      fhirFetch<Bundle>(
        `${serverUrl}/ClaimResponse?patient=${patientId}&_include=ClaimResponse:request&_sort=-_lastUpdated&_count=20`,
      ),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

/**
 * Query QuestionnaireResponses linked to a specific order.
 *
 * The bundled HAPI server does not support `QuestionnaireResponse?context=`
 * for the DTR qr-context extension out of the box, so this hook uses:
 * - `based-on=` for ServiceRequest-backed DTR launches
 * - localStorage-backed QR ids for all order types
 */
export function useOrderQuestionnaireResponses(
  orderRef: string | undefined,
  patientId: string | undefined,
) {
  const { serverUrl } = useFhirServer();
  const localQrIds = useDtrQuestionnaireResponseIds(orderRef);

  return useQuery({
    queryKey: [
      "fhir",
      "QuestionnaireResponse",
      "order",
      orderRef,
      patientId,
      serverUrl,
      localQrIds,
    ],
    queryFn: async () => {
      const questionnairesById = new Map<string, QuestionnaireResponse>();

      if (orderRef?.startsWith("ServiceRequest/")) {
        const params = new URLSearchParams({
          patient: patientId ?? "",
          "based-on": orderRef,
          _sort: "-_lastUpdated",
          _count: "10",
        });

        try {
          const bundle = await fhirFetch<Bundle<QuestionnaireResponse>>(
            `${serverUrl}/QuestionnaireResponse?${params.toString()}`,
          );
          for (const entry of bundle.entry ?? []) {
            const resource = entry.resource;
            if (resource?.id) {
              questionnairesById.set(resource.id, resource);
            }
          }
        } catch {
          // Ignore unsupported/empty search failures; local QR ids remain the
          // primary order-scoped lookup path for non-ServiceRequest orders.
        }
      }

      const localResults = await Promise.allSettled(
        localQrIds.map((id) =>
          fhirFetch<QuestionnaireResponse>(
            `${serverUrl}/QuestionnaireResponse/${id}`,
          ),
        ),
      );

      for (const result of localResults) {
        if (result.status !== "fulfilled") continue;
        const qr = result.value;
        if (!qr.id) continue;
        questionnairesById.set(qr.id, qr);
      }

      const entries = [...questionnairesById.values()]
        .sort((a, b) => {
          const aDate = a.authored ?? a.meta?.lastUpdated ?? "";
          const bDate = b.authored ?? b.meta?.lastUpdated ?? "";
          return aDate < bDate ? 1 : aDate > bDate ? -1 : 0;
        })
        .map((resource) => ({ resource }));

      return {
        resourceType: "Bundle" as const,
        type: "searchset" as const,
        total: entries.length,
        entry: entries,
      } satisfies Bundle<QuestionnaireResponse>;
    },
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!orderRef && !!patientId,
  });
}

export function useEncounterQuestionnaireResponses(encounterId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: [
      "fhir",
      "QuestionnaireResponse",
      "encounter",
      encounterId,
      serverUrl,
    ],
    queryFn: () =>
      fhirFetch<Bundle<QuestionnaireResponse>>(
        `${serverUrl}/QuestionnaireResponse?encounter=Encounter/${encounterId}&_sort=-_lastUpdated&_count=50`,
      ),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!encounterId,
  });
}

export function usePatientQuestionnaireResponses(
  patientId: string,
  status?: "completed" | "in-progress",
) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: [
      "fhir",
      "QuestionnaireResponse",
      "patient",
      patientId,
      status ?? "any",
      serverUrl,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        patient: patientId,
        _sort: "-_lastUpdated",
        _count: "50",
      });
      if (status) params.set("status", status);
      return fhirFetch<Bundle<QuestionnaireResponse>>(
        `${serverUrl}/QuestionnaireResponse?${params.toString()}`,
      );
    },
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function useEncounters(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Encounter", "list", patientId, serverUrl],
    queryFn: () =>
      fhirFetch<Bundle<Encounter>>(
        `${serverUrl}/Encounter?patient=${patientId}&_sort=-date&_count=20`,
      ),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export interface OrderPaStatus {
  outcome: string;
  disposition?: string;
  preAuthRef?: string;
  claimResponseId: string;
  orderId: string;
  orderType: string;
  coverageId?: string;
  created?: string;
}

/**
 * Returns a Map<resourceType/id, OrderPaStatus> for all orders with PA submissions.
 * Derives status from ClaimResponse data already fetched by useClaimResponses.
 */
export function useOrderPaStatusMap(patientId: string) {
  const { data: claimResponseBundle } = useClaimResponses(patientId);

  return useMemo(() => {
    const statusMap = new Map<string, OrderPaStatus>();
    if (!claimResponseBundle?.entry) return statusMap;

    const claimsById = new Map<string, Claim>();
    for (const entry of claimResponseBundle.entry) {
      if (entry.resource?.resourceType === "Claim" && entry.resource.id) {
        claimsById.set(entry.resource.id, entry.resource as Claim);
      }
    }

    for (const entry of claimResponseBundle.entry) {
      if (entry.resource?.resourceType !== "ClaimResponse") continue;
      const cr = entry.resource as ClaimResponse;
      if (!cr.id) continue;
      const link = resolvePasOrderLink(cr, claimsById);
      if (!link) continue;
      const orderKey = `${link.orderType}/${link.orderId}`;

      const existing = statusMap.get(orderKey);
      if (
        !existing ||
        (cr.created && existing.created && cr.created > existing.created)
      ) {
        statusMap.set(orderKey, {
          outcome: cr.outcome ?? "queued",
          disposition: cr.disposition,
          preAuthRef: cr.preAuthRef,
          claimResponseId: cr.id,
          orderId: link.orderId,
          orderType: link.orderType,
          coverageId: link.coverageId,
          created: cr.created,
        });
      }
    }

    return statusMap;
  }, [claimResponseBundle]);
}
