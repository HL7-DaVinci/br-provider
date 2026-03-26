import { createFileRoute } from "@tanstack/react-router";
import { CdsResponsePanel } from "@/components/order-form/cds-response-panel";
import { OrderForm } from "@/components/order-form/order-form";
import { useAuth } from "@/hooks/use-auth";
import { OrderFormProvider } from "@/hooks/use-order-context";

export const Route = createFileRoute("/patients/$patientId/orders/new")({
  component: NewOrderPage,
});

function NewOrderPage() {
  const { patientId } = Route.useParams();
  const { fhirUser } = useAuth();

  // Extract practitioner ID from fhirUser reference (e.g. "Practitioner/123")
  const practitionerId = fhirUser?.replace(/^Practitioner\//, "") ?? "";

  return (
    <OrderFormProvider patientId={patientId} practitionerId={practitionerId}>
      <div className="flex h-full">
        <div className="flex-1 overflow-y-auto border-r p-4">
          <OrderForm />
        </div>
        <div className="w-100 min-w-87.5 overflow-y-auto p-4 bg-muted/30">
          <CdsResponsePanel />
        </div>
      </div>
    </OrderFormProvider>
  );
}
