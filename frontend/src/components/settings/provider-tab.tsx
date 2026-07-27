import { useNavigate } from "@tanstack/react-router";
import { CheckCircle, Info, Loader2, X, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useServerStatus } from "@/hooks/use-fhir-api";
import { useFhirServer, useServerDiscovery } from "@/hooks/use-fhir-server";
import {
  type CustomHeader,
  clearStoredCustomAuthTarget,
  clearStoredCustomOpenServer,
  getApiBaseUrl,
  getStoredCustomAuthTarget,
  getStoredCustomOpenServer,
  getStoredServerHeaders,
  setStoredCustomAuthTarget,
  setStoredCustomOpenServer,
  setStoredServerHeaders,
} from "@/lib/fhir-config";
import {
  addProviderRecent,
  getProviderRecents,
  removeProviderRecent,
} from "@/lib/server-recents";
import { ConnectionStatus } from "./connection-status";
import {
  HeaderEditor,
  headerEditorError,
  validCustomHeaders,
} from "./header-editor";

const RECENT_PREFIX = "recent:";

export function ProviderTab({ onClose }: { onClose: () => void }) {
  const { serverUrl, presetServers, setServerUrl, isCustomServer } =
    useFhirServer();
  const status = useServerStatus(serverUrl);
  const { login, logout: signOut, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const storedAuthTarget = getStoredCustomAuthTarget();
  const storedOpenServer = getStoredCustomOpenServer();
  const activeCustomHeaders =
    isCustomServer && storedAuthTarget?.serverUrl === serverUrl
      ? (storedAuthTarget.headers ?? [])
      : isCustomServer && storedOpenServer?.url === serverUrl
        ? (storedOpenServer.headers ?? [])
        : [];
  const activeStoredHeaders = getStoredServerHeaders(serverUrl);
  const activeHeaders =
    activeStoredHeaders.length > 0 ? activeStoredHeaders : activeCustomHeaders;

  const [pendingUrl, setPendingUrl] = useState(isCustomServer ? serverUrl : "");
  const [customUrlInput, setCustomUrlInput] = useState(
    isCustomServer ? serverUrl : "",
  );
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [idpUrl, setIdpUrl] = useState(
    isCustomServer && storedAuthTarget?.serverUrl === serverUrl
      ? (storedAuthTarget.idp ?? "")
      : "",
  );
  const [headers, setHeaders] = useState<CustomHeader[]>(activeHeaders);
  const [recents, setRecents] = useState(getProviderRecents);

  // Whether a preset server has been selected but not yet saved
  const pendingPreset =
    !!pendingUrl && presetServers.some((s) => s.url === pendingUrl);
  const showCustom = (showCustomInput || isCustomServer) && !pendingPreset;

  // Discovery runs against the probed URL, not the active server
  const isPendingCustom = !!pendingUrl && !pendingPreset;
  const { data: discovery, isLoading: isDiscovering } = useServerDiscovery(
    pendingUrl,
    isPendingCustom,
    validCustomHeaders(headers),
  );

  // In the single-server model, switching always logs out first,
  // so a pending custom server always needs auth if UDAP-registered
  const needsAuth =
    isPendingCustom && discovery?.udapEnabled && discovery.registered;

  // When the probe confirms a custom server is a valid FHIR server without
  // UDAP support, login uses local identity mode instead of the UDAP flow.
  const probedOpen =
    isPendingCustom && discovery?.fhirServer === true && !discovery.udapEnabled;

  // Connect button visible when input differs from what has been probed
  const normalizedInput = customUrlInput.trim().replace(/\/+$/, "");
  const canConnect =
    showCustom && !!normalizedInput && normalizedInput !== pendingUrl;

  // Probe the URL for UDAP support without switching the active server
  const handleConnect = () => {
    if (normalizedInput) {
      setPendingUrl(normalizedInput);
    }
  };

  const switchingServer = !!pendingUrl && pendingUrl !== serverUrl;

  const handleServerChange = (value: string) => {
    if (value === "custom") {
      setShowCustomInput(true);
      setCustomUrlInput("");
      setPendingUrl("");
      setIdpUrl("");
      setHeaders([]);
      return;
    }
    if (value.startsWith(RECENT_PREFIX)) {
      const recent = recents[Number(value.slice(RECENT_PREFIX.length))];
      if (!recent) return;
      setShowCustomInput(true);
      setCustomUrlInput(recent.url);
      setPendingUrl(recent.url);
      setIdpUrl(recent.idp ?? "");
      setHeaders(recent.headers ?? []);
      return;
    }
    setShowCustomInput(false);
    setPendingUrl(value);
    setHeaders(
      value === serverUrl ? activeHeaders : getStoredServerHeaders(value),
    );
  };

  const savedHeaders = validCustomHeaders(activeHeaders);
  // Headers only count as an in-place edit when the form still targets the
  // active server: either the custom input hasn't been touched, or it has
  // been typed back to match the active server's URL. Otherwise (e.g.
  // "Custom URL..." was just picked) there is no active-server target to
  // write headers onto.
  const headersChanged =
    !switchingServer &&
    (!showCustomInput || normalizedInput === serverUrl) &&
    JSON.stringify(validCustomHeaders(headers)) !==
      JSON.stringify(savedHeaders);
  const headerError = headerEditorError(headers);

  const canSave =
    !headerError &&
    (switchingServer
      ? !isPendingCustom || (discovery?.fhirServer === true && !isDiscovering)
      : headersChanged);

  const handleSave = async () => {
    const saveHeaders = validCustomHeaders(headers);
    const headerArg = saveHeaders.length > 0 ? saveHeaders : undefined;

    if (!switchingServer && headersChanged) {
      // The keyed store works for preset and custom servers alike. The
      // custom-target entries stay in sync so recents prefill correctly.
      setStoredServerHeaders(serverUrl, headerArg);
      if (storedAuthTarget?.serverUrl === serverUrl) {
        setStoredCustomAuthTarget(serverUrl, storedAuthTarget.idp, headerArg);
      } else if (storedOpenServer?.url === serverUrl) {
        setStoredCustomOpenServer(serverUrl, headerArg);
      }
      if (isCustomServer) {
        addProviderRecent({
          url: serverUrl,
          ...(storedAuthTarget?.serverUrl === serverUrl && storedAuthTarget.idp
            ? { idp: storedAuthTarget.idp }
            : {}),
          ...(storedOpenServer?.url === serverUrl
            ? { authMode: "open" as const }
            : { authMode: "udap" as const }),
          ...(headerArg ? { headers: headerArg } : {}),
        });
      }
      onClose();
      return;
    }

    setStoredServerHeaders(pendingUrl, headerArg);

    if (needsAuth) {
      setStoredCustomAuthTarget(pendingUrl, idpUrl || undefined, headerArg);
    } else {
      clearStoredCustomAuthTarget();
    }
    if (probedOpen) {
      setStoredCustomOpenServer(pendingUrl, headerArg);
    } else {
      clearStoredCustomOpenServer();
    }
    if (isPendingCustom) {
      addProviderRecent({
        url: pendingUrl,
        ...(idpUrl ? { idp: idpUrl } : {}),
        ...(probedOpen
          ? { authMode: "open" as const }
          : needsAuth
            ? { authMode: "udap" as const }
            : {}),
        ...(headerArg ? { headers: headerArg } : {}),
      });
    }

    if (isAuthenticated) {
      await signOut();
    }
    await setServerUrl(pendingUrl).catch((err) => {
      console.error("setServerUrl failed", err);
    });

    if (needsAuth) {
      login(pendingUrl, idpUrl || undefined);
      return;
    }
    onClose();
    navigate({ to: "/" });
  };

  return (
    <div className="flex min-h-[28rem] flex-col gap-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="server-select">FHIR Server</Label>
        <Select
          value={pendingPreset ? pendingUrl : showCustom ? "custom" : serverUrl}
          onValueChange={handleServerChange}
        >
          <SelectTrigger id="server-select">
            <SelectValue placeholder="Select a server" />
          </SelectTrigger>
          <SelectContent>
            {presetServers.map((s) => (
              <SelectItem key={s.url} value={s.url}>
                {s.name}
              </SelectItem>
            ))}
            {recents.length > 0 && (
              <SelectGroup>
                <SelectLabel>Recent</SelectLabel>
                {recents.map((recent, index) => (
                  <SelectItem
                    key={recent.url}
                    value={`${RECENT_PREFIX}${index}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate max-w-56">{recent.url}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${recent.url} from recents`}
                        className="pointer-events-auto"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onPointerUp={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          removeProviderRecent(recent.url);
                          setRecents(getProviderRecents());
                        }}
                      >
                        <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                      </button>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            <SelectItem value="custom">Custom URL...</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {showCustom && (
        <div className="space-y-2">
          <Label htmlFor="custom-url">Custom Server URL</Label>
          <div className="flex gap-2">
            <Input
              id="custom-url"
              placeholder="https://your-fhir-server.com/fhir"
              value={customUrlInput}
              onChange={(e) => setCustomUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConnect();
              }}
              className="flex-1"
            />
            {canConnect && (
              <Button variant="outline" size="sm" onClick={handleConnect}>
                Test Connection
              </Button>
            )}
          </div>
        </div>
      )}

      <HeaderEditor
        headers={headers}
        onChange={setHeaders}
        idPrefix="provider"
      />

      {isPendingCustom && (
        <DiscoveryStatusSection
          discovery={discovery}
          isDiscovering={isDiscovering}
          idpUrl={idpUrl}
          setIdpUrl={setIdpUrl}
        />
      )}

      <ConnectionStatus
        isLoading={status.isLoading}
        isConnected={status.isConnected}
        latency={status.latency}
        error={status.error}
        onTest={status.refetch}
        url={serverUrl}
      />

      {switchingServer && isAuthenticated && (
        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Switching servers will sign you out and reset your current session.
          </span>
        </div>
      )}

      <DialogFooter className="mt-auto">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!canSave || canConnect}>
          {needsAuth ? "Save & Sign In" : "Save"}
        </Button>
      </DialogFooter>
    </div>
  );
}

interface DiscoveryStatusSectionProps {
  discovery:
    | {
        fhirServer?: boolean;
        error?: string;
        udapEnabled: boolean;
        registered?: boolean;
        tieredOauthSupported?: boolean;
      }
    | undefined;
  isDiscovering: boolean;
  idpUrl: string;
  setIdpUrl: (url: string) => void;
}

function DiscoveryStatusSection({
  discovery,
  isDiscovering,
  idpUrl,
  setIdpUrl,
}: DiscoveryStatusSectionProps) {
  const apiBaseUrl = getApiBaseUrl();

  if (isDiscovering) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking server...
      </div>
    );
  }

  if (!discovery) return null;

  if (discovery.fhirServer === false) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{discovery.error || "Not a valid FHIR server"}</span>
      </div>
    );
  }

  if (!discovery.udapEnabled) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CheckCircle className="h-4 w-4 text-success" />
          Valid FHIR server (no UDAP support)
        </div>
        <p className="text-xs text-muted-foreground">
          Authentication: open server, no sign-in
        </p>
      </div>
    );
  }

  if (!discovery.registered) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CheckCircle className="h-4 w-4 text-success" />
          Valid FHIR server
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <XCircle className="h-4 w-4 text-destructive" />
          UDAP-enabled (registration failed)
        </div>
        <p className="text-xs text-muted-foreground">
          Authentication: UDAP advertised, registration failed
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <CheckCircle className="h-4 w-4 text-success" />
        Valid FHIR server
      </div>
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <CheckCircle className="h-4 w-4 text-success" />
        UDAP-enabled server
      </div>
      <p className="text-xs text-muted-foreground">
        Authentication: UDAP, saving will sign you in
      </p>
      <div className="space-y-1">
        <Label htmlFor="idp-url" className="text-xs text-muted-foreground">
          Identity Provider (optional)
        </Label>
        <div className="relative">
          <Input
            id="idp-url"
            placeholder={apiBaseUrl || "https://idp.example.com"}
            value={idpUrl}
            onChange={(e) => setIdpUrl(e.target.value)}
            className="h-8 text-xs pr-8"
          />
          {idpUrl && (
            <button
              type="button"
              onClick={() => setIdpUrl("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {discovery.tieredOauthSupported
            ? "This server advertises Tiered OAuth support (udap_to). You can specify an Identity Provider to handle user authentication instead of the server's default login."
            : "This server does not advertise Tiered OAuth. An IdP value will still be sent if provided, but the server may ignore it."}
        </p>
      </div>
    </div>
  );
}
