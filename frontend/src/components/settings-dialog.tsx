import { Server } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PayerTab } from "./settings/payer-tab";
import { ProviderTab } from "./settings/provider-tab";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Server className="h-5 w-5" />
            </span>
            Settings
          </DialogTitle>
          <DialogDescription>
            Configure provider and payer server connections
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="provider">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="provider">Provider/EHR</TabsTrigger>
            <TabsTrigger value="payer">Payer</TabsTrigger>
          </TabsList>
          <TabsContent value="provider">
            <ProviderTab onClose={() => onOpenChange(false)} />
          </TabsContent>
          <TabsContent value="payer">
            <PayerTab onClose={() => onOpenChange(false)} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
