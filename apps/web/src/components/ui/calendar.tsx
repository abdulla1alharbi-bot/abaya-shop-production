import * as React from "react";
import { DayPicker } from "react-day-picker";
import { cn } from "@/lib/utils";
import "react-day-picker/style.css";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * Calendar for date-only selection (react-day-picker v9).
 * Styles from `react-day-picker/style.css`; accent uses .rdp-root variables.
 */
export function Calendar({ className, ...props }: CalendarProps) {
  return (
    <DayPicker
      className={cn("rdp-root [--rdp-accent-color:hsl(var(--primary))] [--rdp-accent-background-color:hsl(var(--accent))]", className)}
      {...props}
    />
  );
}
