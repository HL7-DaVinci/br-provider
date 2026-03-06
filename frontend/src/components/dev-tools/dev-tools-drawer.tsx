import {
  ChevronDown,
  ChevronRight,
  Pin,
  PinOff,
  Trash2,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import {
  JsonViewerDialog,
  useJsonViewer,
} from "@/components/json-viewer-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useNetworkLog } from "@/hooks/use-network-log";
import { FHIR_SERVERS } from "@/lib/fhir-config";
import type { NetworkLogEntry } from "@/lib/network-log-store";

const DRAWER_WIDTH = "33vw";
const PIN_STORAGE_KEY = "dev-tools-pinned";

function getStoredPinState(): boolean {
  try {
    return localStorage.getItem(PIN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

interface DevToolsDrawerProps {
  open: boolean;
  onClose: () => void;
  onPinnedChange: (pinned: boolean) => void;
}

export const DevToolsDrawer = memo(function DevToolsDrawer({
  open,
  onClose,
  onPinnedChange,
}: DevToolsDrawerProps) {
  const [pinned, setPinned] = useState(getStoredPinState);
  const [serverFilter, setServerFilter] = useState<string | undefined>();
  const { entries, clear, entryCount } = useNetworkLog(serverFilter);
  const { viewerData, openViewer, closeViewer } = useJsonViewer();

  const togglePin = useCallback(() => {
    setPinned((prev) => {
      const next = !prev;
      localStorage.setItem(PIN_STORAGE_KEY, String(next));
      onPinnedChange(next);
      return next;
    });
  }, [onPinnedChange]);

  // Sync pinned state on mount
  useEffect(() => {
    onPinnedChange(pinned);
  }, [pinned, onPinnedChange]);

  const handleServerFilterChange = useCallback((value: string) => {
    setServerFilter(value === "all" ? undefined : value);
  }, []);

  return (
    <>
      <div
        className={`fixed top-12 right-0 bottom-0 z-40 border-l bg-background shadow-lg transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ width: DRAWER_WIDTH }}
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Network</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {entryCount}
              </Badge>
            </div>
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={togglePin}
                    aria-label={pinned ? "Unpin drawer" : "Pin drawer"}
                  >
                    {pinned ? (
                      <PinOff className="h-3.5 w-3.5" />
                    ) : (
                      <Pin className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {pinned ? "Unpin" : "Pin"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={clear}
                    aria-label="Clear log"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Clear</TooltipContent>
              </Tooltip>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onClose}
                aria-label="Close drawer"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Filter */}
          <div className="border-b px-3 py-2">
            <Select
              value={serverFilter ?? "all"}
              onValueChange={handleServerFilterChange}
            >
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Servers</SelectItem>
                {FHIR_SERVERS.map((s) => (
                  <SelectItem key={s.url} value={s.url}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Entry list */}
          <ScrollArea className="flex-1 min-h-0">
            {entries.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
                No requests logged
              </div>
            ) : (
              <div className="divide-y">
                {entries.map((entry) => (
                  <NetworkEntry
                    key={entry.id}
                    entry={entry}
                    onViewJson={openViewer}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

      {viewerData && (
        <JsonViewerDialog
          data={viewerData.data}
          title={viewerData.title}
          description={viewerData.description}
          onClose={closeViewer}
        />
      )}
    </>
  );
});

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

function truncatePath(url: string, serverUrl: string): string {
  const path = serverUrl ? url.slice(serverUrl.length) : url;
  if (path.length > 60) return `${path.slice(0, 57)}...`;
  return path || "/";
}

const NetworkEntry = memo(function NetworkEntry({
  entry,
  onViewJson,
}: {
  entry: NetworkLogEntry;
  onViewJson: (data: unknown, title: string, description?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const statusColor = entry.error
    ? "bg-red-500"
    : entry.status && entry.status >= 200 && entry.status < 300
      ? "bg-green-500"
      : "bg-yellow-500";

  return (
    <div className="text-xs">
      <button
        type="button"
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="mt-1.5 shrink-0">
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusColor}`}
            />
            <span className="font-medium text-muted-foreground">
              {entry.method}
            </span>
            <span className="truncate font-mono">
              {truncatePath(entry.url, entry.serverUrl)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-muted-foreground">
            <span>{entry.serverName}</span>
            {entry.resourceType && (
              <>
                <span className="text-border">/</span>
                <span>{entry.resourceType}</span>
              </>
            )}
            <span className="text-border">/</span>
            <span>{entry.duration}ms</span>
            <span className="ml-auto">
              {formatRelativeTime(entry.timestamp)}
            </span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="flex gap-2 px-3 pb-2 pl-8">
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] px-2"
            onClick={() =>
              onViewJson(
                entry.responseBody,
                `Response - ${entry.method} ${entry.resourceType ?? ""}`,
                `${entry.status} - ${entry.url}`,
              )
            }
          >
            View Response
          </Button>
          {entry.requestBody != null && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={() =>
                onViewJson(
                  entry.requestBody,
                  `Request - ${entry.method} ${entry.resourceType ?? ""}`,
                  entry.url,
                )
              }
            >
              View Request
            </Button>
          )}
          {entry.status && (
            <Badge
              variant={entry.error ? "destructive" : "secondary"}
              className="text-[10px] px-1.5 py-0"
            >
              {entry.status}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
});

export { DRAWER_WIDTH };
