import type { QuestionnaireResponse } from "fhir/r4";
import { JsonViewerDialog } from "@/components/json-viewer-dialog";

interface CompletedQrViewerProps {
  qr: QuestionnaireResponse;
  onClose: () => void;
}

/**
 * Read-only viewer for a completed QuestionnaireResponse linked to a specific
 * order. Opens a modal showing the QR resource. Used when an order's DTR
 * requirement is satisfied by a completed QR (no relaunch — the requirement
 * is genuinely done).
 */
export function CompletedQrViewer({ qr, onClose }: CompletedQrViewerProps) {
  return (
    <JsonViewerDialog
      data={qr}
      title="Completed Documentation"
      description={
        qr.id
          ? `QuestionnaireResponse/${qr.id}`
          : "Completed QuestionnaireResponse"
      }
      onClose={onClose}
    />
  );
}
