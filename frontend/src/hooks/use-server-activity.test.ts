import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { invalidatePasDecisionQueries } from "./use-server-activity";

function isInvalidated(queryClient: QueryClient, queryKey: unknown[]): boolean {
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  if (!query) throw new Error(`query not found: ${JSON.stringify(queryKey)}`);
  return query.state.isInvalidated;
}

describe("invalidatePasDecisionQueries", () => {
  it("invalidates PA-related queries and leaves unrelated queries alone", () => {
    const queryClient = new QueryClient();
    const paKeys: unknown[][] = [
      ["pas", "order-claimresponse", "http://ehr/fhir", "trk-1"],
      ["pas", "all-tasks", "http://ehr/fhir"],
      ["fhir", "ClaimResponse", "trk-1", "http://ehr/fhir"],
      ["fhir", "ClaimResponse", "patient", "http://ehr/fhir", "pat014"],
      ["fhir", "Task", "pa", "http://ehr/fhir", "pat014"],
    ];
    const unrelatedKeys: unknown[][] = [
      ["fhir", "Patient", "pat014", "http://ehr/fhir"],
      ["auth", "session"],
    ];
    for (const queryKey of [...paKeys, ...unrelatedKeys]) {
      queryClient.setQueryData(queryKey, {});
    }

    invalidatePasDecisionQueries(queryClient);

    for (const queryKey of paKeys) {
      expect(
        isInvalidated(queryClient, queryKey),
        JSON.stringify(queryKey),
      ).toBe(true);
    }
    for (const queryKey of unrelatedKeys) {
      expect(
        isInvalidated(queryClient, queryKey),
        JSON.stringify(queryKey),
      ).toBe(false);
    }
  });
});
