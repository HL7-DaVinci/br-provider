import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Bundle, Patient, Practitioner } from "fhir/r4";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { useFhirServer } from "@/hooks/use-fhir-server";
import { fhirSend } from "@/lib/api";
import { getApplicableCustomAuthTarget, setLocalIdentity } from "@/lib/auth";
import { formatPatientName } from "@/lib/clinical-formatters";

interface TestAccount {
  username: string;
  password: string;
  displayName: string;
  fhirResource: string;
  resourceType: string;
}

// Fetches Practitioner/Patient resources from the open server and shapes them
// as TestAccount entries so the existing tabs/Select UI and submit flow can
// be reused unchanged. password is unused in local identity mode.
async function fetchLocalIdentities(serverUrl: string): Promise<TestAccount[]> {
  const lists = await Promise.all(
    (["Practitioner", "Patient"] as const).map(async (resourceType) => {
      const res = await fhirSend(`${serverUrl}/${resourceType}?_count=50`);
      if (!res.ok) return [];
      const bundle: Bundle<Practitioner | Patient> = await res.json();
      return (bundle.entry ?? [])
        .map((entry) => entry.resource)
        .filter(
          (resource): resource is Practitioner | Patient => !!resource?.id,
        )
        .map((resource) => {
          const fhirResource = `${resourceType}/${resource.id}`;
          return {
            username: fhirResource,
            password: "",
            displayName: formatPatientName(resource.name),
            fhirResource,
            resourceType,
          };
        });
    }),
  );
  return lists.flat();
}

const ERROR_MESSAGES: Record<string, string> = {
  auth_server_unavailable:
    "The authorization server is not reachable. Make sure it is running and try again.",
  login_failed: "Unable to start the sign-in process. Please try again.",
  smart_discovery_failed:
    "Could not read the server's SMART configuration. Check the server URL and try again.",
  smart_server_unsupported:
    "This server's SMART configuration is missing required support (PKCE with S256, authorization_code grant).",
  smart_client_not_configured:
    "No client ID is configured for this server. Add one in settings or provide one at login.",
  bad_credentials: "Sign-in failed. Select an account and try again.",
};

export const Route = createFileRoute("/login")({
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>) => ({
    error: search.error as string | undefined,
    idp: search.idp as string | undefined,
  }),
});

function LoginPage() {
  const { error: urlError, idp } = Route.useSearch();
  const { localIdentityMode: storedServerIsOpen, login } = useAuth();
  const { serverUrl } = useFhirServer();
  const navigate = useNavigate();
  // idp=1 marks an inbound authorization request (Tiered OAuth) that this
  // server must answer with its own account form and a real form POST, no
  // matter which server the SPA has selected. It overrides both local
  // identity mode and the external sign-in card below, or the saved OAuth
  // request never resumes.
  const localIdentityMode = storedServerIsOpen && !idp;
  // A custom server authenticates against itself, so the local test accounts
  // below do not apply to it. getApplicableCustomAuthTarget applies the same
  // policy as login itself: a non-SMART record never overrides a preset.
  const authTarget = getApplicableCustomAuthTarget(serverUrl);
  const externalTarget =
    !localIdentityMode && !idp && authTarget ? authTarget : undefined;
  const [accounts, setAccounts] = useState<TestAccount[]>([]);
  const [error, setError] = useState<string | undefined>(
    () =>
      urlError && (ERROR_MESSAGES[urlError] ?? `Unknown error: ${urlError}`),
  );
  const [submitting, setSubmitting] = useState(false);

  const startExternalLogin = useCallback(() => {
    if (!externalTarget) return;
    if (externalTarget.authMode === "smart") {
      login(externalTarget.serverUrl, undefined, {
        clientId: externalTarget.clientId,
      });
      return;
    }
    login(externalTarget.serverUrl, externalTarget.idp || undefined);
  }, [externalTarget, login]);

  useEffect(() => {
    if (localIdentityMode || externalTarget) return;
    fetch("/api/users")
      .then((res) => res.json())
      .then((data) => setAccounts(data))
      .catch(() => {});
  }, [localIdentityMode, externalTarget]);

  useEffect(() => {
    if (!localIdentityMode) return;
    fetchLocalIdentities(serverUrl)
      .then(setAccounts)
      .catch(() => setError("Unable to load identities from the server."));
  }, [localIdentityMode, serverUrl]);

  const practitioners = useMemo(
    () => accounts.filter((a) => a.resourceType === "Practitioner"),
    [accounts],
  );
  const patients = useMemo(
    () => accounts.filter((a) => a.resourceType === "Patient"),
    [accounts],
  );

  const [selectedUsername, setSelectedUsername] = useState<string>();
  const [activeTab, setActiveTab] = useState<"practitioner" | "patient">(
    "practitioner",
  );

  function submitLogin() {
    const account = accounts.find((a) => a.username === selectedUsername);
    if (!account) return;

    setError(undefined);

    if (localIdentityMode) {
      setLocalIdentity({
        name: account.displayName,
        fhirUser: account.fhirResource,
        fhirUserType: account.resourceType,
      });
      navigate({
        to: account.resourceType === "Patient" ? "/patient" : "/practitioner",
      });
      return;
    }

    setSubmitting(true);

    // Use a real form POST so the browser follows Spring's redirect chain.
    // When a SMART/OAuth client triggered the login, Spring's saved request
    // resumes /oauth2/authorize and the browser ends up at the client's
    // redirect_uri. Otherwise the configured defaultSuccessUrl /auth/login
    // takes the user into the SPA's own Tiered OAuth flow.
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/login";
    form.style.display = "none";

    const usernameField = document.createElement("input");
    usernameField.type = "hidden";
    usernameField.name = "username";
    usernameField.value = account.username;
    form.appendChild(usernameField);

    const passwordField = document.createElement("input");
    passwordField.type = "hidden";
    passwordField.name = "password";
    passwordField.value = account.password;
    form.appendChild(passwordField);

    document.body.appendChild(form);
    form.submit();
  }

  function handleTabChange(value: string) {
    setActiveTab(value as "practitioner" | "patient");
    setSelectedUsername(undefined);
  }

  if (externalTarget) {
    return (
      <div className="flex flex-1 items-start justify-center pt-16">
        <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm">
          <h2 className="mb-2 text-xl font-semibold">Sign In</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            You sign in to this server directly.
          </p>
          <p className="mb-6 break-all font-mono text-xs text-muted-foreground">
            {externalTarget.serverUrl}
          </p>

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          <button
            type="button"
            onClick={startExternalLogin}
            className="w-full cursor-pointer rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand/85"
          >
            {error ? "Try again" : "Continue to sign in"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-start justify-center pt-16">
      <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm">
        <h2 className="mb-2 text-xl font-semibold">Sign In</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Choose an account type, then select a user to sign in.
        </p>
        {localIdentityMode && (
          <p className="mb-6 text-sm text-amber-600 dark:text-amber-500">
            This server does not require authentication. You are selecting a
            demo identity. Requests are not authenticated.
          </p>
        )}

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="w-full">
            <TabsTrigger value="practitioner" className="flex-1 cursor-pointer">
              Practitioners
            </TabsTrigger>
            <TabsTrigger value="patient" className="flex-1 cursor-pointer">
              Patients
            </TabsTrigger>
          </TabsList>

          <TabsContent value="practitioner">
            <AccountSelect
              accounts={practitioners}
              value={selectedUsername}
              placeholder="Select a practitioner..."
              onSelect={setSelectedUsername}
            />
          </TabsContent>

          <TabsContent value="patient">
            <AccountSelect
              accounts={patients}
              value={selectedUsername}
              placeholder="Select a patient..."
              onSelect={setSelectedUsername}
            />
          </TabsContent>
        </Tabs>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <button
          type="button"
          disabled={!selectedUsername || submitting}
          onClick={submitLogin}
          className="mt-6 w-full cursor-pointer rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand/85 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Signing in..." : "Sign In"}
        </button>
      </div>
    </div>
  );
}

function AccountSelect({
  accounts,
  value,
  placeholder,
  onSelect,
}: {
  accounts: TestAccount[];
  value?: string;
  placeholder: string;
  onSelect: (username: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onSelect}>
      <SelectTrigger className="mt-3 w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        position="popper"
        className="w-(--radix-select-trigger-width)"
      >
        {accounts.map((account) => (
          <SelectItem
            key={account.username}
            value={account.username}
            textValue={account.displayName}
          >
            <div>
              <div className="text-sm font-medium">{account.displayName}</div>
              <div className="text-xs text-muted-foreground">
                {account.username}
              </div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
