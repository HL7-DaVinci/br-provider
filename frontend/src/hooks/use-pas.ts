import { useMutation, useQuery } from "@tanstack/react-query";
import type { ClaimResponse } from "fhir/r4";

export interface PasSubmitParams {
  patientId: string;
  orderId: string;
  orderType: string;
  coverageId: string;
  questionnaireResponseIds: string[];
  payerFhirUrl: string;
}

/**
 * Mutation hook for submitting a prior authorization request via the PAS proxy.
 * Sends patient/order/coverage context to the backend, which assembles the PAS
 * bundle and relays it to the payer's Claim/$submit endpoint.
 */
export function usePasSubmit() {
  return useMutation({
    mutationFn: async (params: PasSubmitParams) => {
      const response = await fetch("/api/pas/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        credentials: "same-origin",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `PAS submit failed: ${response.status}`);
      }
      return response.json();
    },
  });
}

export interface PasInquiryParams {
  claimResponseId: string;
  payerFhirUrl: string;
}

/**
 * Query hook that polls the payer for an updated ClaimResponse status.
 * Enabled only when a claimResponseId is provided; polls every 30 seconds
 * to detect resolution of pended prior authorization requests.
 */
export function usePasInquiry(params: PasInquiryParams | undefined) {
  return useQuery({
    queryKey: ["pas", "inquiry", params?.claimResponseId],
    queryFn: async () => {
      const response = await fetch("/api/pas/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        credentials: "same-origin",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.error ?? `PAS inquiry failed: ${response.status}`,
        );
      }
      return response.json();
    },
    enabled: !!params?.claimResponseId,
    refetchInterval: (query) => {
      const latest = query.state.data as ClaimResponse | undefined;
      if (
        latest &&
        latest.outcome !== "queued" &&
        latest.outcome !== "partial"
      ) {
        return false;
      }
      return params?.claimResponseId ? 30_000 : false;
    },
  });
}
