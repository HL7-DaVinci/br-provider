import type { QuestionnaireResponse } from "fhir/r4";
import { useMemo } from "react";
import {
  type AnswerSnapshot,
  buildOriginIndex,
  mergeQuestionnaireResponses,
  stampOrigins,
} from "@/lib/information-origin";

/**
 * Merges payer and provider QuestionnaireResponses with information-origin
 * tracking. Provider values override payer values for the same linkId.
 *
 * Returns the merged QR (for LHC-Forms pre-population) and an origin index
 * snapshot (for post-export origin diffing).
 */
export function usePrePopulatedQr(params: {
  payerQr: QuestionnaireResponse | null;
  providerQr: QuestionnaireResponse | null;
}): {
  mergedQr: QuestionnaireResponse | null;
  originIndex: Map<string, AnswerSnapshot[]>;
} {
  return useMemo(() => {
    const emptyIndex = new Map<string, AnswerSnapshot[]>();

    if (!params.payerQr && !params.providerQr) {
      return { mergedQr: null, originIndex: emptyIndex };
    }

    const stamped = {
      payer: params.payerQr
        ? stampOrigins(params.payerQr, "auto-server")
        : null,
      provider: params.providerQr
        ? stampOrigins(params.providerQr, "auto-client")
        : null,
    };

    let mergedQr: QuestionnaireResponse;

    if (stamped.payer && stamped.provider) {
      mergedQr = mergeQuestionnaireResponses(stamped.payer, stamped.provider);
    } else if (stamped.payer) {
      mergedQr = stamped.payer;
    } else {
      mergedQr = stamped.provider as QuestionnaireResponse;
    }

    const originIndex = buildOriginIndex(mergedQr);
    return { mergedQr, originIndex };
  }, [params.payerQr, params.providerQr]);
}
