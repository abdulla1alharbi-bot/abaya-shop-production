import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { getApiErrorMessage, isNotFoundError, isServerError } from "@/lib/apiErrors";

type Props = {
  /** Sync search field when navigating between invoices */
  currentInvoiceNo?: number;
};

export function InvoiceTopSearch({ currentInvoiceNo }: Props) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(currentInvoiceNo != null ? String(currentInvoiceNo) : "");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (currentInvoiceNo != null) setValue(String(currentInvoiceNo));
  }, [currentInvoiceNo]);

  const lookup = useMutation({
    mutationFn: async (no: string) => {
      const trimmed = no.trim();
      if (!/^\d+$/.test(trimmed)) throw new Error("Enter a valid invoice number");
      const res = await api.get<{ success: boolean; data: { id: string } }>("/invoices/lookup", {
        params: { no: trimmed },
      });
      return res.data.data;
    },
    onSuccess: (inv) => {
      navigate(`/invoices/${inv.id}`, { replace: true });
    },
  });

  const lookupErr = lookup.error as unknown;
  const lookupMessage = lookup.isError
    ? isNotFoundError(lookupErr)
      ? getApiErrorMessage(lookupErr, "No invoice with that number.")
      : isServerError(lookupErr)
        ? "Server error — try again or check that the database is up to date (run migrations)."
        : getApiErrorMessage(lookupErr, "Could not open invoice.")
    : null;

  const submit = () => lookup.mutate(value);

  return (
    <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm md:p-6">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="invoice-search" className="text-base font-semibold text-foreground">
            Search by Invoice Number
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              id="invoice-search"
              ref={inputRef}
              inputMode="numeric"
              autoComplete="off"
              placeholder="e.g. 1042"
              className="flex h-14 w-full rounded-xl border border-input bg-background pe-4 ps-12 text-lg font-mono shadow-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          {lookupMessage ? (
            <p className="text-sm text-destructive">{lookupMessage}</p>
          ) : (
            <p className="text-xs text-muted-foreground">Press Enter or tap Open to load the invoice.</p>
          )}
        </div>
        <Button
          type="submit"
          size="lg"
          className="h-14 min-w-[120px] shrink-0 rounded-xl text-base"
          disabled={lookup.isPending || !value.trim()}
        >
          {lookup.isPending ? "…" : "Open"}
        </Button>
      </form>
    </section>
  );
}
