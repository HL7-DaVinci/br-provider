import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Encounter } from "fhir/r4";
import { useCallback, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useFhirServer } from "@/hooks/use-fhir-server";
import { fhirProxyUrl } from "@/lib/api";

export function useCreateEncounter(patientId: string) {
  const { serverUrl } = useFhirServer();
  const { fhirUser } = useAuth();
  const practitionerId = fhirUser?.replace(/^Practitioner\//, "") ?? "";
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);
  const createGuard = useRef(false);

  const createEncounter = useCallback(async () => {
    if (createGuard.current || !serverUrl) return;
    createGuard.current = true;
    setIsCreating(true);

    try {
      const encounter: Partial<Encounter> = {
        resourceType: "Encounter",
        status: "in-progress",
        class: {
          system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
          code: "AMB",
          display: "ambulatory",
        },
        subject: { reference: `Patient/${patientId}` },
        participant: practitionerId
          ? [{ individual: { reference: `Practitioner/${practitionerId}` } }]
          : [],
        period: { start: new Date().toISOString() },
      };

      const response = await fetch(fhirProxyUrl(`${serverUrl}/Encounter`), {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(encounter),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Failed to create encounter: ${response.status}`);
      }

      const created = (await response.json()) as Encounter;
      queryClient.invalidateQueries({
        queryKey: ["fhir", "Encounter", "list", patientId, serverUrl],
      });
      navigate({
        to: "/patients/$patientId/encounter/$encounterId",
        params: { patientId, encounterId: created.id ?? "" },
      });
    } finally {
      createGuard.current = false;
      setIsCreating(false);
    }
  }, [serverUrl, patientId, practitionerId, navigate, queryClient]);

  return { createEncounter, isCreating };
}
