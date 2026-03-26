import { useSyncExternalStore } from "react";

const STORAGE_KEY = "dtr-questionnaire-responses";
const CHANGE_EVENT = "dtr-questionnaire-responses-change";

type QuestionnaireResponseStore = Record<string, string[]>;

// In-memory cache to avoid localStorage reads and JSON.parse on every render
let cachedStore: QuestionnaireResponseStore | null = null;

function readStore(): QuestionnaireResponseStore {
  if (cachedStore !== null) {
    return cachedStore;
  }

  if (typeof window === "undefined") {
    return {};
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    cachedStore = {};
    return cachedStore;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const store: QuestionnaireResponseStore = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        store[key] = value.filter((entry): entry is string => !!entry);
      }
    }

    cachedStore = store;
    return cachedStore;
  } catch {
    cachedStore = {};
    return cachedStore;
  }
}

function writeStore(store: QuestionnaireResponseStore): void {
  if (typeof window === "undefined") {
    return;
  }

  cachedStore = store;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleChange = () => {
    cachedStore = null; // Invalidate on external changes
    listener();
  };
  window.addEventListener("storage", handleChange);
  window.addEventListener(CHANGE_EVENT, handleChange);

  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(CHANGE_EVENT, handleChange);
  };
}

function getSnapshot(orderRef?: string): string {
  if (!orderRef) {
    return "[]";
  }
  return JSON.stringify(readStore()[orderRef] ?? []);
}

export function saveDtrQuestionnaireResponseId(
  orderRef: string,
  questionnaireResponseId: string,
): void {
  if (!orderRef || !questionnaireResponseId) {
    return;
  }

  const store = readStore();
  const existingIds = store[orderRef] ?? [];
  if (existingIds.includes(questionnaireResponseId)) {
    return;
  }

  store[orderRef] = [...existingIds, questionnaireResponseId];
  writeStore(store);
}

export function useDtrQuestionnaireResponseIds(orderRef?: string): string[] {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => getSnapshot(orderRef),
    () => "[]",
  );

  try {
    return JSON.parse(snapshot) as string[];
  } catch {
    return [];
  }
}
