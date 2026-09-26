import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackagePlus, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatAED } from "@/lib/money";
import { usePermissions } from "@/hooks/usePermissions";

type ReadyMadeRow = {
  id: string;
  sku: string;
  name: string;
  priceFils: number;
  stockQty: number;
  isActive: boolean;
  catalogImageUrl: string | null;
  category: { name: string };
  createdFromInvoiceNo?: number | null;
  createdFromJobNo?: number | null;
  isSample?: boolean;
};

/** Ready-made retail SKUs only — excludes tailoring service products (`isService`). */
export function ReadyMadeProductsPage() {
  const { can } = usePermissions();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [showDeleted, setShowDeleted] = useState(false);
  const [stockFor, setStockFor] = useState<ReadyMadeRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["products", "ready-made", { showDeleted }],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { items: ReadyMadeRow[] } }>("/products", {
        // "Deleted" is a soft delete (isActive=false): past invoices still point at
        // the product, so it is hidden rather than removed.
        params: { limit: 300, retailOnly: "true", ...(showDeleted ? {} : { activeOnly: "true" }) },
      });
      return res.data.data.items;
    },
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["products"] });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/products/${id}`);
    },
    onSuccess: refresh,
  });

  const restore = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/products/${id}`, { isActive: true });
    },
    onSuccess: refresh,
  });

  const rowError = remove.error ?? restore.error;

  return (
    <div>
      <PageHeader
        title={t("readyMade.title")}
        description={t("readyMade.description", { defaultValue: "Shelf products only (ready sale at cashier). Does not include tailoring models or fabric rolls." })}
        actions={
          can("readyMade.create") ? (
            <Button asChild size="sm">
              <Link to="/ready-made/new">
                <Plus className="me-1 h-4 w-4" />
                {t("common.add")}
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={showDeleted}
            onChange={(e) => setShowDeleted(e.target.checked)}
          />
          {t("readyMade.showDeleted")}
        </label>
        {notice ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p> : null}
        {rowError ? <p className="text-sm text-destructive">{getApiErrorMessage(rowError)}</p> : null}
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-3 py-3 text-start font-medium">{t("readyMade.colImage")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("readyMade.colCode")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("readyMade.colName")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("readyMade.colCategory")}</th>
              <th className="px-4 py-3 text-end font-medium">{t("readyMade.colPrice")}</th>
              <th className="px-4 py-3 text-end font-medium">{t("readyMade.colStock")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("readyMade.colStatus")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("readyMade.colSource")}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  {t("common.loadingData")}
                </td>
              </tr>
            ) : !data?.length ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  {t("readyMade.emptyMessage", { defaultValue: "No ready-made products yet." })}
                </td>
              </tr>
            ) : (
              data.map((p) => (
                <tr
                  key={p.id}
                  className={`border-b border-border/60 last:border-0 ${p.isActive ? "" : "opacity-60"}`}
                >
                  <td className="px-3 py-2">
                    {p.catalogImageUrl ? (
                      <img
                        src={p.catalogImageUrl}
                        alt=""
                        className="h-10 w-10 rounded border object-cover"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{p.sku}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span>{p.name}</span>
                      {p.isSample ? (
                        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                          {t("readyMade.sampleBadge")}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{p.category.name}</td>
                  <td className="px-4 py-2.5 text-end">{formatAED(p.priceFils)}</td>
                  <td
                    className={`px-4 py-2.5 text-end tabular-nums ${p.stockQty <= 0 ? "font-semibold text-destructive" : ""}`}
                  >
                    {p.stockQty}
                  </td>
                  <td className="px-4 py-2.5">
                    {p.isActive ? t("status.active") : t("readyMade.deletedBadge")}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {typeof p.createdFromInvoiceNo === "number" ? (
                      <span className="rounded-md border border-cyan-300 bg-cyan-50 px-2 py-1 font-medium text-cyan-900 dark:border-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-100">
                        {t("readyMade.createdFromInvoice", { invoiceNo: p.createdFromInvoiceNo })}
                        {typeof p.createdFromJobNo === "number" ? t("readyMade.createdFromJobSuffix", { jobNo: p.createdFromJobNo }) : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                      {can("readyMade.edit") && p.isActive ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1"
                          onClick={() => {
                            setNotice(null);
                            setStockFor(p);
                          }}
                        >
                          <PackagePlus className="h-4 w-4" aria-hidden="true" />
                          {t("readyMade.addStock")}
                        </Button>
                      ) : null}
                      {can("readyMade.edit") ? (
                        <Button variant="link" size="sm" className="h-8 px-2" asChild>
                          <Link to={`/ready-made/${p.id}/edit`}>{t("common.edit")}</Link>
                        </Button>
                      ) : null}
                      {can("readyMade.delete") && p.isActive ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          title={t("readyMade.deleteProduct")}
                          aria-label={t("readyMade.deleteProduct")}
                          disabled={remove.isPending}
                          onClick={() => {
                            if (window.confirm(t("readyMade.confirmDelete", { name: p.name }))) remove.mutate(p.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      ) : null}
                      {can("readyMade.edit") && !p.isActive ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8"
                          disabled={restore.isPending}
                          onClick={() => restore.mutate(p.id)}
                        >
                          {t("readyMade.restoreProduct")}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <AddStockDialog
        product={stockFor}
        onClose={() => setStockFor(null)}
        onAdded={(qty, total) => {
          setNotice(t("readyMade.addStockDone", { qty, total }));
          refresh();
        }}
      />
    </div>
  );
}

function AddStockDialog({
  product,
  onClose,
  onAdded,
}: {
  product: ReadyMadeRow | null;
  onClose: () => void;
  onAdded: (qty: number, total: number) => void;
}) {
  const { t } = useTranslation();
  const [qtyInput, setQtyInput] = useState("");

  const add = useMutation({
    mutationFn: async () => {
      if (!product) return null;
      const qty = /^\d+$/.test(qtyInput.trim()) ? parseInt(qtyInput.trim(), 10) : 0;
      if (qty < 1) throw new Error(t("readyMade.addStockInvalid"));
      const res = await api.post<{ data: { stockQty: number } }>(`/products/${product.id}/stock`, { qty });
      return { qty, total: res.data.data.stockQty };
    },
    onSuccess: (result) => {
      if (!result) return;
      setQtyInput("");
      onAdded(result.qty, result.total);
      onClose();
    },
  });

  return (
    <Dialog
      open={product != null}
      onOpenChange={(open) => {
        if (!open) {
          setQtyInput("");
          add.reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("readyMade.addStockTitle", { name: product?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("readyMade.addStockCurrent", { qty: product?.stockQty ?? 0 })}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Label htmlFor="add-stock-qty">{t("readyMade.addStockQtyLabel")}</Label>
          <Input
            id="add-stock-qty"
            className="h-12 text-lg"
            inputMode="numeric"
            dir="ltr"
            autoFocus
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
          />
          {add.isError ? <p className="text-sm text-destructive">{getApiErrorMessage(add.error)}</p> : null}
          <DialogFooter>
            <Button type="submit" className="h-11 w-full" disabled={add.isPending || !qtyInput.trim()}>
              {add.isPending ? "…" : t("readyMade.addStockSave")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
