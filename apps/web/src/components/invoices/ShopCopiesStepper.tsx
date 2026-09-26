import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SHOP_COPIES_MAX } from "@/lib/printInvoice";

/**
 * How many shop copies to print with this invoice, picked by the seller at the
 * print button: one order needs a sheet per worker, another needs just one.
 */
export function ShopCopiesStepper({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-1.5 ${className ?? ""}`}>
      <span className="text-sm font-medium">{t("pos.pay.shopCopies")}</span>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={value <= 0}
          onClick={() => onChange(value - 1)}
          aria-label="-"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span className="w-8 text-center text-lg font-bold tabular-nums">{value}</span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={value >= SHOP_COPIES_MAX}
          onClick={() => onChange(value + 1)}
          aria-label="+"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
