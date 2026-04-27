import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Appointment, Bundle, Practitioner } from "fhir/r4";
import { fhirProxyUrl } from "@/lib/api";
import { fhirFetch } from "./use-fhir-api";
import { useFhirServer } from "./use-fhir-server";

export function useAppointment(appointmentId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Appointment", "detail", appointmentId, serverUrl],
    queryFn: () =>
      fhirFetch<Appointment>(`${serverUrl}/Appointment/${appointmentId}`),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!appointmentId,
  });
}

export function useAppointments(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Appointment", patientId, serverUrl],
    queryFn: () =>
      fhirFetch<Bundle<Appointment>>(
        `${serverUrl}/Appointment?patient=${patientId}&_sort=-date&_count=20`,
      ),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function usePractitioners() {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Practitioner", "list", serverUrl],
    queryFn: () =>
      fhirFetch<Bundle<Practitioner>>(
        `${serverUrl}/Practitioner?_count=50&_sort=family`,
      ),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    enabled: !!serverUrl,
  });
}

export function useDeleteAppointment() {
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const proxyUrl = fhirProxyUrl(`${serverUrl}/Appointment/${id}`);
      const response = await fetch(proxyUrl, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Failed to delete appointment: ${response.status}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fhir", "Appointment"] });
    },
  });
}

export function useCreateAppointment() {
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (appointment: Appointment) => {
      const proxyUrl = fhirProxyUrl(`${serverUrl}/Appointment`);
      const response = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/fhir+json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(appointment),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Failed to create appointment: ${response.status}`);
      }

      return (await response.json()) as Appointment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fhir", "Appointment"] });
    },
  });
}
