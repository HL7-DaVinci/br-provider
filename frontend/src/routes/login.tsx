import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { startLogin } from "@/lib/auth";

interface TestAccount {
  username: string;
  password: string;
  displayName: string;
  fhirResource: string;
  resourceType: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  auth_server_unavailable:
    "The authorization server is not reachable. Make sure it is running and try again.",
  login_failed: "Unable to start the sign-in process. Please try again.",
};

export const Route = createFileRoute("/login")({
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>) => ({
    error: search.error as string | undefined,
  }),
});

function LoginPage() {
  const { error: urlError } = Route.useSearch();
  const [accounts, setAccounts] = useState<TestAccount[]>([]);
  const [error, setError] = useState<string | undefined>(
    () =>
      urlError && (ERROR_MESSAGES[urlError] ?? `Unknown error: ${urlError}`),
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/users")
      .then((res) => res.json())
      .then((data) => setAccounts(data))
      .catch(() => {});
  }, []);

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

  async function submitLogin() {
    const account = accounts.find((a) => a.username === selectedUsername);
    if (!account) return;

    setError(undefined);
    setSubmitting(true);
    try {
      // Authenticate with Spring Security first (establishes session cookie)
      await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          username: account.username,
          password: account.password,
        }),
        credentials: "include",
        redirect: "manual",
      });

      // Now start the OAuth flow -- Spring Authorization Server will see the
      // authenticated session and skip the form login redirect entirely
      startLogin();
    } catch {
      setError("Unable to reach the server.");
      setSubmitting(false);
    }
  }

  function handleTabChange(value: string) {
    setActiveTab(value as "practitioner" | "patient");
    setSelectedUsername(undefined);
  }

  return (
    <div className="flex flex-1 items-start justify-center pt-16">
      <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm">
        <h2 className="mb-2 text-xl font-semibold">Sign In</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Choose an account type, then select a user to sign in.
        </p>

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
