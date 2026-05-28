import { useId, useState } from "react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function formatReportDate(d: Date): string {
  return format(d, "d MMMM yyyy", { locale: ar });
}

function DatePickerField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            aria-label={`${label}: ${formatReportDate(value)}`}
            className={cn(
              "h-10 min-w-[220px] justify-start gap-2 text-start font-normal",
              "border-input bg-background",
            )}
          >
            <CalendarIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
            <span className="truncate">{formatReportDate(value)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            required
            selected={value}
            onSelect={(d) => {
              if (d) {
                onChange(d);
                setOpen(false);
              }
            }}
            locale={ar}
            captionLayout="dropdown"
            fromYear={2020}
            toYear={new Date().getFullYear() + 1}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

type ReportDateRangeBarProps = {
  from: Date;
  to: Date;
  onFromChange: (d: Date) => void;
  onToChange: (d: Date) => void;
  onApply: () => void;
  isFetching?: boolean;
};

export function ReportDateRangeBar({
  from,
  to,
  onFromChange,
  onToChange,
  onApply,
  isFetching,
}: ReportDateRangeBarProps) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
      <DatePickerField label="من تاريخ" value={from} onChange={onFromChange} />
      <DatePickerField label="إلى تاريخ" value={to} onChange={onToChange} />
      <Button type="button" variant="secondary" className="h-10" onClick={onApply} disabled={isFetching}>
        {isFetching ? "جاري…" : "تطبيق"}
      </Button>
    </div>
  );
}
