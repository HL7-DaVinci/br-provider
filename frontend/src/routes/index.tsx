import { createFileRoute, Navigate } from "@tanstack/react-router";
import { LandingPage } from "@/components/landing-page";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const { isAuthenticated, isRestoringSession, authEnabled, fhirUserType } =
    useAuth();

  if (authEnabled && isRestoringSession) {
    return null;
  }

  if (authEnabled && !isAuthenticated) {
    return <LandingPage />;
  }

  if (fhirUserType === "Patient") {
    return <Navigate to="/patient" />;
  }

  return <Navigate to="/practitioner" />;
}
