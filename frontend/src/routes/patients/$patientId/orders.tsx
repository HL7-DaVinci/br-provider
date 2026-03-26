import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/patients/$patientId/orders")({
  component: OrdersLayout,
});

function OrdersLayout() {
  return <Outlet />;
}
