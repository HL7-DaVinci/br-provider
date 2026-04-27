import { XIcon } from "lucide-react";
import { Dialog } from "radix-ui";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { cn } from "@/lib/utils";

interface TaskSheetDescriptor {
  title: string;
  description?: string;
  width?: string;
  actions?: ReactNode;
  content: ReactNode;
}

interface TaskSheetContextValue {
  openTaskSheet: (sheet: TaskSheetDescriptor) => void;
  closeTaskSheet: () => void;
}

const TaskSheetContext = createContext<TaskSheetContextValue | null>(null);

export function TaskSheetProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<TaskSheetDescriptor | null>(null);

  const closeTaskSheet = useCallback(() => {
    setSheet(null);
  }, []);

  const openTaskSheet = useCallback((nextSheet: TaskSheetDescriptor) => {
    setSheet(nextSheet);
  }, []);

  const value = useMemo(
    () => ({ openTaskSheet, closeTaskSheet }),
    [openTaskSheet, closeTaskSheet],
  );

  return (
    <TaskSheetContext.Provider value={value}>
      {children}
      <Dialog.Root
        open={!!sheet}
        onOpenChange={(open) => !open && setSheet(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content
            className={cn(
              "fixed right-0 top-5 bottom-5 z-50 flex flex-col rounded-l-lg border-l bg-background shadow-xl outline-none",
              "data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            )}
            style={{
              width: sheet?.width ?? "920px",
              maxWidth: "calc(100vw - 1rem)",
            }}
          >
            <div className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <Dialog.Title className="truncate text-sm font-semibold">
                  {sheet?.title}
                </Dialog.Title>
                {sheet?.description && (
                  <Dialog.Description className="truncate text-xs text-muted-foreground">
                    {sheet.description}
                  </Dialog.Description>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {sheet?.actions}
                <Dialog.Close className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring">
                  <XIcon className="h-4 w-4" />
                  <span className="sr-only">Close task sheet</span>
                </Dialog.Close>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">{sheet?.content}</div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </TaskSheetContext.Provider>
  );
}

export function useTaskSheet() {
  const context = useContext(TaskSheetContext);
  if (!context) {
    throw new Error("useTaskSheet must be used within TaskSheetProvider");
  }
  return context;
}
