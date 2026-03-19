import { TanStackDevtools } from "@tanstack/react-devtools";
import { createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { Settings, Wrench, Bell } from "lucide-react";
import { useCallback, useState} from "react";
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
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from "@/components/ui/select";
import { useResourceSearchWithParams } from "@/hooks/use-fhir-api";
import type { Patient } from "fhir/r4";
import { useFhirServer } from "@/hooks/use-fhir-server";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NotFoundComponent } from "./-not-found";

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootComponent() {
  const { serverUrl } = useFhirServer();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPinned, setDrawerPinned] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string | undefined>(undefined);
  const userName = "Test Practitioner"; // TODO: Replace with actual user name from login
  // Fetch all patients using generic FHIR search hook
  const { data, isLoading, isError } = useResourceSearchWithParams(
    serverUrl || "",
    "Patient",
    {}, // no search params
    undefined,
    50
  );
  const patients = (data?.entry?.map((entry) => entry.resource) || []) as Patient[];

  const handlePinnedChange = useCallback((pinned: boolean) => {
    setDrawerPinned(pinned);
  }, []);

  return (
    <TooltipProvider>
      <div className="flex min-h-screen flex-col" style={{ overflow: 'hidden' }}>
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
              <div className="flex items-center gap-2" style={{height: '100%'}}>
                <span className="font-semibold text text-lg leading-none">User :</span>
                <span className="text font-semibold text-lg leading-none">
                  {userName}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text text-lg leading-none">Patient :</span>
                <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
                  <SelectTrigger className="w-50 text font-normal bg-white border border-gray-300 rounded-lg">
                    <SelectValue placeholder={isLoading ? "Loading..." : "Select Patient"} />
                  </SelectTrigger>
                  <SelectContent>
                    {isError && <SelectItem value="error">Error loading patients</SelectItem>}
                    {patients
                      .filter((patient) => patient && patient.resourceType === "Patient")
                      .map((patient) => (
                        <SelectItem key={patient.id || "unknown"} value={patient.id || "unknown"}>
                          {patient.name && patient.name[0] && patient.name[0].text
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
            scrollbarColor: '#f3f4f6 #ffffff', // custom scrollbar color
          }}
        >
          <div className="absolute inset-0 flex flex-col overflow-auto ">
            {/* Show welcome portal on the root path */}
            {window.location.pathname === "/" &&   (
              <div className="p-6">
                <div className="text-lg font-semibold mb-2">Welcome to the Clinical Portal</div>
                {/*
                  Uncomment the code below to enable scroll test:
                  <div className="mb-4 text-base text-gray-700">Below are test items to help verify scrolling on this page.</div>
                  <div className="flex flex-col gap-2">
                    {Array.from({ length: 50 }, (_, i) => (
                      <div key={i} className="bg-white rounded shadow p-2">
                        Test User {i + 1}
                      </div>
                    ))}
                  </div>*/}
              </div>
            )}
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
