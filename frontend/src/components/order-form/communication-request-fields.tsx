import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const MEDIUM_OPTIONS = [
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "fax", label: "Fax" },
  { value: "written", label: "Written" },
] as const;

const PRIORITY_OPTIONS = [
  { value: "routine", label: "Routine" },
  { value: "urgent", label: "Urgent" },
  { value: "asap", label: "ASAP" },
  { value: "stat", label: "Stat" },
] as const;

interface CommunicationRequestFieldsProps {
  data: Record<string, unknown>;
  onUpdate: (fields: Record<string, unknown>) => void;
}

export function CommunicationRequestFields({
  data,
  onUpdate,
}: CommunicationRequestFieldsProps) {
  return (
    <div className="space-y-4">
      {/* Payload content */}
      <div className="space-y-1.5">
        <Label>Message Content</Label>
        <Textarea
          placeholder="Enter communication content..."
          value={(data.payloadContent as string) ?? ""}
          onChange={(e) => onUpdate({ payloadContent: e.target.value })}
          rows={4}
        />
      </div>

      {/* Medium */}
      <div className="space-y-1.5">
        <Label>Medium</Label>
        <Select
          value={(data.medium as string) ?? ""}
          onValueChange={(v) => onUpdate({ medium: v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select medium" />
          </SelectTrigger>
          <SelectContent>
            {MEDIUM_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Communication priority (separate from shared order priority) */}
      <div className="space-y-1.5">
        <Label>Communication Priority</Label>
        <Select
          value={(data.commPriority as string) ?? "routine"}
          onValueChange={(v) => onUpdate({ commPriority: v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
