export interface NetworkLogEntry {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  serverUrl: string;
  serverName: string;
  resourceType: string | null;
  status: number | null;
  duration: number;
  responseBody: unknown;
  requestBody: unknown;
  error: boolean;
  operationName?: string;
}

const MAX_ENTRIES = 500;

let entries: NetworkLogEntry[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export const networkLogStore = {
  addEntry(entry: NetworkLogEntry): void {
    entries = [entry, ...entries].slice(0, MAX_ENTRIES);
    emit();
  },

  clear(): void {
    entries = [];
    emit();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSnapshot(): NetworkLogEntry[] {
    return entries;
  },
};
