import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { adoptActiveFhirServer } from "@/hooks/use-fhir-server";
import { getUserInfo, handleCallback } from "@/lib/auth";
import { dtrSearchFromSmartContext } from "@/lib/dtr-launch";

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
      .then(async (result) => {
        // Clear the pre-login session query cache so stale { authenticated: false }
        // doesn't race with the freshly stored auth state
        queryClient.removeQueries({ queryKey: ["auth", "session"] });

        if (result.smartContext?.patient) {
          // The launched EHR becomes the active server so the DTR
          // workspace reads from the server the token is bound to.
          if (result.serverUrl) {
            await adoptActiveFhirServer(result.serverUrl).catch((err) => {
              console.error("failed to adopt launched EHR", err);
            });
          }
          navigate({
            to: "/dtr",
            search: dtrSearchFromSmartContext(
              result.serverUrl ?? "",
              result.smartContext,
            ),
          });
          return;
        }

        const userInfo = getUserInfo();
        const dest =
          userInfo?.fhirUserType === "Practitioner"
            ? "/practitioner"
            : userInfo?.fhirUserType === "Patient"
              ? "/patient"
              : "/";
        navigate({ to: dest });
      })
      .catch((e) => setError(e.message));
  }, [navigate, queryClient]);

  if (error) return <div>Authentication failed: {error}</div>;
  return <div>Completing sign in...</div>;
}
