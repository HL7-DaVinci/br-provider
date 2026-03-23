import { useNavigate } from "@tanstack/react-router";
import { CheckCircle, Info, Loader2, Server, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import { useServerStatus } from "@/hooks/use-fhir-api";
import { useFhirServer, useServerDiscovery } from "@/hooks/use-fhir-server";
import {
  clearStoredCustomAuthTarget,
  getAppConfig,
  getStoredCustomAuthTarget,
  setStoredCustomAuthTarget,
} from "@/lib/fhir-config";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { serverUrl, presetServers, setServerUrl, isCustomServer } =
    useFhirServer();
  const { isConnected, isLoading, latency, error, refetch } =
    useServerStatus(serverUrl);
  const { login, logout: signOut, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // URL being probed for UDAP -- not yet committed as the active server
  const [pendingUrl, setPendingUrl] = useState("");
  const [customUrlInput, setCustomUrlInput] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [idpUrl, setIdpUrl] = useState("");

  // Reset local state when dialog opens
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const storedCustomAuthTarget = getStoredCustomAuthTarget();
      setPendingUrl(isCustomServer ? serverUrl : "");
      setCustomUrlInput(isCustomServer ? serverUrl : "");
      setShowCustomInput(false);
      setIdpUrl(
        isCustomServer && storedCustomAuthTarget?.serverUrl === serverUrl
          ? (storedCustomAuthTarget.idp ?? "")
          : "",
      );
    }
    wasOpen.current = open;
  });

  // Whether a preset server has been selected but not yet saved
  const pendingPreset =
    !!pendingUrl && presetServers.some((s) => s.url === pendingUrl);
  const showCustom = (showCustomInput || isCustomServer) && !pendingPreset;

  // Discovery runs against the probed URL, not the active server
  const isPendingCustom = !!pendingUrl && !pendingPreset;
  const { data: discovery, isLoading: isDiscovering } = useServerDiscovery(
    pendingUrl,
    isPendingCustom,
  );

  // In the single-server model, switching always logs out first,
  // so a pending custom server always needs auth if UDAP-registered
  const needsAuth =
    isPendingCustom && discovery?.udapEnabled && discovery.registered;

  // Connect button visible when input differs from what has been probed
  const normalizedInput = customUrlInput.trim().replace(/\/+$/, "");
  const canConnect =
    showCustom && !!normalizedInput && normalizedInput !== pendingUrl;

  const handleServerChange = (value: string) => {
    if (value === "custom") {
      setShowCustomInput(true);
      setCustomUrlInput("");
      setPendingUrl("");
      return;
    }
    setShowCustomInput(false);
    setPendingUrl(value);
  };

  // Probe the URL for UDAP support without switching the active server
  const handleConnect = () => {
    if (normalizedInput) {
      setPendingUrl(normalizedInput);
    }
  };

  const switchingServer = !!pendingUrl && pendingUrl !== serverUrl;

  // Custom servers must pass the metadata check before save is allowed
  const canSave =
    switchingServer &&
    (!isPendingCustom || (discovery?.fhirServer === true && !isDiscovering));

  const handleSave = async () => {
    if (switchingServer) {
      if (needsAuth) {
        setStoredCustomAuthTarget(pendingUrl, idpUrl || undefined);
      } else {
        clearStoredCustomAuthTarget();
      }
    }

    // Sign out of the current session before switching servers
    if (switchingServer && isAuthenticated) {
      await signOut();
    }
    if (switchingServer) {
      setServerUrl(pendingUrl);
    }
    if (needsAuth) {
      login(pendingUrl, idpUrl || undefined);
      return;
    }
    onOpenChange(false);
    if (switchingServer) {
      navigate({ to: "/" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Settings
          </DialogTitle>
          <DialogDescription>
            Configure your FHIR server connection
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="server-select">FHIR Server</Label>
            <Select
              value={
                pendingPreset ? pendingUrl : showCustom ? "custom" : serverUrl
              }
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

          {isPendingCustom && (
            <DiscoveryStatusSection
              discovery={discovery}
              isDiscovering={isDiscovering}
              idpUrl={idpUrl}
              setIdpUrl={setIdpUrl}
            />
          )}

          <Separator />

          <div className="space-y-2">
            <Label>Connection Status</Label>
            <div className="flex items-center justify-between p-3 rounded-md border bg-muted/50">
              <div className="flex items-center gap-2">
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-warning" />
                    <span className="text-sm">Connecting...</span>
                  </>
                ) : isConnected ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-success" />
                    <span className="text-sm text-success">Connected</span>
                    {latency && (
                      <span className="text-xs text-muted-foreground">
                        ({latency}ms)
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-destructive" />
                    <span className="text-sm text-destructive">
                      Disconnected
                    </span>
                  </>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isLoading}
              >
                Test
              </Button>
            </div>

            {!isConnected && !isLoading && error && (
              <p className="text-xs text-destructive">
                {error instanceof Error
                  ? error.message
                  : "Failed to connect to FHIR server"}
              </p>
            )}

            <div className="text-xs text-muted-foreground">
              <span className="font-medium">URL:</span>{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs break-all">
                {serverUrl}
              </code>
            </div>
          </div>
        </div>

        {switchingServer && isAuthenticated && (
          <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Switching servers will sign you out and reset your current
              session.
            </span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || canConnect}>
            {needsAuth ? "Save & Sign In" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const providerServerUrl = getAppConfig().providerServerUrl;

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
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <CheckCircle className="h-4 w-4 text-success" />
        Valid FHIR server (no UDAP support)
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
      <div className="space-y-1">
        <Label htmlFor="idp-url" className="text-xs text-muted-foreground">
          Identity Provider (optional)
        </Label>
        <div className="relative">
          <Input
            id="idp-url"
            placeholder={providerServerUrl || "https://idp.example.com"}
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
