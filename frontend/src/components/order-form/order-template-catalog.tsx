import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOrderContext } from "@/hooks/use-order-context";
import {
  getAllTemplates,
  getCustomTemplates,
  getTemplateById,
  getTemplatesByCategory,
  type OrderTemplate,
  type TemplateCategory,
} from "@/lib/order-templates";
import { CustomOrderDialog } from "./custom-order-dialog";

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  DME: "Durable Medical Equipment",
  Services: "Services",
  Medications: "Medications",
};

export function OrderTemplateCatalog() {
  const { state, dispatch } = useOrderContext();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [customTemplates, setCustomTemplates] =
    useState<OrderTemplate[]>(getCustomTemplates);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);

  const grouped = getTemplatesByCategory();
  const selectedIds = new Set(state.selectedOrders.map((o) => o.templateId));

  const addTemplate = (template: OrderTemplate) => {
    if (selectedIds.has(template.id)) return;
    dispatch({
      type: "ADD_ORDER",
      payload: {
        templateId: template.id,
        template,
        customizations: {},
        expanded: false,
      },
    });
  };

  const handleAdd = () => {
    if (!selectedTemplateId) return;
    const template = getTemplateById(selectedTemplateId);
    if (!template) return;
    addTemplate(template);
    setSelectedTemplateId("");
  };

  const handleCustomSaved = (template: OrderTemplate) => {
    setCustomTemplates(getCustomTemplates());
    addTemplate(template);
  };

  const availableCount = getAllTemplates().length - state.selectedOrders.length;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Add Order</h3>
      <div className="flex gap-2">
        <Select
          value={selectedTemplateId}
          onValueChange={setSelectedTemplateId}
        >
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Select an order to add..." />
          </SelectTrigger>
          <SelectContent>
            {(
              Object.entries(grouped) as [
                TemplateCategory,
                typeof grouped.DME,
              ][]
            ).map(([category, templates]) => (
              <SelectGroup key={category}>
                <SelectLabel>{CATEGORY_LABELS[category]}</SelectLabel>
                {templates.map((t) => (
                  <SelectItem
                    key={t.id}
                    value={t.id}
                    disabled={selectedIds.has(t.id)}
                    description={t.description}
                  >
                    {t.code} - {t.display}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
            {customTemplates.length > 0 && (
              <SelectGroup>
                <SelectLabel>My Custom Orders</SelectLabel>
                {customTemplates.map((t) => (
                  <SelectItem
                    key={t.id}
                    value={t.id}
                    disabled={selectedIds.has(t.id)}
                    description={t.description}
                  >
                    {t.code} - {t.display}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        <Button
          onClick={handleAdd}
          disabled={!selectedTemplateId || selectedIds.has(selectedTemplateId)}
          size="sm"
          className="shrink-0"
        >
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>
      <div className="flex items-center justify-between">
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => setCustomDialogOpen(true)}
        >
          <Plus className="h-3 w-3 mr-1" />
          Custom order code...
        </Button>
        {availableCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {availableCount} order template{availableCount !== 1 ? "s" : ""}{" "}
            available
          </p>
        )}
      </div>
      <CustomOrderDialog
        open={customDialogOpen}
        onOpenChange={setCustomDialogOpen}
        onSaved={handleCustomSaved}
        onDeleted={() => setCustomTemplates(getCustomTemplates())}
      />
    </div>
  );
}
