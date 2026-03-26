import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Bundle,
  BundleEntry,
  CommunicationRequest,
  Condition,
  DeviceRequest,
  Encounter,
  MedicationRequest,
  NutritionOrder,
  Organization,
  Patient,
  Resource,
  ServiceRequest,
  VisionPrescription,
} from "fhir/r4";
import type { OrderResourceType } from "@/lib/cds-types";
import {
  type buildSignedOrdersTransactionBundle,
  extractTransactionOrderIds,
} from "@/lib/draft-orders";
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
      const proxyUrl = `/api/fhir-proxy?${new URLSearchParams({ url: serverUrl })}`;
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
              const entryBundle = entry.resource as { total?: number };
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

export type OrderResource =
  | ServiceRequest
  | MedicationRequest
  | DeviceRequest
  | NutritionOrder
  | VisionPrescription
  | CommunicationRequest;

export interface OrderEntry {
  resource: OrderResource;
  resourceType: string;
}

const ORDER_TYPES: readonly OrderResourceType[] = [
  "ServiceRequest",
  "MedicationRequest",
  "DeviceRequest",
  "NutritionOrder",
  "VisionPrescription",
  "CommunicationRequest",
] as const satisfies readonly OrderResourceType[];

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
      const proxyUrl = `/api/fhir-proxy?${new URLSearchParams({ url: serverUrl })}`;
      const response = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(batchBundle),
        credentials: "include",
      });
      const bundle = (await response.json()) as Bundle;

      const orders: OrderEntry[] = [];
      for (const entry of bundle.entry || []) {
        const innerBundle = entry.resource as Bundle;
        for (const innerEntry of innerBundle?.entry || []) {
          if (innerEntry.resource) {
            orders.push({
              resource: innerEntry.resource as OrderResource,
              resourceType: (innerEntry.resource as Resource).resourceType,
            });
          }
        }
      }
      return orders;
    },
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function useSaveOrders(patientId: string) {
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      bundle: ReturnType<typeof buildSignedOrdersTransactionBundle>,
    ) => {
      if (!serverUrl) {
        throw new Error("No provider FHIR server selected.");
      }

      const proxyUrl = `/api/fhir-proxy?${new URLSearchParams({ url: serverUrl })}`;
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
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["fhir", "Orders", patientId],
      });
      queryClient.invalidateQueries({
        queryKey: ["fhir", "OrderCount", patientId],
      });
    },
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
