import type { Claim, ClaimResponse } from "fhir/r4";
import { isOrderResourceType, type OrderResourceType } from "./order-types";

const REQUESTED_SERVICE_EXTENSION_URL =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-requestedService";

interface ParsedReference {
  resourceType: string;
  id: string;
}

export interface PasOrderLink {
  orderId: string;
  orderType: OrderResourceType;
  coverageId?: string;
}

function parseReference(reference?: string): ParsedReference | null {
  if (!reference) {
    return null;
  }

  const parts = reference.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  return {
    resourceType: parts.at(-2) ?? "",
    id: parts.at(-1) ?? "",
  };
}

function getRequestedServiceReference(claim?: Claim): string | undefined {
  for (const item of claim?.item ?? []) {
    for (const extension of item.extension ?? []) {
      if (extension.url === REQUESTED_SERVICE_EXTENSION_URL) {
        return extension.valueReference?.reference;
      }
    }
  }

  return undefined;
}

function getCoverageReference(
  claimResponse: ClaimResponse,
  claim?: Claim,
): string | undefined {
  return (
    claimResponse.insurance?.[0]?.coverage?.reference ??
    claim?.insurance?.[0]?.coverage?.reference
  );
}

export function resolvePasOrderLink(
  claimResponse: ClaimResponse,
  claimsById: ReadonlyMap<string, Claim>,
): PasOrderLink | null {
  const requestRef = parseReference(claimResponse.request?.reference);
  const claim =
    requestRef?.resourceType === "Claim"
      ? claimsById.get(requestRef.id)
      : undefined;
  const orderRef = parseReference(getRequestedServiceReference(claim));

  if (!orderRef || !isOrderResourceType(orderRef.resourceType)) {
    return null;
  }

  const coverageRef = parseReference(
    getCoverageReference(claimResponse, claim),
  );

  return {
    orderId: orderRef.id,
    orderType: orderRef.resourceType,
    coverageId:
      coverageRef?.resourceType === "Coverage" ? coverageRef.id : undefined,
  };
}
