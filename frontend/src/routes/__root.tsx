import { TanStackDevtools } from "@tanstack/react-devtools";
import {
  createRootRoute,
  Link,
  Outlet,
  useMatchRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import { Activity, LogIn, LogOut, Settings, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  DevToolsDrawer,
  DRAWER_WIDTH,
} from "@/components/dev-tools/dev-tools-drawer";
import { SettingsDialog } from "@/components/settings-dialog";
import { TaskSheetProvider, useTaskSheet } from "@/components/task-sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { useServerActivityFeed } from "@/hooks/use-server-activity";

import { NotFoundComponent } from "./-not-found";

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

// Stable search object so the redirect-to-login navigate has the same
// reference every render (props churn is what makes TanStack's <Navigate>
// re-fire its layout effect each render).
const LOGIN_SEARCH = { error: undefined } as const;

// Lives inside TaskSheetProvider so the toast's View action can dismiss an
// open task sheet before revealing the dev-tools drawer.
function ServerActivityBridge({ onView }: { onView: () => void }) {
  const { closeTaskSheet } = useTaskSheet();
  const handleView = useCallback(() => {
    closeTaskSheet();
    onView();
  }, [closeTaskSheet, onView]);
  useServerActivityFeed(handleView);
  return null;
}

function RootComponent() {
  const matchRoute = useMatchRoute();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPinned, setDrawerPinned] = useState(false);
  const {
    isAuthenticated,
    isRestoringSession,
    authEnabled,
    displayName,
    fhirUserType,
    logout,
  } = useAuth();

  const handlePinnedChange = useCallback((pinned: boolean) => {
    setDrawerPinned(pinned);
  }, []);

  // Toast "View" must close any open modal first: a modal task sheet puts pointer-events:none on
  // the body and its overlay sits above the drawer, so an opened drawer would be inert behind it.
  const openDrawerFromToast = useCallback(() => {
    setSettingsOpen(false);
    setDrawerOpen(true);
  }, []);

  // Determine route gating in pure expressions so the redirect effect below
  // sees stable boolean deps. Using <Navigate> here re-fires its layout
  // effect on every render (its props are recreated by JSX even when their
  // contents are stable), which races with auth-state churn during a
  // server-switch + signOut and overflows React's update budget.
  // /callback and /dtr/launch complete their own auth flows and must
  // stay reachable before a session exists.
  const isAuthFlowRoute =
    matchRoute({ to: "/callback" }) || matchRoute({ to: "/dtr/launch" });
  const isPublicRoute = matchRoute({ to: "/" }) || matchRoute({ to: "/login" });
  const needsLoginRedirect =
    authEnabled &&
    !isRestoringSession &&
    !isAuthenticated &&
    !isPublicRoute &&
    !isAuthFlowRoute;
  const isPatientSide =
    pathname === "/patient" || pathname.startsWith("/patient/");
  const isPractitionerSide =
    pathname === "/practitioner" ||
    pathname.startsWith("/practitioner/") ||
    pathname.startsWith("/patients/");
  const wrongSideRedirect =
    authEnabled &&
    isAuthenticated &&
    fhirUserType &&
    !isPublicRoute &&
    !isAuthFlowRoute
      ? fhirUserType === "Patient" && isPractitionerSide
        ? "/patient"
        : fhirUserType === "Practitioner" && isPatientSide
          ? "/practitioner"
          : null
      : null;

  useEffect(() => {
    if (needsLoginRedirect) {
      navigate({ to: "/login", search: LOGIN_SEARCH });
    }
  }, [needsLoginRedirect, navigate]);

  useEffect(() => {
    if (wrongSideRedirect) {
      navigate({ to: wrongSideRedirect });
    }
  }, [wrongSideRedirect, navigate]);

  // Auth flow pages have their own full-page layout without the app shell
  if (isAuthFlowRoute) {
    return <Outlet />;
  }

  if (authEnabled && isRestoringSession && !isPublicRoute) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Restoring session...
      </div>
    );
  }

  if (needsLoginRedirect || wrongSideRedirect) {
    return null;
  }

  return (
    <TaskSheetProvider>
      <ServerActivityBridge onView={openDrawerFromToast} />
      <TooltipProvider>
        <div
          className="flex min-h-screen flex-col"
          style={{ overflow: "hidden" }}
        >
          <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b px-4 bg-brand">
            {/* Left: logo + practitioner navigation */}
            <div className="flex h-full items-center gap-3">
              <Link to="/" className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-foreground/15 text-brand-foreground">
                  <Activity className="h-4 w-4" strokeWidth={2.5} />
                </div>
                <span className="leading-none">
                  <span className="block text-sm font-semibold tracking-tight text-brand-foreground">
                    Da Vinci BR Provider
                  </span>
                </span>
              </Link>
              {isPractitionerSide && (
                <>
                  <div className="h-5 w-px bg-brand-foreground/20" />
                  <nav className="flex h-full items-stretch">
                    <Link
                      to="/practitioner"
                      activeOptions={{ exact: true }}
                      className={`relative flex items-center px-3 text-[13px] font-medium tracking-wide text-brand-foreground/60 transition-colors hover:text-brand-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-t-full after:bg-transparent after:transition-colors ${
                        pathname.startsWith("/patients/")
                          ? "text-brand-foreground after:bg-brand-foreground/90"
                          : ""
                      }`}
                      activeProps={{
                        className:
                          "text-brand-foreground after:bg-brand-foreground/90",
                      }}
                    >
                      Patients
                    </Link>
                    <Link
                      to="/practitioner/tasks"
                      className="relative flex items-center px-3 text-[13px] font-medium tracking-wide text-brand-foreground/60 transition-colors hover:text-brand-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-t-full after:bg-transparent after:transition-colors"
                      activeProps={{
                        className:
                          "text-brand-foreground after:bg-brand-foreground/90",
                      }}
                    >
                      Tasks
                    </Link>
                  </nav>
                </>
              )}
            </div>

            {/* Right: utilities + user */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-brand-foreground/70 hover:text-brand-foreground hover:bg-brand-foreground/10"
                    onClick={() => setDrawerOpen((prev) => !prev)}
                    aria-label="Toggle dev tools"
                  >
                    <Wrench className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Dev Tools</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-brand-foreground/70 hover:text-brand-foreground hover:bg-brand-foreground/10"
                    onClick={() => setSettingsOpen(true)}
                    aria-label="Open settings"
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Settings</TooltipContent>
              </Tooltip>

              {/* Divider between utilities and identity */}
              <div className="mx-1.5 h-5 w-px bg-brand-foreground/20" />

              <ThemeToggle />

              {authEnabled && isAuthenticated && (
                <div className="flex items-center gap-2 pl-1">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-foreground/15 text-[11px] font-medium text-brand-foreground">
                    {(displayName || "?")
                      .replace(/^(Mr\.|Ms\.|Mrs\.|Dr\.)\s*/i, "")
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .slice(0, 2)}
                  </div>
                  <div className="leading-none">
                    <div className="text-[13px] font-medium text-brand-foreground">
                      {displayName || "Authenticated"}
                    </div>
                    {fhirUserType && (
                      <div className="text-[10px] text-brand-foreground/75 mt-0.5">
                        {fhirUserType}
                      </div>
                    )}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={logout}
                        className="h-7 w-7 text-brand-foreground/75 hover:text-brand-foreground hover:bg-brand-foreground/10"
                        aria-label="Sign out"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Sign out</TooltipContent>
                  </Tooltip>
                </div>
              )}

              {authEnabled && !isAuthenticated && !isRestoringSession && (
                <Link
                  to="/login"
                  search={{ error: undefined }}
                  className="flex items-center gap-1.5 pl-1 text-[13px] font-medium text-brand-foreground/75 hover:text-brand-foreground transition-colors"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  Sign In
                </Link>
              )}
            </div>
          </header>

          <main
            className="flex-1 bg-background transition-[margin] duration-300 relative" // scrollable area with smooth margin transition when drawer opens/closes
            style={{
              marginRight:
                drawerOpen && drawerPinned ? DRAWER_WIDTH : undefined,
              scrollbarColor: "#f3f4f6 #ffffff", // custom scrollbar color
            }}
          >
            <div className="absolute inset-0 flex flex-col overflow-auto ">
              <Outlet />
            </div>
          </main>
        </div>

        <DevToolsDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onPinnedChange={handlePinnedChange}
        />

        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
      </TooltipProvider>
    </TaskSheetProvider>
  );
}
