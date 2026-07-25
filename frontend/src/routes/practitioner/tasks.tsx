import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { Bundle, Patient, Task } from "fhir/r4";
import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { ClinicalTable } from "@/components/clinical-table";
import {
  TaskStatusBadge,
  useTaskDetailSheet,
} from "@/components/task-detail-sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fhirFetch } from "@/hooks/use-fhir-api";
import { useFhirServer } from "@/hooks/use-fhir-server";
import { useAllTasks } from "@/hooks/use-pas";
import {
  formatClinicalDate,
  formatPatientName,
} from "@/lib/clinical-formatters";
import {
  isWorklistTask,
  partitionTasks,
  taskKind,
  taskPayerLabel,
  taskTypeLabel,
  taskWaitingSummary,
} from "@/lib/task-worklist";

export const Route = createFileRoute("/practitioner/tasks")({
  component: TaskWorklistPage,
});

function usePatientNames(patientIds: string[]) {
  const { serverUrl } = useFhirServer();
  return useQuery({
    queryKey: ["worklist-patient-names", serverUrl, patientIds],
    queryFn: async () => {
      const bundle = await fhirFetch<Bundle<Patient>>(
        `${serverUrl}/Patient?_id=${patientIds.join(",")}&_count=${patientIds.length}`,
      );
      const names = new Map<string, string>();
      for (const entry of bundle.entry ?? []) {
        const patient = entry.resource;
        if (patient?.id) {
          names.set(patient.id, formatPatientName(patient.name));
        }
      }
      return names;
    },
    enabled: !!serverUrl && patientIds.length > 0,
    staleTime: 60 * 1000,
  });
}

function patientIdOf(task: Task): string | undefined {
  const ref = task.for?.reference;
  return ref?.startsWith("Patient/") ? ref.split("/")[1] : undefined;
}

function TaskWorklistPage() {
  const [view, setView] = useState<"active" | "closed">("active");
  const [payerFilter, setPayerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const { data: tasks, isLoading, isError, error } = useAllTasks();
  const worklistTasks = useMemo(
    () => (tasks ?? []).filter(isWorklistTask),
    [tasks],
  );
  const { active, closed } = partitionTasks(worklistTasks);
  const viewTasks = view === "active" ? active : closed;

  const payers = [
    ...new Set(
      worklistTasks.map(taskPayerLabel).filter((p): p is string => !!p),
    ),
  ].sort();
  const statuses = [
    ...new Set(
      viewTasks
        .map((t) => t.status)
        .filter((s): s is NonNullable<Task["status"]> => !!s),
    ),
  ].sort();

  const filtered = viewTasks.filter(
    (task) =>
      (!payerFilter || taskPayerLabel(task) === payerFilter) &&
      (!statusFilter || task.status === statusFilter),
  );

  const patientIds = useMemo(
    () =>
      [
        ...new Set(
          worklistTasks.map(patientIdOf).filter((id): id is string => !!id),
        ),
      ].sort(),
    [worklistTasks],
  );
  const { data: patientNames } = usePatientNames(patientIds);

  const openTaskDetail = useTaskDetailSheet();
  const handleRowClick = (task: Task) => {
    // Final flag for a CDex $submit-attachment from the sheet: true when no
    // other open documentation Task shares this order.
    const siblingOpenDocTasks = active.filter(
      (t) =>
        t.id !== task.id &&
        taskKind(t) !== "tracking" &&
        t.focus?.reference &&
        t.focus.reference === task.focus?.reference,
    );
    openTaskDetail(task, {
      isFinalAttachment: siblingOpenDocTasks.length === 0,
    });
  };

  const columns = [
    {
      header: "Patient",
      accessor: (task: Task) => {
        const id = patientIdOf(task);
        if (!id) return "Unknown";
        const name = patientNames?.get(id) || id;
        return (
          <Link
            to="/patients/$patientId"
            params={{ patientId: id }}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-primary hover:underline"
          >
            {name}
          </Link>
        );
      },
    },
    {
      header: "Order",
      accessor: (task: Task) => task.focus?.reference ?? "",
      className: "font-mono text-xs",
    },
    {
      header: "Type",
      accessor: (task: Task) => taskTypeLabel(task),
    },
    {
      header: "Status",
      accessor: (task: Task) => <TaskStatusBadge status={task.status} />,
    },
    {
      header: view === "active" ? "Waiting on" : "Result",
      accessor: (task: Task) => taskWaitingSummary(task),
    },
    {
      header: "Payer",
      accessor: (task: Task) => taskPayerLabel(task) ?? "",
    },
    {
      header: "Last Updated",
      accessor: (task: Task) =>
        formatClinicalDate(task.meta?.lastUpdated ?? task.authoredOn),
    },
    {
      header: "",
      accessor: () => (
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
          Details
          <ChevronRight className="h-4 w-4" />
        </span>
      ),
      className: "w-20 text-right",
    },
  ];

  return (
    <div className="p-6 space-y-4 max-w-7xl">
      <div>
        <h1 className="text-lg font-semibold">Task Worklist</h1>
        <p className="text-sm text-muted-foreground">
          Payer documentation requests and prior authorization tracking across
          all patients
        </p>
      </div>

      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load tasks"}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={view}
          onValueChange={(v) => {
            setView(v as "active" | "closed");
            setStatusFilter("");
          }}
        >
          <TabsList>
            <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
            <TabsTrigger value="closed">
              Completed ({closed.length})
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <select
          value={payerFilter}
          onChange={(e) => setPayerFilter(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
          aria-label="Filter by payer"
        >
          <option value="">All payers</option>
          {payers.map((payer) => (
            <option key={payer} value={payer}>
              {payer}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>

      <ClinicalTable
        loading={isLoading}
        keyExtractor={(task) => task.id ?? ""}
        columns={columns}
        data={filtered}
        onRowClick={handleRowClick}
        emptyMessage={
          view === "active"
            ? "No active tasks. Payer documentation requests and PA tracking will appear here."
            : "No completed tasks yet."
        }
      />
    </div>
  );
}
