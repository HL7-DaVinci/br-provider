import { TanStackDevtools } from "@tanstack/react-devtools";
import { createRootRoute, Outlet, useMatchRoute } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import type { Patient, Practitioner } from "fhir/r4";
import { Bell, Settings, Wrench } from "lucide-react";
import { useCallback, useState } from "react";
import {
  DevToolsDrawer,
  DRAWER_WIDTH,
} from "@/components/dev-tools/dev-tools-drawer";
import { ServerStatus } from "@/components/server-status";
import { SettingsDialog } from "@/components/settings-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { useResourceSearchWithParams } from "@/hooks/use-fhir-api";
import { useFhirServer } from "@/hooks/use-fhir-server";
import { NotFoundComponent } from "./-not-found";

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootComponent() {
  const matchRoute = useMatchRoute();
  const { serverUrl, isCustomServer } = useFhirServer();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPinned, setDrawerPinned] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<
    string | undefined
  >(undefined);
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(
    undefined,
  );
  const {
    isAuthenticated,
    authEnabled,
    displayName,
    fhirUserType,
    login,
    logout,
  } = useAuth();
  // Fetch all patients using generic FHIR search hook
  const { data, isLoading, isError } = useResourceSearchWithParams(
    serverUrl || "",
    "Patient",
    {}, // no search params
    undefined,
    50,
  );
  // Fetch all users (Practitioners) using generic FHIR search hook
  const {
    data: practitionerData,
    isLoading: practitionerLoading,
    isError: practitionerError,
  } = useResourceSearchWithParams(
    serverUrl || "",
    "Practitioner",
    {}, // no search params
    undefined,
    50,
  );
  const patients = (data?.entry?.map((entry) => entry.resource) ||
    []) as Patient[];
  const practitioners = (practitionerData?.entry?.map(
    (entry) => entry.resource,
  ) || []) as Practitioner[];

  const handlePinnedChange = useCallback((pinned: boolean) => {
    setDrawerPinned(pinned);
  }, []);

  // Login and callback pages have their own full-page layout; render without app shell
  if (matchRoute({ to: "/login" }) || matchRoute({ to: "/callback" })) {
    return <Outlet />;
  }

  return (
    <TooltipProvider>
      <div
        className="flex min-h-screen flex-col"
        style={{ overflow: "hidden" }}
      >
        <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b px-4 bg-[#7CAEAE] backdrop-blur-sm">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 justify-center">
              <img
                src="/header-logo.png"
                alt="Logo"
                className="h-11 w-full object-contain rounded-none"
              />
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="font-semibold text">User :</span>
                {authEnabled && isAuthenticated ? (
                  <div className="flex items-center gap-2">
                    <span className="text font-light bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                      {displayName || "Authenticated"} (
                      {fhirUserType || "Unknown"})
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={logout}
                      className="text-xs"
                    >
                      Sign Out
                    </Button>
                  </div>
                ) : authEnabled ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      login(isCustomServer ? serverUrl : undefined)
                    }
                    className="bg-white border border-gray-300 rounded-lg"
                  >
                    Sign In
                  </Button>
                ) : !authEnabled ? (
                  <Select
                    value={selectedUserId}
                    onValueChange={setSelectedUserId}
                  >
                    <SelectTrigger className="w-45 text font-light bg-white border border-gray-300 rounded-lg">
                      <SelectValue
                        placeholder={
                          practitionerLoading ? "Loading..." : "Select User"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {practitionerError && (
                        <SelectItem value="error">
                          Error loading users
                        </SelectItem>
                      )}
                      {practitioners
                        .filter(
                          (practitioner) =>
                            practitioner &&
                            practitioner.resourceType === "Practitioner",
                        )
                        .map((practitioner) => (
                          <SelectItem
                            key={practitioner.id || "unknown"}
                            value={practitioner.id || "unknown"}
                          >
                            {practitioner.name?.[0]?.text
                              ? practitioner.name[0].text
                              : practitioner.id || "Unknown"}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text">Patient :</span>
                <Select
                  value={selectedPatientId}
                  onValueChange={setSelectedPatientId}
                >
                  <SelectTrigger className="w-45 text font-light bg-white border border-gray-300 rounded-lg">
                    <SelectValue
                      placeholder={isLoading ? "Loading..." : "Select Patient"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {isError && (
                      <SelectItem value="error">
                        Error loading patients
                      </SelectItem>
                    )}
                    {patients
                      .filter(
                        (patient) =>
                          patient && patient.resourceType === "Patient",
                      )
                      .map((patient) => (
                        <SelectItem
                          key={patient.id || "unknown"}
                          value={patient.id || "unknown"}
                        >
                          {patient.name?.[0]?.text
                            ? patient.name[0].text
                            : patient.id || "Unknown"}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ServerStatus showLatency />
            {/* Notifications icon */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Notifications"
                >
                  <Bell className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Notifications</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <ThemeToggle />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">Toggle theme</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
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
                  className="h-8 w-8"
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Open settings"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Settings</TooltipContent>
            </Tooltip>
          </div>
        </header>

        <main
          className="flex-1 bg-background transition-[margin] duration-300 relative" // scrollable area with smooth margin transition when drawer opens/closes
          style={{
            marginRight: drawerOpen && drawerPinned ? DRAWER_WIDTH : undefined,
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
  );
}
