import { useOrderContext } from "@/hooks/use-order-context";
import type { SelectedOrder } from "@/lib/order-templates";
import { OrderFields } from "./order-fields";

/**
 * Renders type-specific customization fields for a selected order template.
 * Bridges between the per-order customization data in context and the
 * existing resource-specific field components via OrderFields.
 */
export function OrderCustomizationFields({ order }: { order: SelectedOrder }) {
  const { dispatch } = useOrderContext();

  const onUpdate = (fields: Record<string, unknown>) =>
    dispatch({
      type: "UPDATE_ORDER_CUSTOMIZATION",
      payload: { templateId: order.templateId, fields },
    });

  return (
    <OrderFields
      orderType={order.template.resourceType}
      data={order.customizations}
      onUpdate={onUpdate}
    />
  );
}
