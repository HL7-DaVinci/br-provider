import { createFileRoute, Link } from "@tanstack/react-router";
import type { Appointment } from "fhir/r4";
import {
  Calendar,
  CalendarPlus,
  ChevronRight,
  FileText,
  Shield,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppointments } from "@/hooks/use-appointment-api";
import { useAuth } from "@/hooks/use-auth";
import { formatClinicalDate } from "@/lib/clinical-formatters";

export const Route = createFileRoute("/patient/")({
  component: PatientDashboard,
});

function formatTime(dateStr?: string): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getPractitionerDisplay(a: Appointment): string {
  const practitioner = a.participant?.find((p) =>
    p.actor?.reference?.startsWith("Practitioner/"),
  );
  return practitioner?.actor?.display ?? "Not assigned";
}

function PatientDashboard() {
  const { fhirUser } = useAuth();
  const patientId = fhirUser?.replace(/^Patient\//, "") ?? "";

  const { data: appointmentData } = useAppointments(patientId);

  const upcomingAppointments: Appointment[] =
    appointmentData?.entry
      ?.map((e) => e.resource)
      .filter(
        (r): r is Appointment =>
          r?.resourceType === "Appointment" &&
          (r.status === "booked" || r.status === "proposed"),
      )
      .slice(0, 3) ?? [];

  return (
    <div className="p-6 md:p-10 max-w-6xl space-y-6">
      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-3">
        <Link to="/patient/appointments" className="block">
          <Card className="h-full transition-colors hover:bg-muted/50 cursor-pointer">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-600" />
                My Appointments
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                View and manage your scheduled visits.
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link to="/patient/coverage" className="block">
          <Card className="h-full transition-colors hover:bg-muted/50 cursor-pointer">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-green-600" />
                My Coverage
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Review your insurance coverage and prior authorizations.
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link to="/patient/documentation" className="block">
          <Card className="h-full transition-colors hover:bg-muted/50 cursor-pointer">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-amber-600" />
                Documentation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Complete required documentation for your visits.
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Upcoming Appointments */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Upcoming Appointments</CardTitle>
            <Link to="/patient/appointments/new">
              <Button variant="outline" size="sm" className="h-7 text-xs">
                <CalendarPlus className="mr-1 h-3 w-3" />
                Book New
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {upcomingAppointments.length > 0 ? (
            <div className="divide-y divide-border">
              {upcomingAppointments.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                >
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">
                      {a.serviceType?.[0]?.text ?? "Appointment"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {getPractitionerDisplay(a)} &middot;{" "}
                      {formatClinicalDate(a.start)} at {formatTime(a.start)}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="text-xs capitalize shrink-0"
                  >
                    {a.status}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">
              No upcoming appointments.{" "}
              <Link
                to="/patient/appointments/new"
                className="text-primary hover:underline"
              >
                Book one now
              </Link>
              .
            </p>
          )}

          {upcomingAppointments.length > 0 && (
            <Link
              to="/patient/appointments"
              className="text-xs text-primary hover:underline inline-flex items-center gap-0.5 mt-3"
            >
              View all appointments
              <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
