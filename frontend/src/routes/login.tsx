import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

interface TestAccount {
  username: string;
  password: string;
  displayName: string;
  fhirResource: string;
}

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const [testAccounts, setTestAccounts] = useState<TestAccount[]>([]);

  useEffect(() => {
    fetch("/api/users")
      .then((res) => res.json())
      .then((data) => setTestAccounts(data))
      .catch(() => {});
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center px-4 bg-[#7CAEAE]">
        <span className="text-lg font-semibold text-white">
          Da Vinci Provider
        </span>
      </header>

      <div className="flex flex-1 items-start justify-center pt-16">
        <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm">
          <h2 className="mb-6 text-xl font-semibold">Sign In</h2>

          <form method="POST" action="/login">
            <div className="mb-4">
              <label
                htmlFor="username"
                className="mb-1 block text-sm font-medium"
              >
                Username
              </label>
              <input
                type="text"
                id="username"
                name="username"
                autoComplete="username"
                required
                autoFocus
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7CAEAE]"
              />
            </div>
            <div className="mb-6">
              <label
                htmlFor="password"
                className="mb-1 block text-sm font-medium"
              >
                Password
              </label>
              <input
                type="password"
                id="password"
                name="password"
                autoComplete="current-password"
                required
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7CAEAE]"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-md bg-[#7CAEAE] px-4 py-2 text-sm font-medium text-white hover:bg-[#6a9a9a]"
            >
              Sign In
            </button>
          </form>

          {testAccounts.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Test Accounts
              </h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="py-1 text-left font-medium">Username</th>
                    <th className="py-1 text-left font-medium">Password</th>
                    <th className="py-1 text-left font-medium">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {testAccounts.map((account) => (
                    <tr
                      key={account.username}
                      className="border-b border-muted"
                    >
                      <td className="py-1">
                        <code className="rounded bg-muted px-1">
                          {account.username}
                        </code>
                      </td>
                      <td className="py-1">
                        <code className="rounded bg-muted px-1">
                          {account.password}
                        </code>
                      </td>
                      <td className="py-1 text-muted-foreground">
                        {account.displayName}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
