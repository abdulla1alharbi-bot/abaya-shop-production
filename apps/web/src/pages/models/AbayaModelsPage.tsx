import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image, LayoutGrid, Table2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { AbayaCatalogType } from "@/lib/abayaTailoringCatalog";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";

const STAGE_ORDER = ["CUTTING", "SEWING", "EMBROIDERY", "FINISHING"] as const;
/** Stage key → i18n key for the short workshop-stage label (locale-aware). */
const STAGE_LABEL_KEY: Record<(typeof STAGE_ORDER)[number], string> = {
  CUTTING: "models.stagesCut",
  SEWING: "models.stagesSew",
  EMBROIDERY: "models.stagesEmbroider",
  FINISHING: "models.stagesFinish",
};

type StagePick = Record<(typeof STAGE_ORDER)[number], boolean>;

function defaultStages(): StagePick {
  return { CUTTING: true, SEWING: true, EMBROIDERY: true, FINISHING: true };
}

function parseStages(json: string | null | undefined): StagePick {
  const base = defaultStages();
  if (!json?.trim()) return base;
  try {
    const a = JSON.parse(json) as unknown;
    if (!Array.isArray(a)) return base;
    const set = new Set(a.filter((x): x is string => typeof x === "string"));
    return {
      CUTTING: set.has("CUTTING"),
      SEWING: set.has("SEWING"),
      EMBROIDERY: set.has("EMBROIDERY"),
      FINISHING: set.has("FINISHING"),
    };
  } catch {
    return base;
  }
}

function stagesToJson(p: StagePick): string {
  const keys = STAGE_ORDER.filter((k) => p[k]);
  return JSON.stringify(keys.length > 0 ? keys : [...STAGE_ORDER]);
}

type AbayaModelRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  workflowStagesJson: string | null;
  defaultPriceFils: number;
  defaultFabricRollId: string | null;
  defaultDeliveryDays: number;
  cuttingWageFils: number;
  sewingWageFils: number;
  finishingWageFils: number;
  embroideryWageFils: number;
  isActive: boolean;
  sortOrder: number;
  abayaType: { id: string; code: string; labelAr: string };
  product: { id: string; sku: string } | null;
  defaultFabricRoll: { id: string; rollCode: string; name: string; color: string } | null;
};

/** Parent catalog type codes used for tabs (matches `AbayaType.code`). */
type CatalogTabId = "MODEL" | "EMBROIDERY" | "OTHER";

function filterByTab(rows: AbayaModelRow[], tab: CatalogTabId): AbayaModelRow[] {
  if (tab === "MODEL") return rows.filter((r) => r.abayaType.code === "MODEL");
  if (tab === "EMBROIDERY") return rows.filter((r) => r.abayaType.code === "EMBROIDERY");
  return rows.filter((r) => r.abayaType.code !== "MODEL" && r.abayaType.code !== "EMBROIDERY");
}

function defaultAbayaTypeIdForTab(tab: CatalogTabId, types: AbayaCatalogType[]): string {
  const model = types.find((t) => t.code === "MODEL");
  const emb = types.find((t) => t.code === "EMBROIDERY");
  if (tab === "MODEL") return model?.id ?? "";
  if (tab === "EMBROIDERY") return emb?.id ?? "";
  const others = [...types]
    .filter((t) => t.code !== "MODEL" && t.code !== "EMBROIDERY")
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return others[0]?.id ?? "";
}

function aedToFils(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}

function filsToAed(f: number): string {
  return (f / 100).toFixed(2);
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const emptyForm = {
  abayaTypeId: "",
  code: "",
  name: "",
  description: "",
  defaultPriceAed: "",
  defaultFabricRollId: "",
  defaultDeliveryDays: "7",
  cuttingAed: "",
  sewingAed: "",
  finishingAed: "",
  embroideryAed: "",
  sortOrder: "0",
  isActive: true,
};

const TAB_DEFS: Array<{ id: CatalogTabId; label: string; addLabel: string }> = [
  { id: "MODEL", label: "موديلات", addLabel: "إضافة موديل" },
  { id: "EMBROIDERY", label: "تطريز", addLabel: "إضافة تطريز" },
  { id: "OTHER", label: "خدمات أخرى", addLabel: "إضافة عنصر" },
];

function ModelCatalogCard({
  row,
  onEdit,
  onDeactivate,
  deactivatePending,
  canEdit,
  canDeactivate,
}: {
  row: AbayaModelRow;
  onEdit: () => void;
  onDeactivate: () => void;
  deactivatePending: boolean;
  canEdit: boolean;
  canDeactivate: boolean;
}) {
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="relative aspect-[4/3] bg-muted">
        {row.imageUrl ? (
          <img src={row.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            بدون صورة
          </div>
        )}
      </div>
      <CardHeader className="space-y-1 p-4 pb-2">
        <p className="font-mono text-xs text-muted-foreground">{row.code}</p>
        <CardTitle className="text-base font-semibold leading-snug">{row.name}</CardTitle>
        <p className="text-sm font-medium text-foreground">
          السعر الافتراضي: {filsToAed(row.defaultPriceFils)} د.إ
        </p>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-0 text-xs">
        <p className="font-medium text-muted-foreground">أجور الورشة (د.إ)</p>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-muted-foreground">
          <span>قص: {filsToAed(row.cuttingWageFils)}</span>
          <span>خياطة: {filsToAed(row.sewingWageFils)}</span>
          <span>الشغل اليدوي: {filsToAed(row.finishingWageFils)}</span>
          <span>تطريز: {filsToAed(row.embroideryWageFils)}</span>
        </div>
        <div className="border-t pt-2">
          {row.isActive ? (
            <Badge variant="secondary">نشط</Badge>
          ) : (
            <Badge variant="outline">موقوف</Badge>
          )}
        </div>
      </CardContent>
      <CardFooter className="mt-auto flex flex-wrap justify-end gap-2 border-t p-4 pt-3">
        {canEdit ? (
          <Button type="button" variant="outline" size="sm" onClick={onEdit}>
            تعديل
          </Button>
        ) : null}
        {row.isActive && canDeactivate ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={deactivatePending}
            onClick={onDeactivate}
          >
            إيقاف
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}

/** Tailoring catalog admin — tabs by `AbayaType.code`, card or table view. */
export function AbayaModelsPage() {
  const { can } = usePermissions();
  const { t } = useTranslation();
  const canCreate = can("models.create");
  const canEditModel = can("models.edit");
  const canDeactivateModel = can("models.delete");
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<CatalogTabId>("MODEL");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AbayaModelRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [stagePick, setStagePick] = useState<StagePick>(defaultStages());
  const modelImageInputRef = useRef<HTMLInputElement>(null);
  /** Server URL already saved (edit) or returned from last upload in this session */
  const [storedImageUrl, setStoredImageUrl] = useState<string | null>(null);
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);

  const resetImagePicker = () => {
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    setLocalPreviewUrl(null);
    setPendingImageFile(null);
    setStoredImageUrl(null);
  };

  const onPickModelImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      window.alert("يرجى اختيار ملف صورة فقط.");
      return;
    }
    if (f.size > MAX_IMAGE_BYTES) {
      window.alert("حجم الصورة يجب ألا يتجاوز 5 ميجابايت.");
      return;
    }
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    setPendingImageFile(f);
    setLocalPreviewUrl(URL.createObjectURL(f));
  };

  const clearModelImage = () => {
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    setLocalPreviewUrl(null);
    setPendingImageFile(null);
    setStoredImageUrl(null);
  };

  const { data: catalog } = useQuery({
    queryKey: ["abaya-catalog"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { types: AbayaCatalogType[] } }>(
        "/abaya-catalog",
      );
      return res.data.data;
    },
  });

  const { data: listData, isLoading } = useQuery({
    queryKey: ["abaya-models-admin"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { items: AbayaModelRow[] } }>(
        "/abaya-models",
      );
      return res.data.data.items;
    },
  });

  const { data: fabricRolls } = useQuery({
    queryKey: ["fabric-rolls", "models-admin"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: Array<{ id: string; rollCode: string; name: string; color: string }> };
      }>("/fabric-rolls", { params: { limit: 500 } });
      return res.data.data.items;
    },
  });

  const typeOptions = catalog?.types ?? [];

  const rows = listData ?? [];
  const filteredRows = useMemo(() => filterByTab(rows, activeTab), [rows, activeTab]);

  const tabCounts = useMemo(() => {
    return {
      MODEL: filterByTab(rows, "MODEL").length,
      EMBROIDERY: filterByTab(rows, "EMBROIDERY").length,
      OTHER: filterByTab(rows, "OTHER").length,
    };
  }, [rows]);

  const dialogTypeOptions = useMemo(() => {
    if (editing) return typeOptions;
    if (activeTab === "MODEL") return typeOptions.filter((t) => t.code === "MODEL");
    if (activeTab === "EMBROIDERY") return typeOptions.filter((t) => t.code === "EMBROIDERY");
    return typeOptions.filter((t) => t.code !== "MODEL" && t.code !== "EMBROIDERY");
  }, [editing, activeTab, typeOptions]);

  const canAddInTab = defaultAbayaTypeIdForTab(activeTab, typeOptions) !== "";

  const openCreate = () => {
    if (!canCreate) return;
    saveMutation.reset();
    resetImagePicker();
    setEditing(null);
    setStagePick(defaultStages());
    const tid = defaultAbayaTypeIdForTab(activeTab, typeOptions);
    setForm({
      ...emptyForm,
      abayaTypeId: tid,
      defaultPriceAed: "149",
      defaultDeliveryDays: "7",
      cuttingAed: "5",
      sewingAed: "20",
      finishingAed: "5",
      embroideryAed: "3",
    });
    setDialogOpen(true);
  };

  const openEdit = (row: AbayaModelRow) => {
    if (!canEditModel) return;
    saveMutation.reset();
    resetImagePicker();
    setEditing(row);
    setStagePick(parseStages(row.workflowStagesJson));
    setStoredImageUrl(row.imageUrl ?? null);
    setForm({
      abayaTypeId: row.abayaType.id,
      code: row.code,
      name: row.name,
      description: row.description ?? "",
      defaultPriceAed: filsToAed(row.defaultPriceFils),
      defaultFabricRollId: row.defaultFabricRollId ?? "",
      defaultDeliveryDays: String(row.defaultDeliveryDays ?? 7),
      cuttingAed: filsToAed(row.cuttingWageFils),
      sewingAed: filsToAed(row.sewingWageFils),
      finishingAed: filsToAed(row.finishingWageFils),
      embroideryAed: filsToAed(row.embroideryWageFils),
      sortOrder: String(row.sortOrder),
      isActive: row.isActive,
    });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      let imageUrl: string | null = storedImageUrl;
      if (pendingImageFile) {
        const fd = new FormData();
        fd.append("file", pendingImageFile);
        const up = await api.post<{ success: boolean; data: { url: string } }>("/upload", fd);
        imageUrl = up.data.data.url;
      }

      const deliveryDays = Math.min(365, Math.max(0, parseInt(form.defaultDeliveryDays, 10) || 7));
      const body = {
        abayaTypeId: form.abayaTypeId,
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        imageUrl,
        workflowStagesJson: stagesToJson(stagePick),
        defaultPriceFils: aedToFils(form.defaultPriceAed),
        defaultFabricRollId: form.defaultFabricRollId.trim() ? form.defaultFabricRollId.trim() : null,
        defaultDeliveryDays: deliveryDays,
        cuttingWageFils: aedToFils(form.cuttingAed),
        sewingWageFils: aedToFils(form.sewingAed),
        finishingWageFils: aedToFils(form.finishingAed),
        embroideryWageFils: aedToFils(form.embroideryAed),
        sortOrder: parseInt(form.sortOrder, 10) || 0,
        isActive: form.isActive,
      };
      if (!body.code || !body.name) throw new Error("أدخل رقم الموديل والاسم.");
      if (!body.abayaTypeId) throw new Error("اختر نوع العباية.");

      if (editing) {
        await api.patch(`/abaya-models/${editing.id}`, body);
      } else {
        await api.post("/abaya-models", body);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["abaya-models-admin"] });
      void queryClient.invalidateQueries({ queryKey: ["abaya-catalog"] });
      setDialogOpen(false);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/abaya-models/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["abaya-models-admin"] });
      void queryClient.invalidateQueries({ queryKey: ["abaya-catalog"] });
    },
  });

  const confirmDeactivate = (id: string) => {
    if (!canDeactivateModel) return;
    if (
      window.confirm(
        "إيقاف هذا العنصر؟ لن يظهر في قوائم الطلبات الجديدة (يمكن إعادة تفعيله لاحقاً).",
      )
    ) {
      deactivateMutation.mutate(id);
    }
  };

  const addLabel = TAB_DEFS.find((t) => t.id === activeTab)?.addLabel ?? "إضافة";

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-8">
      <PageHeader
        title={t("models.title")}
        description={t("models.description", { defaultValue: "Filter by type. Cards for quick view, table for detailed comparison." })}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link to="/dashboard">← الرئيسية</Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border bg-muted/40 p-0.5">
            <Button
              type="button"
              variant={viewMode === "cards" ? "secondary" : "ghost"}
              size="sm"
              className="gap-1.5"
              onClick={() => setViewMode("cards")}
              aria-pressed={viewMode === "cards"}
            >
              <LayoutGrid className="h-4 w-4" />
              بطاقات
            </Button>
            <Button
              type="button"
              variant={viewMode === "table" ? "secondary" : "ghost"}
              size="sm"
              className="gap-1.5"
              onClick={() => setViewMode("table")}
              aria-pressed={viewMode === "table"}
            >
              <Table2 className="h-4 w-4" />
              جدول
            </Button>
          </div>
          {canCreate ? (
            <Button type="button" size="sm" onClick={openCreate} disabled={!typeOptions.length || !canAddInTab}>
              {addLabel}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Category tabs — filter by `abayaType.code` */}
      <div
        className="flex flex-wrap gap-1 border-b border-border pb-px"
        role="tablist"
        aria-label="تصنيف الكتالوج"
      >
        {TAB_DEFS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={cn(
              "relative rounded-t-md px-4 py-2.5 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            <span className="ms-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
              {tabCounts[tab.id]}
            </span>
          </button>
        ))}
      </div>

      {deactivateMutation.isError ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {getApiErrorMessage(deactivateMutation.error, "تعذّر إيقاف العنصر.")}
        </p>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">جاري التحميل…</p>
      ) : filteredRows.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
          لا توجد عناصر في هذا التبويب.
          {canCreate ? ` استخدم «${addLabel}» لإضافة عنصر ضمن هذا التصنيف.` : ""}
        </p>
      ) : viewMode === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredRows.map((r) => (
            <ModelCatalogCard
              key={r.id}
              row={r}
              onEdit={() => openEdit(r)}
              onDeactivate={() => confirmDeactivate(r.id)}
              deactivatePending={deactivateMutation.isPending}
              canEdit={canEditModel}
              canDeactivate={canDeactivateModel}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[1000px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-right">
                <th className="px-2 py-2 font-medium">صورة</th>
                <th className="px-3 py-2 font-medium">النوع</th>
                <th className="px-3 py-2 font-medium">الرمز</th>
                <th className="px-3 py-2 font-medium">الاسم</th>
                <th className="px-3 py-2 font-medium">سعر البيع</th>
                <th className="px-3 py-2 font-medium">القماش الافتراضي</th>
                <th className="px-3 py-2 font-medium">أيام التسليم</th>
                <th className="px-3 py-2 font-medium">قص</th>
                <th className="px-3 py-2 font-medium">خياطة</th>
                <th className="px-3 py-2 font-medium">الشغل اليدوي</th>
                <th className="px-3 py-2 font-medium">تطريز</th>
                <th className="px-3 py-2 font-medium">الحالة</th>
                {canEditModel || canDeactivateModel ? (
                  <th className="px-3 py-2 font-medium">إجراءات</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-2 py-2">
                    {r.imageUrl ? (
                      <img
                        src={r.imageUrl}
                        alt=""
                        className="h-10 w-10 rounded border object-cover"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.abayaType.labelAr}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{filsToAed(r.defaultPriceFils)}</td>
                  <td className="px-3 py-2 max-w-[140px] text-xs text-muted-foreground">
                    {r.defaultFabricRoll
                      ? `${r.defaultFabricRoll.rollCode} · ${r.defaultFabricRoll.name}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.defaultDeliveryDays}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{filsToAed(r.cuttingWageFils)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{filsToAed(r.sewingWageFils)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{filsToAed(r.finishingWageFils)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{filsToAed(r.embroideryWageFils)}</td>
                  <td className="px-3 py-2">
                    {r.isActive ? (
                      <Badge variant="secondary">نشط</Badge>
                    ) : (
                      <Badge variant="outline">موقوف</Badge>
                    )}
                  </td>
                  {canEditModel || canDeactivateModel ? (
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {canEditModel ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => openEdit(r)}>
                            تعديل
                          </Button>
                        ) : null}
                        {r.isActive && canDeactivateModel ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            disabled={deactivateMutation.isPending}
                            onClick={() => confirmDeactivate(r.id)}
                          >
                            إيقاف
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) resetImagePicker();
          setDialogOpen(open);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? t("models.dialogEditTitle") : t("models.dialogNewTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label htmlFor="am-type">{t("models.parentType")}</Label>
              <select
                id="am-type"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                value={form.abayaTypeId}
                disabled={Boolean(!editing && dialogTypeOptions.length <= 1)}
                onChange={(e) => setForm((f) => ({ ...f, abayaTypeId: e.target.value }))}
              >
                {dialogTypeOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.labelAr} ({t.code})
                  </option>
                ))}
              </select>
              {!editing ? (
                <p className="text-xs text-muted-foreground">
                  {t("models.parentTypeHint")}
                </p>
              ) : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="am-code">{t("models.code")}</Label>
                <Input
                  id="am-code"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="M-104"
                />
              </div>
              <div className="grid gap-2 sm:col-span-1">
                <Label htmlFor="am-sort">{t("models.sortOrder")}</Label>
                <Input
                  id="am-sort"
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="am-name">{t("models.name")}</Label>
              <Input
                id="am-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="model-image-file">{t("models.image")}</Label>
              <input
                ref={modelImageInputRef}
                id="model-image-file"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPickModelImage}
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="relative h-44 w-full max-w-[220px] overflow-hidden rounded-lg border bg-muted">
                  {localPreviewUrl || storedImageUrl ? (
                    <img
                      src={localPreviewUrl || storedImageUrl || undefined}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center text-xs text-muted-foreground">
                      <Image className="h-8 w-8 opacity-50" aria-hidden />
                      {t("models.noImage")}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={t("models.uploadImageAria")}
                      onClick={() => modelImageInputRef.current?.click()}
                    >
                      {localPreviewUrl || storedImageUrl ? t("models.changeImage") : t("models.uploadImage")}
                    </Button>
                    {localPreviewUrl || storedImageUrl ? (
                      <Button type="button" variant="ghost" size="sm" onClick={clearModelImage}>
                        {t("models.removeImage")}
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{t("models.imageHint")}</p>
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="am-desc">{t("models.descLabel")}</Label>
              <textarea
                id="am-desc"
                className="min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="mb-2 text-sm font-medium">{t("models.requiredStages")}</p>
              <p className="mb-2 text-xs text-muted-foreground">{t("models.requiredStagesHint")}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {STAGE_ORDER.map((k) => (
                  <label key={k} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      checked={stagePick[k]}
                      onChange={(e) =>
                        setStagePick((s) => ({ ...s, [k]: e.target.checked }))
                      }
                    />
                    {t(STAGE_LABEL_KEY[k])}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="am-price">{t("models.defaultPrice")}</Label>
              <Input
                id="am-price"
                type="number"
                step={0.01}
                min={0}
                value={form.defaultPriceAed}
                onChange={(e) => setForm((f) => ({ ...f, defaultPriceAed: e.target.value }))}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="am-fabric">{t("models.defaultFabric")}</Label>
                <select
                  id="am-fabric"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.defaultFabricRollId}
                  onChange={(e) => setForm((f) => ({ ...f, defaultFabricRollId: e.target.value }))}
                >
                  <option value="">{t("models.none")}</option>
                  {fabricRolls?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.rollCode} · {r.name} ({r.color})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="am-days">{t("models.defaultDeliveryDays")}</Label>
                <Input
                  id="am-days"
                  type="number"
                  min={0}
                  max={365}
                  value={form.defaultDeliveryDays}
                  onChange={(e) => setForm((f) => ({ ...f, defaultDeliveryDays: e.target.value }))}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("models.defaultWages")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="am-cut">{t("models.stagesCut")}</Label>
                <Input
                  id="am-cut"
                  type="number"
                  step={0.01}
                  min={0}
                  value={form.cuttingAed}
                  onChange={(e) => setForm((f) => ({ ...f, cuttingAed: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="am-sew">{t("models.stagesSew")}</Label>
                <Input
                  id="am-sew"
                  type="number"
                  step={0.01}
                  min={0}
                  value={form.sewingAed}
                  onChange={(e) => setForm((f) => ({ ...f, sewingAed: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="am-fin">{t("models.stagesFinish")}</Label>
                <Input
                  id="am-fin"
                  type="number"
                  step={0.01}
                  min={0}
                  value={form.finishingAed}
                  onChange={(e) => setForm((f) => ({ ...f, finishingAed: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="am-emb">{t("models.stagesEmbroider")}</Label>
                <Input
                  id="am-emb"
                  type="number"
                  step={0.01}
                  min={0}
                  value={form.embroideryAed}
                  onChange={(e) => setForm((f) => ({ ...f, embroideryAed: e.target.value }))}
                />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              />
              {t("models.activeLabel")}
            </label>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "…" : editing ? t("common.save") : t("models.create")}
            </Button>
          </DialogFooter>
          {saveMutation.isError ? (
            <p className="text-sm text-destructive">
              {getApiErrorMessage(saveMutation.error, t("common.saveFailed"))}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
