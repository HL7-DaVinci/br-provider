import { Info } from "lucide-react";
import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Column<T> {
  header: string;
  accessor: (row: T) => ReactNode;
  className?: string;
  /** Optional help text rendered as a hover tooltip on an info icon next to the header label. */
  tooltip?: string;
}

interface ClinicalTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor?: (row: T, index: number) => string | number;
  loading?: boolean;
  skeletonRows?: number;
  emptyMessage?: string;
  onRowClick?: (row: T, index: number) => void;
}

export function ClinicalTable<T>({
  columns,
  data,
  keyExtractor,
  loading = false,
  skeletonRows = 5,
  emptyMessage = "No data available",
  onRowClick,
}: ClinicalTableProps<T>) {
  if (!loading && data.length === 0) {
    return <p className="py-8 text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  const skeletonWidths = ["w-3/4", "w-1/2", "w-2/3", "w-1/3", "w-5/6"];

  return (
    <TooltipProvider delayDuration={150}>
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {columns.map((col) => (
                <th
                  key={col.header}
                  className={`h-9 px-3 text-left text-xs font-medium text-muted-foreground ${col.className ?? ""}`}
                >
                  {col.tooltip ? (
                    <span className="inline-flex items-center gap-1">
                      {col.header}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label={`About ${col.header}`}
                            className="text-muted-foreground/60 hover:text-foreground"
                          >
                            <Info className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          {col.tooltip}
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading
              ? Array.from({ length: skeletonRows }).map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders never reorder
                  <tr key={i}>
                    {columns.map((col, j) => (
                      <td key={col.header} className="px-3 py-2">
                        <div
                          className={`skeleton h-4 ${skeletonWidths[j % skeletonWidths.length]}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              : data.map((row, i) => (
                  <tr
                    key={keyExtractor ? keyExtractor(row, i) : i}
                    className={`stagger-item transition-colors hover:[box-shadow:inset_2px_0_0_var(--primary)] ${onRowClick ? "cursor-pointer" : ""}`}
                    style={{ animationDelay: `${i * 30}ms` }}
                    onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onRowClick(row, i);
                            }
                          }
                        : undefined
                    }
                    role={onRowClick ? "button" : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.header}
                        className={`px-3 py-2 ${col.className ?? ""}`}
                      >
                        {col.accessor(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  );
}
