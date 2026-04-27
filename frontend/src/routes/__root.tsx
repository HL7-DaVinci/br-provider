import { TanStackDevtools } from "@tanstack/react-devtools";
import {
  createRootRoute,
  Link,
  Navigate,
  Outlet,
  useMatchRoute,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import { Bell, LogIn, LogOut, Settings, Wrench } from "lucide-react";
import { useCallback, useState } from "react";
import {
  DevToolsDrawer,
  DRAWER_WIDTH,
} from "@/components/dev-tools/dev-tools-drawer";
import { SettingsDialog } from "@/components/settings-dialog";
import { TaskSheetProvider } from "@/components/task-sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";

import { NotFoundComponent } from "./-not-found";

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootComponent() {
  const matchRoute = useMatchRoute();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
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

  // Callback page has its own full-page layout; render without app shell
  if (matchRoute({ to: "/callback" })) {
    return <Outlet />;
  }

  // Protected routes: everything except / and /login requires authentication
  const isPublicRoute = matchRoute({ to: "/" }) || matchRoute({ to: "/login" });
  if (authEnabled && isRestoringSession && !isPublicRoute) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Restoring session...
      </div>
    );
  }

  if (authEnabled && !isAuthenticated && !isPublicRoute) {
    return <Navigate to="/login" search={{ error: undefined }} />;
  }

  if (authEnabled && isAuthenticated && fhirUserType && !isPublicRoute) {
    const isPatientSide =
      pathname === "/patient" || pathname.startsWith("/patient/");
    const isPractitionerSide =
      pathname === "/practitioner" ||
      pathname.startsWith("/practitioner/") ||
      pathname.startsWith("/patients/");
    if (fhirUserType === "Patient" && isPractitionerSide) {
      return <Navigate to="/patient" />;
    }
    if (fhirUserType === "Practitioner" && isPatientSide) {
      return <Navigate to="/practitioner" />;
    }
  }

  return (
    <TaskSheetProvider>
      <TooltipProvider>
        <div
          className="flex min-h-screen flex-col"
          style={{ overflow: "hidden" }}
        >
          <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b px-4 bg-brand">
            {/* Left: logo */}
            <img
              src="/header-logo.png"
              alt="Logo"
              className="h-11 object-contain"
            />

            {/* Right: utilities + user */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-brand-foreground/70 hover:text-brand-foreground hover:bg-brand-foreground/10"
                    aria-label="Notifications"
                  >
                    <Bell className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Notifications</TooltipContent>
              </Tooltip>

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
