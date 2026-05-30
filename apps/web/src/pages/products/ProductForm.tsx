import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";

const EXCLUDED_READY_MADE_CATEGORIES = new Set(["MODEL"]);

export function ProductForm() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const readyMade = location.pathname.startsWith("/ready-made");
  const baseList = readyMade ? "/ready-made" : "/products";

  const { data: categories } = useQuery({
    queryKey: ["product-categories"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { id: string; name: string }[] }>(
        "/products/categories",
      );
      return res.data.data;
    },
  });

  const retailCategories = categories?.filter((c) => !EXCLUDED_READY_MADE_CATEGORIES.has(c.name));

  const { data: existing, isLoading: loadingProduct } = useQuery({
    queryKey: ["product", id],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(
        `/products/${id}`,
      );
      return res.data.data;
    },
    enabled: !isNew && Boolean(id),
  });

  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const aedToFils = (name: string) => {
        const v = parseFloat(String(form.get(name) ?? ""));
        if (!Number.isFinite(v) || v < 0) return undefined;
        return Math.round(v * 100);
      };
      const payload: Record<string, unknown> = {
        sku: String(form.get("sku") ?? ""),
        name: String(form.get("name") ?? ""),
        nameAr: String(form.get("nameAr") ?? "") || undefined,
        categoryId: String(form.get("categoryId") ?? ""),
        costFils: Math.round((parseFloat(String(form.get("cost"))) || 0) * 100),
        priceFils: Math.round((parseFloat(String(form.get("price"))) || 0) * 100),
        stockQty: parseInt(String(form.get("stockQty") ?? "0"), 10) || 0,
        barcode: String(form.get("barcode") ?? "") || undefined,
      };
      if (readyMade) {
        payload.isService = false;
        const img = String(form.get("catalogImageUrl") ?? "").trim();
        payload.catalogImageUrl = img || null;
        payload.isActive = form.has("isActiveRetail");
      } else {
        const cw = aedToFils("cuttingWageAed");
        const sw = aedToFils("sewingWageAed");
        const ew = aedToFils("embroideryWageAed");
        const fw = aedToFils("finishingWageAed");
        if (cw !== undefined) payload.cuttingWageFils = cw;
        if (sw !== undefined) payload.sewingWageFils = sw;
        if (ew !== undefined) payload.embroideryWageFils = ew;
        if (fw !== undefined) payload.finishingWageFils = fw;
      }
      if (isNew) {
        await api.post("/products", payload);
      } else {
        await api.patch(`/products/${id}`, payload);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void navigate(baseList);
    },
  });

  if (!isNew && loadingProduct) {
    return (
      <div>
        <PageHeader title="تحميل…" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!isNew && existing && readyMade && (existing as { isService?: boolean }).isService) {
    return (
      <div className="max-w-lg space-y-4">
        <PageHeader title="غير متاح هنا" />
        <p className="text-sm text-muted-foreground">
          هذا السجل منتج خدمة / تفصيل يُدار من صفحة الموديلات، وليس من المنتجات الجاهزة.
        </p>
        <Button asChild>
          <Link to="/ready-made">العودة لمنتجات جاهزة</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <PageHeader
        title={
          readyMade
            ? isNew
              ? "منتج جاهز جديد"
              : "تعديل منتج جاهز"
            : isNew
              ? "New product"
              : "Edit product"
        }
        description={
          readyMade
            ? "للبيع من كاشير «جاهز» فقط. موديلات التفصيل تُدار من صفحة الموديلات."
            : undefined
        }
      />
      {!isNew &&
      readyMade &&
      typeof (existing as { createdFromInvoiceNo?: number | null } | null)?.createdFromInvoiceNo === "number" ? (
        <div className="rounded-lg border border-cyan-300/80 bg-cyan-50 px-3 py-2 text-xs text-cyan-900 dark:border-cyan-800/60 dark:bg-cyan-950/30 dark:text-cyan-100">
          تم إنشاؤه من فاتورة #
          {String((existing as { createdFromInvoiceNo?: number | null }).createdFromInvoiceNo ?? "—")}
          {(existing as { createdFromJobNo?: number | null }).createdFromJobNo
            ? ` · طلب #${String((existing as { createdFromJobNo?: number | null }).createdFromJobNo)}`
            : ""}
        </div>
      ) : null}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(new FormData(e.currentTarget));
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="sku">SKU / الرمز</Label>
          <Input
            id="sku"
            name="sku"
            required
            defaultValue={existing ? String(existing.sku ?? "") : ""}
            key={existing ? String(existing.sku) : "new"}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={existing ? String(existing.name ?? "") : ""}
            key={existing ? String(existing.name) : "n1"}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="nameAr">Name (AR)</Label>
          <Input
            id="nameAr"
            name="nameAr"
            defaultValue={existing ? String(existing.nameAr ?? "") : ""}
            key={existing ? String(existing.nameAr) : "n2"}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="categoryId">Category</Label>
          <select
            id="categoryId"
            name="categoryId"
            required
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            defaultValue={existing ? String((existing as { categoryId?: string }).categoryId ?? "") : ""}
            key={existing ? String((existing as { categoryId?: string }).categoryId) : "c0"}
          >
            <option value="">Select…</option>
            {(readyMade ? retailCategories : categories)?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="cost">Cost (AED)</Label>
            <Input
              id="cost"
              name="cost"
              type="number"
              step={0.01}
              min={0}
              required
              defaultValue={
                existing
                  ? String(((existing as { costFils?: number }).costFils ?? 0) / 100)
                  : ""
              }
              key={existing ? String((existing as { costFils?: number }).costFils) : "co"}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="price">Price (AED)</Label>
            <Input
              id="price"
              name="price"
              type="number"
              step={0.01}
              min={0}
              required
              defaultValue={
                existing
                  ? String(((existing as { priceFils?: number }).priceFils ?? 0) / 100)
                  : ""
              }
              key={existing ? String((existing as { priceFils?: number }).priceFils) : "pr"}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="stockQty">Stock quantity</Label>
          <Input
            id="stockQty"
            name="stockQty"
            type="number"
            min={0}
            defaultValue={existing ? String((existing as { stockQty?: number }).stockQty ?? 0) : "0"}
            key={existing ? String((existing as { stockQty?: number }).stockQty) : "st"}
          />
        </div>
        {readyMade ? (
          <>
            <div className="grid gap-2">
              <Label htmlFor="catalogImageUrl">رابط صورة المنتج (اختياري)</Label>
              <Input
                id="catalogImageUrl"
                name="catalogImageUrl"
                type="url"
                placeholder="https://…"
                defaultValue={
                  existing ? String((existing as { catalogImageUrl?: string }).catalogImageUrl ?? "") : ""
                }
                key={existing ? String((existing as { catalogImageUrl?: string }).catalogImageUrl ?? "i") : "i0"}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="isActiveRetail"
                defaultChecked={existing ? (existing as { isActive?: boolean }).isActive !== false : true}
                className="h-4 w-4 rounded border-input"
              />
              نشط في الكاشير
            </label>
          </>
        ) : null}
        {!readyMade ? (
          <div className="space-y-3 border-t pt-4">
            <p className="text-sm font-medium text-foreground">Tailoring stage wages (AED)</p>
            <p className="text-xs text-muted-foreground">
              Used automatically for job orders that use this model (cutting → sewing → embroidery → finishing).
            </p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="grid gap-2">
                <Label htmlFor="cuttingWageAed">Cutting</Label>
                <Input
                  id="cuttingWageAed"
                  name="cuttingWageAed"
                  type="number"
                  step={0.01}
                  min={0}
                  placeholder="5"
                  defaultValue={
                    existing != null &&
                    typeof (existing as { cuttingWageFils?: number }).cuttingWageFils === "number"
                      ? String(((existing as { cuttingWageFils: number }).cuttingWageFils ?? 0) / 100)
                      : ""
                  }
                  key={
                    existing
                      ? String((existing as { cuttingWageFils?: number }).cuttingWageFils ?? "cwa")
                      : "cwa-new"
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="sewingWageAed">Sewing</Label>
                <Input
                  id="sewingWageAed"
                  name="sewingWageAed"
                  type="number"
                  step={0.01}
                  min={0}
                  placeholder="20"
                  defaultValue={
                    existing != null &&
                    typeof (existing as { sewingWageFils?: number }).sewingWageFils === "number"
                      ? String(((existing as { sewingWageFils: number }).sewingWageFils ?? 0) / 100)
                      : ""
                  }
                  key={
                    existing
                      ? String((existing as { sewingWageFils?: number }).sewingWageFils ?? "swa")
                      : "swa-new"
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="embroideryWageAed">Embroidery</Label>
                <Input
                  id="embroideryWageAed"
                  name="embroideryWageAed"
                  type="number"
                  step={0.01}
                  min={0}
                  placeholder="3"
                  defaultValue={
                    existing != null &&
                    typeof (existing as { embroideryWageFils?: number }).embroideryWageFils === "number"
                      ? String(((existing as { embroideryWageFils: number }).embroideryWageFils ?? 0) / 100)
                      : ""
                  }
                  key={
                    existing
                      ? String((existing as { embroideryWageFils?: number }).embroideryWageFils ?? "ewa")
                      : "ewa-new"
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="finishingWageAed">Finishing</Label>
                <Input
                  id="finishingWageAed"
                  name="finishingWageAed"
                  type="number"
                  step={0.01}
                  min={0}
                  placeholder="5"
                  defaultValue={
                    existing != null &&
                    typeof (existing as { finishingWageFils?: number }).finishingWageFils === "number"
                      ? String(((existing as { finishingWageFils: number }).finishingWageFils ?? 0) / 100)
                      : ""
                  }
                  key={
                    existing
                      ? String((existing as { finishingWageFils?: number }).finishingWageFils ?? "fwa")
                      : "fwa-new"
                  }
                />
              </div>
            </div>
          </div>
        ) : null}
        <div className="grid gap-2">
          <Label htmlFor="barcode">Barcode</Label>
          <Input
            id="barcode"
            name="barcode"
            defaultValue={existing ? String((existing as { barcode?: string }).barcode ?? "") : ""}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link to={baseList}>Cancel</Link>
          </Button>
        </div>
        {save.isError ? (
          <p className="text-sm text-destructive">{getApiErrorMessage(save.error)}</p>
        ) : null}
      </form>
    </div>
  );
}
