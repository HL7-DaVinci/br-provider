import type { ClaimResponse, Task } from "fhir/r4";
import { describe, expect, it } from "vitest";
import { deriveOrderPaStatuses } from "@/hooks/use-clinical-api";

function paTask(
  orderRef: string,
  trackingId: string,
  overrides: Partial<Task> = {},
): Task {
  return {
    resourceType: "Task",
    status: "in-progress",
    intent: "order",
    authoredOn: "2026-06-28T10:00:00Z",
    focus: { reference: orderRef },
    identifier: [{ value: trackingId }],
    ...overrides,
  };
}

function claimResponse(
  trackingId: string,
  overrides: Partial<ClaimResponse> = {},
): ClaimResponse {
  return {
    resourceType: "ClaimResponse",
    status: "active",
    type: { coding: [{ code: "professional" }] },
    use: "preauthorization",
    patient: { reference: "Patient/p1" },
    outcome: "complete",
    created: "2026-06-28T10:05:00Z",
    insurer: { reference: "Organization/o1" },
    identifier: [{ value: trackingId }],
    preAuthRef: "AUTH-1",
    insurance: [
      { sequence: 1, focal: true, coverage: { reference: "Coverage/cov-1" } },
    ],
    ...overrides,
  };
}

describe("deriveOrderPaStatuses", () => {
  it("joins a Task to its ClaimResponse by tracking identifier", () => {
    const map = deriveOrderPaStatuses(
      [paTask("DeviceRequest/dev-1", "trk-1")],
      [claimResponse("trk-1")],
    );
    const status = map.get("DeviceRequest/dev-1");
    expect(status?.outcome).toBe("complete");
    expect(status?.decision).toBe("approved");
    expect(status?.preAuthRef).toBe("AUTH-1");
    expect(status?.orderId).toBe("dev-1");
    expect(status?.orderType).toBe("DeviceRequest");
    expect(status?.coverageId).toBe("cov-1");
    expect(status?.claimResponseId).toBe("trk-1");
  });

  it("falls back to queued when the ClaimResponse is not yet persisted", () => {
    const map = deriveOrderPaStatuses(
      [paTask("DeviceRequest/dev-1", "trk-1")],
      [],
    );
    expect(map.get("DeviceRequest/dev-1")?.outcome).toBe("queued");
    expect(map.get("DeviceRequest/dev-1")?.decision).toBe("pended");
    expect(map.get("DeviceRequest/dev-1")?.pended).toBe(true);
  });

  it("derives denied from A3 review action codes despite outcome=complete", () => {
    const map = deriveOrderPaStatuses(
      [paTask("DeviceRequest/dev-1", "trk-1")],
      [
        claimResponse("trk-1", {
          item: [
            {
              itemSequence: 1,
              adjudication: [
                {
                  category: { coding: [{ code: "submitted" }] },
                  extension: [
                    {
                      url: "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewAction",
                      extension: [
                        {
                          url: "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewActionCode",
                          valueCodeableConcept: {
                            coding: [
                              {
                                system: "https://codesystem.x12.org/005010/306",
                                code: "A3",
                              },
                            ],
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ],
    );
    const status = map.get("DeviceRequest/dev-1");
    expect(status?.outcome).toBe("complete");
    expect(status?.decision).toBe("denied");
    expect(status?.pended).toBe(false);
  });

  it("keeps two orders independent", () => {
    const map = deriveOrderPaStatuses(
      [
        paTask("DeviceRequest/dev-1", "trk-1"),
        paTask("ServiceRequest/sr-2", "trk-2"),
      ],
      [
        claimResponse("trk-1", { outcome: "complete" }),
        claimResponse("trk-2", { outcome: "error" }),
      ],
    );
    expect(map.get("DeviceRequest/dev-1")?.outcome).toBe("complete");
    expect(map.get("ServiceRequest/sr-2")?.outcome).toBe("error");
  });

  it("uses the latest Task per order", () => {
    const map = deriveOrderPaStatuses(
      [
        paTask("DeviceRequest/dev-1", "trk-old", {
          authoredOn: "2026-06-28T09:00:00Z",
        }),
        paTask("DeviceRequest/dev-1", "trk-new", {
          authoredOn: "2026-06-28T11:00:00Z",
        }),
      ],
      [claimResponse("trk-new", { preAuthRef: "AUTH-NEW" })],
    );
    expect(map.get("DeviceRequest/dev-1")?.preAuthRef).toBe("AUTH-NEW");
  });
});
