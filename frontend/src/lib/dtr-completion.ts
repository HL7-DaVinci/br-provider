import type { ActiveQrStatus, TerminalQrStatus } from "@/lib/qr-status";

export const DTR_COMPLETION_CHANNEL = "dtr-completion";

export interface DtrCompletionMessage {
  type: "dtr-completed";
  id: string;
  status: ActiveQrStatus | TerminalQrStatus;
  orderRef?: string;
  patientId?: string;
  coverageRef?: string;
  coverageAssertionId?: string;
  fhirContext?: string[];
  questionnaireResponseId?: string;
}

type DtrCompletionInput = Omit<DtrCompletionMessage, "id" | "type">;

export function broadcastDtrCompletion(input: DtrCompletionInput): void {
  const message: DtrCompletionMessage = {
    type: "dtr-completed",
    id: crypto.randomUUID(),
    ...input,
  };

  try {
    const channel = new BroadcastChannel(DTR_COMPLETION_CHANNEL);
    channel.postMessage(message);
    channel.close();
  } catch {
    // Window event below covers same-page task sheet usage and older browsers.
  }

  window.dispatchEvent(
    new CustomEvent<DtrCompletionMessage>(DTR_COMPLETION_CHANNEL, {
      detail: message,
    }),
  );
}

export function subscribeDtrCompletion(
  handler: (message: DtrCompletionMessage) => void,
): () => void {
  const seen = new Set<string>();

  const handleMessage = (message: unknown) => {
    if (!isDtrCompletionMessage(message) || seen.has(message.id)) {
      return;
    }
    seen.add(message.id);
    handler(message);
  };

  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(DTR_COMPLETION_CHANNEL);
    channel.onmessage = (event) => handleMessage(event.data);
  } catch {
    channel = undefined;
  }

  const handleWindowEvent = (event: Event) => {
    handleMessage((event as CustomEvent<DtrCompletionMessage>).detail);
  };
  window.addEventListener(DTR_COMPLETION_CHANNEL, handleWindowEvent);

  return () => {
    channel?.close();
    window.removeEventListener(DTR_COMPLETION_CHANNEL, handleWindowEvent);
  };
}

function isDtrCompletionMessage(value: unknown): value is DtrCompletionMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as DtrCompletionMessage).type === "dtr-completed" &&
    typeof (value as DtrCompletionMessage).id === "string"
  );
}
