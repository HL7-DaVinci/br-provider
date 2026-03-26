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
  getTemplateById,
  getTemplatesByCategory,
  type TemplateCategory,
} from "@/lib/order-templates";

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  DME: "Durable Medical Equipment",
  Services: "Services",
};

export function OrderTemplateCatalog() {
  const { state, dispatch } = useOrderContext();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  const grouped = getTemplatesByCategory();
  const selectedIds = new Set(state.selectedOrders.map((o) => o.templateId));

  const handleAdd = () => {
    if (!selectedTemplateId) return;
    const template = getTemplateById(selectedTemplateId);
    if (!template || selectedIds.has(template.id)) return;

    dispatch({
      type: "ADD_ORDER",
      payload: {
        templateId: template.id,
        template,
        customizations: {},
        expanded: false,
      },
    });
    setSelectedTemplateId("");
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
                  >
                    {t.code} — {t.display}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
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
      {availableCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {availableCount} order template{availableCount !== 1 ? "s" : ""}{" "}
          available
        </p>
      )}
    </div>
  );
}
