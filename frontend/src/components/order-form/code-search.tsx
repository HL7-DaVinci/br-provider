import { useQuery } from "@tanstack/react-query";
import type { ValueSet } from "fhir/r4";
import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fhirFetch } from "@/hooks/use-fhir-api";
import { useFhirServer } from "@/hooks/use-fhir-server";

interface CodeOption {
  code: string;
  display: string;
  system: string;
}

interface CodeSearchProps {
  label: string;
  /** ValueSet URL to expand against, or undefined for free-text only */
  valueSetUrl?: string;
  value?: { code?: string; display?: string; system?: string };
  onChange: (value: { code: string; display: string; system?: string }) => void;
  placeholder?: string;
}

/**
 * Typeahead search against ValueSet/$expand with debounced input.
 * Falls back to free-text CodeableConcept entry when no valueSetUrl
 * is provided or when $expand is unavailable.
 */
export function CodeSearch({
  label,
  valueSetUrl,
  value,
  onChange,
  placeholder = "Search codes...",
}: CodeSearchProps) {
  const { serverUrl } = useFhirServer();
  const [filter, setFilter] = useState("");
  const [debouncedFilter, setDebouncedFilter] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Debounce the filter input by 300ms
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedFilter(filter), 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [filter]);

  const { data: options, isFetching } = useQuery({
    queryKey: ["valueset-expand", valueSetUrl, debouncedFilter, serverUrl],
    queryFn: async (): Promise<CodeOption[]> => {
      const params = new URLSearchParams({
        url: valueSetUrl ?? "",
        filter: debouncedFilter,
        count: "20",
      });
      const vs = await fhirFetch<ValueSet>(
        `${serverUrl}/ValueSet/$expand?${params.toString()}`,
      );
      return (
        vs.expansion?.contains?.map((c) => ({
          code: c.code ?? "",
          display: c.display ?? c.code ?? "",
          system: c.system ?? "",
        })) ?? []
      );
    },
    enabled: !!serverUrl && !!valueSetUrl && debouncedFilter.length >= 2,
    staleTime: 60 * 1000,
    retry: 0,
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSelect = useCallback(
    (option: CodeOption) => {
      onChange({
        code: option.code,
        display: option.display,
        system: option.system,
      });
      setFilter(option.display);
      setIsOpen(false);
    },
    [onChange],
  );

  // Free-text fallback: treat typed text as display with no code
  const handleFreeText = useCallback(() => {
    if (filter && (!value?.display || filter !== value.display)) {
      onChange({ code: "", display: filter });
    }
    setIsOpen(false);
  }, [filter, value, onChange]);

  const displayValue = value?.display
    ? `${value.display}${value.code ? ` (${value.code})` : ""}`
    : "";

  return (
    <div ref={containerRef} className="relative space-y-1.5">
      <Label>{label}</Label>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder={placeholder}
          value={filter || displayValue}
          onChange={(e) => {
            setFilter(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (filter.length >= 2) setIsOpen(true);
          }}
          onBlur={() => {
            // Small delay so click on option registers first
            setTimeout(handleFreeText, 200);
          }}
        />
        {isFetching && (
          <span className="absolute right-2.5 top-2.5 text-xs text-muted-foreground">
            ...
          </span>
        )}
      </div>

      {isOpen && options && options.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
          {options.map((opt) => (
            <button
              key={`${opt.system}|${opt.code}`}
              type="button"
              className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(opt)}
            >
              <span className="font-mono text-xs text-muted-foreground shrink-0">
                {opt.code}
              </span>
              <span>{opt.display}</span>
            </button>
          ))}
        </div>
      )}

      {isOpen &&
        debouncedFilter.length >= 2 &&
        !isFetching &&
        (!options || options.length === 0) && (
          <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-3 text-sm text-muted-foreground shadow-md">
            No matching codes found. Text will be used as-is.
          </div>
        )}
    </div>
  );
}
