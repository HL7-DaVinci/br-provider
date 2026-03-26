import type { SelectedOrder } from "@/lib/order-templates";

interface BuildOrderOptions {
  encounterId?: string;
  practitionerId?: string;
  status?: string;
  includeDraftId?: boolean;
}

interface DraftOrderEntry {
  fullUrl: string;
  resource: Record<string, unknown>;
}

interface DraftOrdersBundle {
  resourceType: "Bundle";
  entry: DraftOrderEntry[];
}

interface TransactionResponseEntry {
  resource?: { id?: string };
  response?: { location?: string };
}

function buildOrderResource(
  order: SelectedOrder,
  patientId: string,
  sharedFields: Record<string, unknown>,
  options: BuildOrderOptions = {},
): Record<string, unknown> {
  const { template, customizations } = order;

  const codeableConcept = {
    coding: [
      {
        system: template.codeSystem,
        code: template.code,
        display: template.display,
      },
    ],
    text: template.display,
  };

  const base: Record<string, unknown> = {
    resourceType: template.resourceType,
    status: options.status ?? "draft",
    intent: (sharedFields.intent as string) ?? "order",
    subject: { reference: `Patient/${patientId}` },
  };

  if (options.includeDraftId) {
    base.id = `draft-${order.templateId}`;
  }

  if (options.encounterId) {
    base.encounter = { reference: `Encounter/${options.encounterId}` };
  }

  if (options.practitionerId) {
    base.requester = {
      reference: `Practitioner/${options.practitionerId}`,
    };
  }

  switch (template.resourceType) {
    case "DeviceRequest":
      base.codeCodeableConcept = codeableConcept;
      break;
    default:
      base.code = codeableConcept;
  }

  if (sharedFields.insuranceRef) {
    base.insurance = [{ reference: sharedFields.insuranceRef }];
  }

  if (sharedFields.reasonRef) {
    base.reasonReference = [{ reference: sharedFields.reasonRef }];
  }

  if (sharedFields.priority) {
    base.priority = sharedFields.priority;
  }

  if (sharedFields.note) {
    base.note = [{ text: sharedFields.note }];
  }

  if (customizations.occurrenceDate) {
    base.occurrenceDateTime = customizations.occurrenceDate;
  }

  return base;
}

/**
 * Builds a draft orders Bundle for CDS hook context containing all
 * selected orders as draft FHIR resources, combining template codes
 * with per-order customizations and shared fields.
 */
export function buildDraftOrdersBundle(
  selectedOrders: SelectedOrder[],
  patientId: string,
  sharedFields: Record<string, unknown>,
  options: Omit<BuildOrderOptions, "status" | "includeDraftId"> = {},
): DraftOrdersBundle {
  const entries = selectedOrders.map((order) => ({
    fullUrl: `urn:uuid:draft-${order.templateId}`,
    resource: buildOrderResource(order, patientId, sharedFields, {
      ...options,
      status: "draft",
      includeDraftId: true,
    }),
  }));

  return {
    resourceType: "Bundle",
    entry: entries,
  };
}

/**
 * Builds a FHIR transaction bundle that persists the selected orders to the
 * provider server as signed resources and lets the server assign canonical IDs.
 */
export function buildSignedOrdersTransactionBundle(
  selectedOrders: SelectedOrder[],
  patientId: string,
  sharedFields: Record<string, unknown>,
  options: Omit<BuildOrderOptions, "status" | "includeDraftId"> = {},
) {
  const signedStatus =
    ((sharedFields.intent as string) ?? "order") === "order"
      ? "active"
      : "draft";

  return {
    resourceType: "Bundle" as const,
    type: "transaction" as const,
    entry: selectedOrders.map((order) => ({
      resource: buildOrderResource(order, patientId, sharedFields, {
        ...options,
        status: signedStatus,
        includeDraftId: false,
      }),
      request: {
        method: "POST" as const,
        url: order.template.resourceType,
      },
    })),
  };
}

export function extractTransactionOrderIds(
  entries: TransactionResponseEntry[] | null | undefined,
): string[] {
  if (!entries || entries.length === 0) {
    throw new Error("FHIR transaction response did not include saved orders.");
  }

  return entries.map((entry, index) => {
    const resourceId = entry.resource?.id;
    if (resourceId) {
      return resourceId;
    }

    const location = entry.response?.location;
    if (typeof location === "string") {
      const resourcePath = location.replace(/\/_history\/[^/]+$/, "");
      const segments = resourcePath.split("/").filter(Boolean);
      const id = segments[segments.length - 1];
      if (id) {
        return id;
      }
    }

    throw new Error(
      `FHIR transaction response missing an order id for entry ${index + 1}.`,
    );
  });
}
