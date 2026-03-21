import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { handleCallback } from "@/lib/auth";

export const Route = createFileRoute("/callback")({
  component: CallbackPage,
});

function CallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const errorParam = params.get("error");

    if (errorParam) {
      setError(errorParam);
      return;
    }
    if (!code || !state) {
      setError("Missing code or state");
      return;
    }

    handleCallback(code, state)
      .then(() => {
        // Clear the pre-login session query cache so stale { authenticated: false }
        // doesn't race with the freshly stored auth state
        queryClient.removeQueries({ queryKey: ["auth", "session"] });
        navigate({ to: "/" });
      })
      .catch((e) => setError(e.message));
  }, [navigate, queryClient]);

  if (error) return <div>Authentication failed: {error}</div>;
  return <div>Completing sign in...</div>;
}
