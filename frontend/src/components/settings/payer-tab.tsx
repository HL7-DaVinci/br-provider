import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { usePayerStatus } from "@/hooks/use-fhir-api";
import { usePayerServer } from "@/hooks/use-payer-server";
import {
  type CustomHeader,
  type PayerAuthMode,
  type PayerServer,
  resolvePayerAuthMode,
} from "@/lib/fhir-config";
import { getStoredPayerHeaders } from "@/lib/payer-config";
import {
  addPayerRecent,
  getPayerRecents,
  removePayerRecent,
} from "@/lib/server-recents";
import { ConnectionStatus } from "./connection-status";
import {
  HeaderEditor,
  headerEditorError,
  validCustomHeaders,
} from "./header-editor";

const RECENT_PREFIX = "recent:";

const AUTH_MODE_LABELS: Record<PayerAuthMode, string> = {
  auto: "Auto-detect",
  open: "Open (no authentication)",
  "udap-b2b": "UDAP B2B",
  "smart-backend": "SMART Backend Services",
};

export function PayerTab({ onClose }: { onClose: () => void }) {
  const { payerServer, payerServers, cdsUrl, fhirUrl, setPayerServer } =
    usePayerServer();

  // An active payer that is not a preset reopens the dialog in custom
  // mode with its configuration filled in, mirroring the provider tab.
  const isCustomActive = !payerServers.some((s) => s.name === payerServer.name);

  const [pendingPayer, setPendingPayer] = useState("");
  const [showCustomPayer, setShowCustomPayer] = useState(isCustomActive);
  const [customPayerCdsUrl, setCustomPayerCdsUrl] = useState(
    isCustomActive ? payerServer.cdsUrl : "",
  );
  const [customPayerFhirUrl, setCustomPayerFhirUrl] = useState(
    isCustomActive ? payerServer.fhirUrl : "",
  );
  const [customAuthMode, setCustomAuthMode] = useState<PayerAuthMode>(
    isCustomActive ? (payerServer.authMode ?? "auto") : "auto",
  );
  const [clientId, setClientId] = useState(payerServer.clientId ?? "");
  const [bypassPayorCheck, setBypassPayorCheck] = useState(
    payerServer.bypassPayorCheck ?? false,
  );
  const [headers, setHeaders] = useState<CustomHeader[]>(
    payerServer.headers ?? [],
  );
  const [recents, setRecents] = useState(getPayerRecents);

  const isPayerPreset = payerServers.some((s) => s.name === pendingPayer);
  // The status panel follows the selection being made, not the server still
  // active, so the endpoints shown always belong to the name in the dropdown.
  const selectedPayer =
    payerServers.find((s) => s.name === pendingPayer) ?? payerServer;
  const selectedFhirUrl = showCustomPayer ? fhirUrl : selectedPayer.fhirUrl;
  const selectedCdsUrl = showCustomPayer ? cdsUrl : selectedPayer.cdsUrl;
  const status = usePayerStatus(selectedFhirUrl);

  const normalizedCustomCds = customPayerCdsUrl.trim().replace(/\/+$/, "");
  const normalizedCustomFhir = customPayerFhirUrl.trim().replace(/\/+$/, "");
  // The custom form still describes the active payer, so nothing is
  // being switched.
  const customMatchesActive =
    isCustomActive &&
    showCustomPayer &&
    normalizedCustomCds === payerServer.cdsUrl &&
    normalizedCustomFhir === payerServer.fhirUrl &&
    customAuthMode === (payerServer.authMode ?? "auto");

  const switchingPayer =
    (isPayerPreset && pendingPayer !== payerServer.name) ||
    (showCustomPayer &&
      !!normalizedCustomCds &&
      !!normalizedCustomFhir &&
      !customMatchesActive);

  const handlePayerChange = (value: string) => {
    // Changing the payer resets the bypass to the safe default; only
    // re-selecting the active payer restores its stored preference.
    setBypassPayorCheck(
      value === payerServer.name
        ? (payerServer.bypassPayorCheck ?? false)
        : false,
    );
    if (value === "custom") {
      setShowCustomPayer(true);
      setPendingPayer("");
      setCustomPayerCdsUrl("");
      setCustomPayerFhirUrl("");
      setCustomAuthMode("auto");
      setClientId("");
      setHeaders([]);
      return;
    }
    if (value.startsWith(RECENT_PREFIX)) {
      const recent = recents[Number(value.slice(RECENT_PREFIX.length))];
      if (!recent) return;
      setShowCustomPayer(true);
      setPendingPayer("");
      setCustomPayerCdsUrl(recent.cdsUrl);
      setCustomPayerFhirUrl(recent.fhirUrl);
      setCustomAuthMode(recent.authMode ?? "auto");
      setClientId(recent.clientId ?? "");
      setBypassPayorCheck(recent.bypassPayorCheck ?? false);
      setHeaders(recent.headers ?? []);
      return;
    }
    setShowCustomPayer(false);
    const preset = payerServers.find((s) => s.name === value);
    setClientId(
      preset?.name === payerServer.name ? (payerServer.clientId ?? "") : "",
    );
    const storedHeaders = preset ? getStoredPayerHeaders(preset.fhirUrl) : [];
    setHeaders(
      preset?.name === payerServer.name
        ? (payerServer.headers ?? [])
        : storedHeaders.length > 0
          ? storedHeaders
          : (preset?.headers ?? []),
    );
    setPendingPayer(value);
  };

  const bypassPayorCheckChanged =
    bypassPayorCheck !== (payerServer.bypassPayorCheck ?? false);
  const headersChanged =
    JSON.stringify(validCustomHeaders(headers)) !==
    JSON.stringify(validCustomHeaders(payerServer.headers ?? []));
  const headerError = headerEditorError(headers);

  // Bypass/header edits only count as in-place edits of the active payer
  // when the form still targets it: the select hasn't moved to "custom" or
  // a different preset, and pendingPayer is either untouched or points
  // back at the active payer's own name.
  const editingActivePayer =
    customMatchesActive ||
    (!showCustomPayer &&
      (pendingPayer === "" || pendingPayer === payerServer.name));

  const effectiveAuthMode = showCustomPayer
    ? customAuthMode
    : resolvePayerAuthMode(selectedPayer);

  // SMART Backend Services cannot register dynamically, so it is unusable
  // without a client ID the payer already knows. A preset can carry one in
  // app.payer-servers, which the frontend cannot see, so only a custom payer
  // has to supply it here.
  const clientIdMissing =
    showCustomPayer && customAuthMode === "smart-backend" && !clientId.trim();

  const clientIdChanged = clientId.trim() !== (payerServer.clientId ?? "");

  const canSave =
    !headerError &&
    !clientIdMissing &&
    (switchingPayer ||
      (editingActivePayer &&
        (bypassPayorCheckChanged || headersChanged || clientIdChanged)));

  const handleSave = async () => {
    const saveHeaders = validCustomHeaders(headers);
    const base = switchingPayer
      ? showCustomPayer
        ? {
            name: "Custom Payer",
            cdsUrl: customPayerCdsUrl.trim().replace(/\/+$/, ""),
            fhirUrl: customPayerFhirUrl.trim().replace(/\/+$/, ""),
            ...(customAuthMode !== "auto" ? { authMode: customAuthMode } : {}),
          }
        : payerServers.find((s) => s.name === pendingPayer)
      : payerServer;
    if (base) {
      const next: PayerServer = {
        ...base,
        clientId:
          effectiveAuthMode === "smart-backend" && clientId.trim()
            ? clientId.trim()
            : undefined,
        bypassPayorCheck: bypassPayorCheck || undefined,
        headers: saveHeaders.length > 0 ? saveHeaders : undefined,
      };
      await setPayerServer(next).catch((err) => {
        console.error("setPayerServer failed", err);
      });
      if (showCustomPayer) {
        addPayerRecent({
          name: next.name,
          cdsUrl: next.cdsUrl,
          fhirUrl: next.fhirUrl,
          ...(next.authMode ? { authMode: next.authMode } : {}),
          ...(next.clientId ? { clientId: next.clientId } : {}),
          ...(bypassPayorCheck ? { bypassPayorCheck: true } : {}),
          ...(next.headers ? { headers: next.headers } : {}),
        });
      }
    }
    onClose();
  };

  return (
    <div className="flex min-h-[28rem] flex-col gap-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="payer-select">Server</Label>
        <Select
          value={
            isPayerPreset
              ? pendingPayer
              : showCustomPayer
                ? "custom"
                : payerServer.name
          }
          onValueChange={handlePayerChange}
        >
          <SelectTrigger id="payer-select">
            <SelectValue placeholder="Select a payer server" />
          </SelectTrigger>
          <SelectContent>
            {payerServers.map((s) => (
              <SelectItem key={s.name} value={s.name}>
                {s.name}
              </SelectItem>
            ))}
            {recents.length > 0 && (
              <SelectGroup>
                <SelectLabel>Recent</SelectLabel>
                {recents.map((recent, index) => (
                  <SelectItem
                    key={`${recent.cdsUrl} ${recent.fhirUrl}`}
                    value={`${RECENT_PREFIX}${index}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="flex flex-col">
                        <span
                          className="truncate max-w-96 text-xs"
                          title={recent.cdsUrl}
                        >
                          CDS: {recent.cdsUrl}
                        </span>
                        <span
                          className="truncate max-w-96 text-xs"
                          title={recent.fhirUrl}
                        >
                          FHIR: {recent.fhirUrl}
                        </span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${recent.fhirUrl} from recents`}
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
                          removePayerRecent(recent.fhirUrl, recent.cdsUrl);
                          setRecents(getPayerRecents());
                        }}
                      >
                        <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                      </button>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            <SelectItem value="custom">Custom...</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!showCustomPayer && (
        <p className="text-xs text-muted-foreground">
          Authentication: {AUTH_MODE_LABELS[effectiveAuthMode]}
        </p>
      )}

      {showCustomPayer && (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label
              htmlFor="payer-cds-url"
              className="text-xs text-muted-foreground"
            >
              CDS Services URL
            </Label>
            <Input
              id="payer-cds-url"
              placeholder="http://payer.example.com/cds-services"
              value={customPayerCdsUrl}
              onChange={(e) => setCustomPayerCdsUrl(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label
              htmlFor="payer-fhir-url"
              className="text-xs text-muted-foreground"
            >
              FHIR URL
            </Label>
            <Input
              id="payer-fhir-url"
              placeholder="http://payer.example.com/fhir"
              value={customPayerFhirUrl}
              onChange={(e) => setCustomPayerFhirUrl(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label
              htmlFor="payer-auth-mode"
              className="text-xs text-muted-foreground"
            >
              Authentication
            </Label>
            <Select
              value={customAuthMode}
              onValueChange={(v) => setCustomAuthMode(v as PayerAuthMode)}
            >
              <SelectTrigger id="payer-auth-mode" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(AUTH_MODE_LABELS) as PayerAuthMode[]).map(
                  (mode) => (
                    <SelectItem key={mode} value={mode}>
                      {AUTH_MODE_LABELS[mode]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {effectiveAuthMode === "smart-backend" && (
        <div className="space-y-1">
          <Label
            htmlFor="payer-client-id"
            className="text-xs text-muted-foreground"
          >
            Client ID
          </Label>
          <Input
            id="payer-client-id"
            placeholder="client-id registered with this payer"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="h-8 text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Register the JWKS at{" "}
            <code className="text-[0.7rem]">/api/security/jwks</code> with the
            payer, then enter the client ID it assigned.
            {!showCustomPayer &&
              " Leave blank when the server config already sets one."}
          </p>
        </div>
      )}

      <div className="flex items-start gap-2">
        <Checkbox
          id="bypass-payor-check"
          checked={bypassPayorCheck}
          onCheckedChange={(checked) => setBypassPayorCheck(checked === true)}
          className="mt-0.5"
        />
        <div className="space-y-0.5">
          <Label htmlFor="bypass-payor-check">Bypass payor-handled check</Label>
          <p className="text-xs text-muted-foreground">
            Sends the X-Bypass-Payor-Check header so the BR payer accepts
            unknown payors, payors without an identifier, and patients with
            multiple Coverages. The patient still needs a Coverage resource.
            Leave off to test payor-not-handled responses.
          </p>
        </div>
      </div>

      <HeaderEditor headers={headers} onChange={setHeaders} idPrefix="payer" />

      <ConnectionStatus
        isLoading={status.isLoading}
        isConnected={status.isConnected}
        latency={status.latency}
        error={status.error}
        onTest={status.refetch}
        url={selectedFhirUrl}
        secondaryUrl={selectedCdsUrl}
      />

      <DialogFooter className="mt-auto">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!canSave}>
          Save
        </Button>
      </DialogFooter>
    </div>
  );
}
