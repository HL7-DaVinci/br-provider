import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteCustomTemplate,
  getCustomTemplates,
  type OrderTemplate,
  saveCustomTemplate,
} from "@/lib/order-templates";
import {
  ENCOUNTER_ORDER_TYPES,
  type EncounterOrderResourceType,
  formatOrderType,
} from "@/lib/order-types";

const KNOWN_CODE_SYSTEMS = [
  {
    label: "HCPCS",
    uri: "http://www.cms.gov/Medicare/Coding/HCPCSReleaseCodeSets",
  },
  { label: "CPT", uri: "http://www.ama-assn.org/go/cpt" },
  { label: "RxNorm", uri: "http://www.nlm.nih.gov/research/umls/rxnorm" },
  { label: "SNOMED CT", uri: "http://snomed.info/sct" },
  { label: "LOINC", uri: "http://loinc.org" },
];

const OTHER_SYSTEM = "__other__";

interface CustomOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (template: OrderTemplate) => void;
  onDeleted: () => void;
}

export function CustomOrderDialog({
  open,
  onOpenChange,
  onSaved,
  onDeleted,
}: CustomOrderDialogProps) {
  const [resourceType, setResourceType] =
    useState<EncounterOrderResourceType>("DeviceRequest");
  const [systemChoice, setSystemChoice] = useState(KNOWN_CODE_SYSTEMS[0].uri);
  const [otherSystem, setOtherSystem] = useState("");
  const [code, setCode] = useState("");
  const [display, setDisplay] = useState("");
  const [savedTemplates, setSavedTemplates] =
    useState<OrderTemplate[]>(getCustomTemplates);

  const codeSystem =
    systemChoice === OTHER_SYSTEM ? otherSystem.trim() : systemChoice;
  const canSave = code.trim().length > 0 && codeSystem.length > 0;

  const handleSave = () => {
    if (!canSave) return;
    const template = saveCustomTemplate({
      code: code.trim(),
      display: display.trim(),
      codeSystem,
      resourceType,
    });
    setSavedTemplates(getCustomTemplates());
    setCode("");
    setDisplay("");
    onSaved(template);
    onOpenChange(false);
  };

  const handleDelete = (id: string) => {
    deleteCustomTemplate(id);
    setSavedTemplates(getCustomTemplates());
    onDeleted();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Custom Order Code</DialogTitle>
          <DialogDescription>
            Define any order code your target payer server responds to. Saved
            codes are kept in this browser and appear in the order dropdown.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Order Type</Label>
              <Select
                value={resourceType}
                onValueChange={(v) =>
                  setResourceType(v as EncounterOrderResourceType)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENCOUNTER_ORDER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {formatOrderType(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Code System</Label>
              <Select value={systemChoice} onValueChange={setSystemChoice}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KNOWN_CODE_SYSTEMS.map((s) => (
                    <SelectItem key={s.uri} value={s.uri}>
                      {s.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER_SYSTEM}>Other...</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {systemChoice === OTHER_SYSTEM && (
            <div className="space-y-1.5">
              <Label htmlFor="custom-order-system">Code System URI</Label>
              <Input
                id="custom-order-system"
                placeholder="http://example.org/my-codes"
                value={otherSystem}
                onChange={(e) => setOtherSystem(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="custom-order-code">Code</Label>
            <Input
              id="custom-order-code"
              placeholder="e.g. E0424"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="custom-order-display">Display</Label>
            <Input
              id="custom-order-display"
              placeholder="Defaults to the code if left blank"
              value={display}
              onChange={(e) => setDisplay(e.target.value)}
            />
          </div>

          {savedTemplates.length > 0 && (
            <div className="space-y-1.5">
              <Label>Saved Custom Orders</Label>
              <ul className="max-h-36 space-y-1 overflow-y-auto rounded-md border p-2">
                {savedTemplates.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="truncate">
                      <span className="font-mono text-xs text-muted-foreground">
                        {t.code}
                      </span>{" "}
                      {t.display}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({formatOrderType(t.resourceType)})
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      aria-label={`Delete ${t.display}`}
                      onClick={() => handleDelete(t.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            Save & Add to Encounter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
