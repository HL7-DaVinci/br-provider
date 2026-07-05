import { useMutation } from "@tanstack/react-query";
import type {
  Bundle,
  Coverage,
  DocumentReference,
  FhirResource,
  OperationOutcome,
  Patient,
  QuestionnaireResponse,
  Task,
} from "fhir/r4";
import { fhirProxyUrl } from "@/lib/api";
import {
  buildSubmitAttachmentParameters,
  memberIdentifier,
  organizationIdentifier,
  patientIdFromTask,
  providerIdentifier,
  resolvePayerUrl,
  taskLineItems,
} from "@/lib/cdex-submit-attachment-builder";
import { extractFhirError } from "@/lib/fhir-types";
import { loggedFetch } from "@/lib/logged-fetch";
import { fhirFetch } from "./use-fhir-api";

export interface SubmitAttachmentParams {
  task?: Task;
  taskId?: string;
  payerFhirUrl: string;
  providerFhirUrl: string;
  questionnaireResponseIds?: string[];
  documentReferenceIds?: string[];
  providerNpi?: string;
  /**
   * The provider-side Coverage the prior authorization was submitted under.
   * Names the exact member/payer for MemberId; without it the first active
   * Coverage is used, which can pick the wrong plan for multi-coverage patients.
   */
  coverageId?: string;
  /** Whether this submission closes the last open documentation Task for the order. */
  final: boolean;
}

/**
 * Submits attachments for a documentation Task via the CDex $submit-attachment operation.
 * The SPA reads the Task + content from the provider FHIR server, assembles the
 * cdex-parameters-submit-attachment Parameters, and relays it to the payer through the thin
 * FHIR proxy, which injects the payer B2B token. The conformant Parameters is the literal
 * request body, so it is observable in the network drawer.
 */
export function useSubmitAttachment() {
  return useMutation({
    mutationFn: async (
      params: SubmitAttachmentParams,
    ): Promise<OperationOutcome | null> => {
      const { providerFhirUrl } = params;

      let task = params.task;
      if (!task) {
        if (!params.taskId) {
          throw new Error("task or taskId is required");
        }
        task = await fhirFetch<Task>(
          `${providerFhirUrl}/Task/${params.taskId}`,
        );
      }

      const contents: FhirResource[] = [];
      for (const id of params.questionnaireResponseIds ?? []) {
        contents.push(
          await fhirFetch<QuestionnaireResponse>(
            `${providerFhirUrl}/QuestionnaireResponse/${id}`,
          ),
        );
      }
      for (const id of params.documentReferenceIds ?? []) {
        contents.push(
          await fhirFetch<DocumentReference>(
            `${providerFhirUrl}/DocumentReference/${id}`,
          ),
        );
      }
      if (contents.length === 0) {
        throw new Error(
          "At least one questionnaireResponseId or documentReferenceId is required",
        );
      }

      const patientId = patientIdFromTask(task);
      const patient = await fhirFetch<Patient>(
        `${providerFhirUrl}/Patient/${patientId}`,
      );
      // The member id usually lives on the Coverage (subscriberId / MB identifier)
      // rather than as a Patient identifier. The PA's own coverage is exact;
      // the active-coverage search is a fallback for callers without that context.
      let coverage: Coverage | undefined;
      if (params.coverageId) {
        coverage = await fhirFetch<Coverage>(
          `${providerFhirUrl}/Coverage/${params.coverageId}`,
        );
      } else {
        const coverageBundle = await fhirFetch<Bundle>(
          `${providerFhirUrl}/Coverage?beneficiary=Patient/${patientId}&status=active`,
        );
        coverage = coverageBundle.entry?.find(
          (e) => e.resource?.resourceType === "Coverage",
        )?.resource as Coverage | undefined;
      }
      const parameters = buildSubmitAttachmentParameters({
        task,
        memberId: memberIdentifier(patient, coverage),
        organizationId: organizationIdentifier(),
        providerId: providerIdentifier(params.providerNpi),
        contents,
        lineItems: taskLineItems(task),
        final: params.final,
      });

      const submitBase = resolvePayerUrl(task, params.payerFhirUrl);
      const response = await loggedFetch(
        fhirProxyUrl(`${submitBase}/$submit-attachment`, {
          payer: true,
          op: "submit-attachment",
        }),
        {
          method: "POST",
          headers: { "Content-Type": "application/fhir+json" },
          body: JSON.stringify(parameters),
        },
        { payerUrl: submitBase, operationName: "$submit-attachment" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          extractFhirError(body) ??
            `$submit-attachment failed: ${response.status}`,
        );
      }
      return (await response
        .json()
        .catch(() => null)) as OperationOutcome | null;
    },
  });
}
