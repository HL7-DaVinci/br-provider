import type { Bundle, BundleEntry, Resource } from "fhir/r4";
import { getAllTemplates, type SelectedOrder } from "@/lib/order-templates";
import {
  getOrderCode,
  getOrderInsuranceReference,
  getOrderIntent,
  getOrderNoteText,
  getOrderOccurrenceDate,
  getOrderPriority,
  getOrderReasonReference,
  isEncounterOrderResource,
  type OrderEntry,
  type OrderResource,
} from "@/lib/order-types";

interface BuildOrderOptions {
  encounterId?: string;
  practitionerId?: string;
  status?: string;
  includeDraftId?: boolean;
  systemActionResources?: Map<string, Resource>;
}

function findMatchingSystemActionResource(
  order: SelectedOrder,
  systemActionResources?: Map<string, Resource>,
): Resource | undefined {
  if (!systemActionResources?.size) {
    return undefined;
  }

  const draftKey = `${order.template.resourceType}/draft-${order.templateId}`;
  const draftMatch = systemActionResources.get(draftKey);
  if (draftMatch) {
    return draftMatch;
  }

  if (order.serverId) {
    const savedMatch = systemActionResources.get(
      `${order.template.resourceType}/${order.serverId}`,
    );
    if (savedMatch) {
      return savedMatch;
    }
  }

  for (const [, resource] of systemActionResources) {
    if (resource.resourceType !== order.template.resourceType) {
      continue;
    }

    const code = getOrderCode(resource as OrderResource)?.coding?.[0]?.code;
    if (code === order.template.code) {
      return resource;
    }
  }

  return undefined;
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

  const actionResource = findMatchingSystemActionResource(
    order,
    options.systemActionResources,
  );

  // Carry forward coverage-information extensions from CDS system action
  // responses. When restoring persisted drafts, fall back to the extensions
  // already stored on the draft order resource.
  if (
    actionResource &&
    "extension" in actionResource &&
    Array.isArray(actionResource.extension) &&
    actionResource.extension.length > 0
  ) {
    base.extension = actionResource.extension;
  } else if (order.persistedExtensions?.length) {
    base.extension = order.persistedExtensions;
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
): Bundle {
  const entries = selectedOrders.map((order) => ({
    fullUrl: `urn:uuid:draft-${order.templateId}`,
    resource: buildOrderResource(order, patientId, sharedFields, {
      ...options,
      status: "draft",
      includeDraftId: true,
    }),
  }));

  return {
    resourceType: "Bundle" as const,
    type: "collection" as const,
    entry: entries as unknown as BundleEntry[],
  };
}

function buildOrderTransactionBundle(
  selectedOrders: SelectedOrder[],
  patientId: string,
  sharedFields: Record<string, unknown>,
  status: string,
  options: Omit<BuildOrderOptions, "status" | "includeDraftId"> = {},
) {
  return {
    resourceType: "Bundle" as const,
    type: "transaction" as const,
    entry: selectedOrders.map((order) => {
      const resource = buildOrderResource(order, patientId, sharedFields, {
        ...options,
        status,
        includeDraftId: false,
      });

      if (order.serverId) {
        resource.id = order.serverId;
        return {
          resource,
          request: {
            method: "PUT" as const,
            url: `${order.template.resourceType}/${order.serverId}`,
          },
        };
      }

      return {
        resource,
        request: {
          method: "POST" as const,
          url: order.template.resourceType,
        },
      };
    }),
  };
}

export function buildOrderIdMap(
  selectedOrders: SelectedOrder[],
  serverIds: string[],
): Map<string, string> {
  const idMap = new Map<string, string>();
  selectedOrders.forEach((order, i) => {
    if (!order.serverId && serverIds[i]) {
      idMap.set(order.templateId, serverIds[i]);
    }
  });
  return idMap;
}

export function buildSignedOrdersTransactionBundle(
  selectedOrders: SelectedOrder[],
  patientId: string,
  sharedFields: Record<string, unknown>,
  options: Omit<BuildOrderOptions, "status" | "includeDraftId"> = {},
) {
  const status =
    ((sharedFields.intent as string) ?? "order") === "order"
      ? "active"
      : "draft";
  return buildOrderTransactionBundle(
    selectedOrders,
    patientId,
    sharedFields,
    status,
    options,
  );
}

export function buildDraftSaveTransactionBundle(
  selectedOrders: SelectedOrder[],
  patientId: string,
  sharedFields: Record<string, unknown>,
  options: Omit<BuildOrderOptions, "status" | "includeDraftId"> = {},
) {
  return buildOrderTransactionBundle(
    selectedOrders,
    patientId,
    sharedFields,
    "draft",
    options,
  );
}

function extractCodeFromResource(resource: OrderResource): string | undefined {
  return getOrderCode(resource)?.coding?.[0]?.code;
}

/**
 * Converts FHIR draft order resources back into SelectedOrder entries
 * by matching resource codes to the template catalog.
 */
export function restoreOrdersFromResources(resources: OrderEntry[]): {
  selectedOrders: SelectedOrder[];
  sharedFields: Record<string, unknown>;
} {
  const allTemplates = getAllTemplates();
  const selectedOrders: SelectedOrder[] = [];
  const sharedFields: Record<string, unknown> = {};
  let sharedExtracted = false;

  for (const entry of resources) {
    if (!isEncounterOrderResource(entry.resource)) continue;

    const r = entry.resource;
    const code = extractCodeFromResource(r);
    if (!code) continue;

    const template = allTemplates.find(
      (t) => t.code === code && t.resourceType === entry.resourceType,
    );
    if (!template) continue;

    const customizations: Record<string, unknown> = {};
    const occurrenceDate = getOrderOccurrenceDate(r);
    if (occurrenceDate) {
      customizations.occurrenceDate = occurrenceDate;
    }

    selectedOrders.push({
      templateId: template.id,
      template,
      customizations,
      expanded: false,
      serverId: r.id as string | undefined,
      persistedExtensions: r.extension,
    });

    if (!sharedExtracted) {
      const insuranceRef = getOrderInsuranceReference(r);
      if (insuranceRef) sharedFields.insuranceRef = insuranceRef;

      const reasonRef = getOrderReasonReference(r);
      if (reasonRef) sharedFields.reasonRef = reasonRef;

      const priority = getOrderPriority(r);
      if (priority) sharedFields.priority = priority;

      const note = getOrderNoteText(r);
      if (note) sharedFields.note = note;

      const intent = getOrderIntent(r);
      if (intent) sharedFields.intent = intent;

      sharedExtracted = true;
    }
  }

  return { selectedOrders, sharedFields };
}

export function extractTransactionOrderIds(
  entries: BundleEntry[] | null | undefined,
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
