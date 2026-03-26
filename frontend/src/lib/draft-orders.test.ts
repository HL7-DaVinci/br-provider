import { describe, expect, it } from "vitest";
import type { SelectedOrder } from "@/lib/order-templates";
import {
  buildDraftOrdersBundle,
  buildSignedOrdersTransactionBundle,
  extractTransactionOrderIds,
} from "./draft-orders";

const selectedOrder: SelectedOrder = {
  templateId: "svc-g0180",
  template: {
    id: "svc-g0180",
    code: "G0180",
    display: "Home Health Certification",
    description: "Physician certification for home health plan of care",
    category: "Services",
    resourceType: "ServiceRequest",
    codeSystem: "http://example.org/codes",
  },
  customizations: {
    occurrenceDate: "2026-03-26",
  },
  expanded: false,
};

describe("draft order helpers", () => {
  it("builds draft orders for CDS hooks with draft ids", () => {
    const bundle = buildDraftOrdersBundle(
      [selectedOrder],
      "patient-1",
      { priority: "urgent" },
      {
        encounterId: "enc-1",
        practitionerId: "prac-1",
      },
    );

    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.entry).toHaveLength(1);
    expect(bundle.entry[0]?.resource).toMatchObject({
      id: "draft-svc-g0180",
      status: "draft",
      subject: { reference: "Patient/patient-1" },
      encounter: { reference: "Encounter/enc-1" },
      requester: { reference: "Practitioner/prac-1" },
      priority: "urgent",
    });
  });

  it("builds a transaction bundle that creates signed orders", () => {
    const bundle = buildSignedOrdersTransactionBundle(
      [selectedOrder],
      "patient-1",
      {
        insuranceRef: "Coverage/cov-1",
        reasonRef: "Condition/cond-1",
        note: "Schedule this week",
      },
      {
        encounterId: "enc-1",
        practitionerId: "prac-1",
      },
    );

    expect(bundle).toMatchObject({
      resourceType: "Bundle",
      type: "transaction",
      entry: [
        {
          request: {
            method: "POST",
            url: "ServiceRequest",
          },
          resource: {
            status: "active",
            subject: { reference: "Patient/patient-1" },
            encounter: { reference: "Encounter/enc-1" },
            requester: { reference: "Practitioner/prac-1" },
            insurance: [{ reference: "Coverage/cov-1" }],
            reasonReference: [{ reference: "Condition/cond-1" }],
            note: [{ text: "Schedule this week" }],
          },
        },
      ],
    });
    expect(bundle.entry[0]?.resource).not.toHaveProperty("id");
  });

  it("extracts saved ids from transaction responses", () => {
    expect(
      extractTransactionOrderIds([
        { resource: { id: "order-1" } },
        {
          response: {
            location:
              "https://provider.example/fhir/ServiceRequest/order-2/_history/1",
          },
        },
      ]),
    ).toEqual(["order-1", "order-2"]);
  });
});
