import { Link } from "@tanstack/react-router";
import type { DomainResource, Resource } from "fhir/r4";
import { FileText, ShieldCheck } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { useFhirServer } from "@/hooks/use-fhir-server";
import type { CoverageInformation } from "@/lib/cds-types";
import { parseCoverageInfoFromResource } from "@/lib/coverage-extensions";
import type { OrderEntry } from "@/lib/order-types";

interface OrderCoverageActionsProps {
  order: OrderEntry;
  patientId: string;
  encounterId?: string;
}

const hasDtrDoc = (ci: CoverageInformation) =>
  ci.docNeeded &&
  ci.docNeeded !== "no-doc" &&
  (ci.questionnaire?.length ?? 0) > 0;

export function OrderCoverageActions({
  order,
  patientId,
  encounterId,
}: OrderCoverageActionsProps) {
  const { serverUrl: providerFhirUrl } = useFhirServer();
  const [isLaunching, setIsLaunching] = useState(false);

  const resource = order.resource as DomainResource;
  const coverageInfo = parseCoverageInfoFromResource(resource);

  const orderId = (order.resource as Resource).id;
  const needsDoc = coverageInfo.some(hasDtrDoc);
  const needsAuth = coverageInfo.some((ci) => ci.paNeeded === "auth-needed");

  const handleDtrLaunch = useCallback(async () => {
    const ci = coverageInfo.find(hasDtrDoc);
    if (!ci || !orderId) return;

    setIsLaunching(true);
    try {
      const fhirContext = [
        ci.coverage,
        `${order.resourceType}/${orderId}`,
      ].filter(Boolean);

      const response = await fetch("/api/smart/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          encounterId: encounterId ?? null,
          fhirContext,
          coverageAssertionId: ci.coverageAssertionId ?? null,
          questionnaire: ci.questionnaire ?? [],
          providerFhirUrl,
        }),
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error("Failed to create SMART launch context");
      }

      const { launchUrl } = await response.json();
      window.open(
        new URL(launchUrl, window.location.origin).toString(),
        "_blank",
        "noopener",
      );
    } catch (err) {
      console.error("DTR launch failed:", err);
    } finally {
      setIsLaunching(false);
    }
  }, [
    coverageInfo,
    orderId,
    order.resourceType,
    patientId,
    encounterId,
    providerFhirUrl,
  ]);

  if (!needsDoc && !needsAuth) return null;

  const coverageRef = coverageInfo.find((ci) => ci.coverage)?.coverage;
  const coverageId = coverageRef?.replace(/^Coverage\//, "") ?? "";

  return (
    <span className="flex items-center gap-1">
      {needsDoc && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={isLaunching}
          onClick={handleDtrLaunch}
        >
          <FileText className="h-3 w-3 mr-1" />
          DTR
        </Button>
      )}
      {needsAuth && orderId && (
        <Link
          to="/patients/$patientId/orders/$orderId/pas"
          params={{ patientId, orderId }}
          search={{ coverageId, orderType: order.resourceType }}
        >
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
            <ShieldCheck className="h-3 w-3 mr-1" />
            PA
          </Button>
        </Link>
      )}
    </span>
  );
}
