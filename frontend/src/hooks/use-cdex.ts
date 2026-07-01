import { useMutation } from "@tanstack/react-query";
import type {
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
  patientIdFromTask,
  providerIdentifier,
  resolvePayerUrl,
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
      const parameters = buildSubmitAttachmentParameters(
        task,
        memberIdentifier(patient, patientId),
        providerIdentifier(params.providerNpi),
        contents,
      );

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
