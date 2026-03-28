import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { Encounter } from "fhir/r4";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useDeleteDraftOrder,
  useFinishEncounter,
  useSaveDraftOrders,
  useSaveOrders,
} from "./use-clinical-api";

const SERVER_URL = "http://localhost:8080/fhir";

vi.mock("./use-fhir-server", () => ({
  useFhirServer: () => ({
    serverUrl: SERVER_URL,
    server: undefined,
    presetServers: [],
    setServerUrl: vi.fn(),
    isCustomServer: false,
  }),
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useClinicalApi mutations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("syncs the encounter detail cache after finishing an encounter", async () => {
    const queryClient = createQueryClient();
    const wrapper = createWrapper(queryClient);
    const encounter: Encounter = {
      resourceType: "Encounter",
      id: "enc-1",
      status: "in-progress",
      subject: { reference: "Patient/pat-1" },
      period: {
        start: "2026-03-25T10:00:00.000Z",
        end: "2026-03-25T11:00:00.000Z",
      },
      class: {
        system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
        code: "AMB",
      },
    };
    const updatedEncounter: Encounter = {
      ...encounter,
      status: "finished",
    };

    queryClient.setQueryData(
      ["fhir", "Encounter", encounter.id, SERVER_URL],
      encounter,
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => updatedEncounter,
    });
    vi.stubGlobal("fetch", fetchMock);

    const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useFinishEncounter(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(encounter);
    });

    expect(
      queryClient.getQueryData(["fhir", "Encounter", encounter.id, SERVER_URL]),
    ).toEqual(updatedEncounter);
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: ["fhir", "Encounter", "list", "pat-1", SERVER_URL],
    });

    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(request.body as string)).toMatchObject({
      status: "finished",
      period: {
        start: "2026-03-25T10:00:00.000Z",
        end: "2026-03-25T11:00:00.000Z",
      },
    });
  });

  it("invalidates draft-order caches after signing orders", async () => {
    const queryClient = createQueryClient();
    const wrapper = createWrapper(queryClient);

    queryClient.setQueryData(["fhir", "Orders", "pat-1", SERVER_URL], []);
    queryClient.setQueryData(["fhir", "OrderCount", "pat-1", SERVER_URL], 1);
    queryClient.setQueryData(["fhir", "DraftOrders", "enc-1", SERVER_URL], []);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          resourceType: "Bundle",
          entry: [
            {
              resource: {
                resourceType: "ServiceRequest",
                id: "order-1",
              },
            },
          ],
        }),
      }),
    );

    const { result } = renderHook(() => useSaveOrders(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        resourceType: "Bundle",
        type: "transaction",
        entry: [],
      });
    });

    expect(
      queryClient.getQueryState(["fhir", "Orders", "pat-1", SERVER_URL])
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["fhir", "OrderCount", "pat-1", SERVER_URL])
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["fhir", "DraftOrders", "enc-1", SERVER_URL])
        ?.isInvalidated,
    ).toBe(true);
  });

  it("invalidates order counts after saving draft orders", async () => {
    const queryClient = createQueryClient();
    const wrapper = createWrapper(queryClient);

    queryClient.setQueryData(["fhir", "Orders", "pat-1", SERVER_URL], []);
    queryClient.setQueryData(["fhir", "OrderCount", "pat-1", SERVER_URL], 1);
    queryClient.setQueryData(["fhir", "DraftOrders", "enc-1", SERVER_URL], []);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          resourceType: "Bundle",
          entry: [
            {
              resource: {
                resourceType: "ServiceRequest",
                id: "draft-1",
              },
            },
          ],
        }),
      }),
    );

    const { result } = renderHook(() => useSaveDraftOrders(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        resourceType: "Bundle",
        type: "transaction",
        entry: [],
      });
    });

    expect(
      queryClient.getQueryState(["fhir", "Orders", "pat-1", SERVER_URL])
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["fhir", "OrderCount", "pat-1", SERVER_URL])
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["fhir", "DraftOrders", "enc-1", SERVER_URL])
        ?.isInvalidated,
    ).toBe(true);
  });

  it("invalidates order counts after deleting a draft order", async () => {
    const queryClient = createQueryClient();
    const wrapper = createWrapper(queryClient);

    queryClient.setQueryData(["fhir", "Orders", "pat-1", SERVER_URL], []);
    queryClient.setQueryData(["fhir", "OrderCount", "pat-1", SERVER_URL], 1);
    queryClient.setQueryData(["fhir", "DraftOrders", "enc-1", SERVER_URL], []);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
      }),
    );

    const { result } = renderHook(() => useDeleteDraftOrder(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        resourceType: "ServiceRequest",
        id: "draft-1",
      });
    });

    expect(
      queryClient.getQueryState(["fhir", "Orders", "pat-1", SERVER_URL])
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["fhir", "OrderCount", "pat-1", SERVER_URL])
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["fhir", "DraftOrders", "enc-1", SERVER_URL])
        ?.isInvalidated,
    ).toBe(true);
  });
});
