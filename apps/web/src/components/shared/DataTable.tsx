import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DataTableProps {
  title?: string;
  children?: ReactNode;
  className?: string;
}

/** TanStack Table wrapper — extended in later phases. */
export function DataTable({ title, children, className }: DataTableProps) {
  return (
    <div className={cn("w-full overflow-x-auto rounded-md border bg-card", className)}>
      {title ? <div className="border-b px-4 py-3 font-medium">{title}</div> : null}
      <div className="p-4">{children}</div>
    </div>
  );
}
