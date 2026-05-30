import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RefreshCw, Save, Scissors, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { tailoringDraftToMeasurementBody } from "@/lib/tailoringMeasurementApi";
import type { FabricRollRow } from "@/lib/tailoringLinePayload";
import { useCartStore } from "@/store/cartStore";
import type { PosMeasurementHint } from "@/types/posMeasurementHint";
import { hintHasNumericBody } from "@/types/posMeasurementHint";
import type { TailoringDraft } from "@/types/posCart";
import { cn } from "@/lib/utils";
import { STANDARD_ABAYA_SIZES } from "@/components/pos/posConstants";
import {
  validateTailoringAbayaSelection,
  formatModelOption,
  needsCustomText,
  needsModelPicker,
  resolveAbayaType,
  defaultSaleAedFromCatalogModel,
  dueDateTimeLocalFromNowCalendarDays,
} from "@/lib/abayaTailoringCatalog";
import type { AbayaCatalogType } from "@/lib/abayaTailoringCatalog";

/** Meters deducted from stock per line — fixed in UI; backend unchanged. */
const DEFAULT_METERS = "2";

function bodySnapshot(d: Pick<TailoringDraft, "shoulder" | "chest" | "waist" | "hip" | "lengthVal" | "sleeve">) {
  return JSON.stringify({
    shoulder: d.shoulder,
    chest: d.chest,
    waist: d.waist,
    hip: d.hip,
    lengthVal: d.lengthVal,
    sleeve: d.sleeve,
  });
}

export function TailoringIntakePanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const tailoringDraft = useCartStore((s) => s.tailoringDraft);
  const setTailoringDraft = useCartStore((s) => s.setTailoringDraft);
  const editingTailoringId = useCartStore((s) => s.editingTailoringId);
  const resetTailoringDraft = useCartStore((s) => s.resetTailoringDraft);
  const posCustomerId = useCartStore((s) => s.posCustomerId);
  const posCustomerLabel = useCartStore((s) => s.posCustomerLabel);
  const latestProfileMeasurementId = useCartStore((s) => s.latestProfileMeasurementId);
  const setLatestProfileMeasurementId = useCartStore((s) => s.setLatestProfileMeasurementId);
  const applyPosMeasurementHint = useCartStore((s) => s.applyPosMeasurementHint);

  const [formFlash, setFormFlash] = useState<string | null>(null);
  const [measurementNotice, setMeasurementNotice] = useState<"loaded" | "edited" | null>(null);
  const loadedBodySnapshotRef = useRef("");

  const { data: measHint, isFetching: isHintLoading } = useQuery({
    queryKey: ["pos-measurement-hint", posCustomerId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: PosMeasurementHint }>(
        `/customers/${posCustomerId}/pos-measurement-hint`,
      );
      return res.data.data;
    },
    enabled: Boolean(posCustomerId),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!posCustomerId) {
      loadedBodySnapshotRef.current = "";
      setMeasurementNotice(null);
    }
  }, [posCustomerId]);

  useLayoutEffect(() => {
    if (!posCustomerId || !measHint) return;
    applyPosMeasurementHint(measHint);
    const d = useCartStore.getState().tailoringDraft;
    loadedBodySnapshotRef.current = bodySnapshot(d);
    setMeasurementNotice(hintHasNumericBody(measHint) ? "loaded" : null);
  }, [posCustomerId, measHint, applyPosMeasurementHint]);

  useEffect(() => {
    if (!posCustomerId || !loadedBodySnapshotRef.current) return;
    const id = requestAnimationFrame(() => {
      const d = useCartStore.getState().tailoringDraft;
      const cur = bodySnapshot(d);
      if (cur !== loadedBodySnapshotRef.current) {
        setMeasurementNotice("edited");
      }
    });
    return () => cancelAnimationFrame(id);
  }, [
    posCustomerId,
    tailoringDraft.shoulder,
    tailoringDraft.chest,
    tailoringDraft.waist,
    tailoringDraft.hip,
    tailoringDraft.lengthVal,
    tailoringDraft.sleeve,
  ]);

  const reloadProfile = useMutation({
    mutationFn: async () => {
      if (!posCustomerId) throw new Error("لا عميل");
      const res = await api.get<{ success: boolean; data: PosMeasurementHint }>(
        `/customers/${posCustomerId}/pos-measurement-hint`,
      );
      return res.data.data;
    },
    onSuccess: (hint) => {
      applyPosMeasurementHint(hint);
      const d = useCartStore.getState().tailoringDraft;
      loadedBodySnapshotRef.current = bodySnapshot(d);
      setMeasurementNotice(hintHasNumericBody(hint) ? "loaded" : null);
      setFormFlash("تم تحميل آخر مقاس من ملف العميل.");
      window.setTimeout(() => setFormFlash(null), 4000);
      void queryClient.invalidateQueries({ queryKey: ["customer-measurements"] });
    },
    onError: () => {
      setFormFlash("تعذر تحميل المقاس.");
      window.setTimeout(() => setFormFlash(null), 4000);
    },
  });

  const saveProfile = useMutation({
    mutationFn: async () => {
      if (!posCustomerId) throw new Error("اختر العميل من أعلى الصفحة أولاً");
      const body = tailoringDraftToMeasurementBody(tailoringDraft, abayaCatalog);
      if (Object.keys(body).length === 0) throw new Error("لا توجد بيانات مقاس لحفظها");
      if (latestProfileMeasurementId) {
        const res = await api.patch<{ success: boolean; data: { id: string } }>(
          `/customers/measurements/${latestProfileMeasurementId}`,
          body,
        );
        return res.data.data;
      }
      const res = await api.post<{ success: boolean; data: { id: string } }>(
        `/customers/${posCustomerId}/measurements`,
        body,
      );
      return res.data.data;
    },
    onSuccess: (data) => {
      setLatestProfileMeasurementId(data.id);
      const cid = useCartStore.getState().posCustomerId;
      if (cid) {
        const d = useCartStore.getState().tailoringDraft;
        loadedBodySnapshotRef.current = bodySnapshot(d);
        setMeasurementNotice("loaded");
        void queryClient.invalidateQueries({ queryKey: ["pos-measurement-hint", cid] });
      }
      setFormFlash("تم حفظ المقاس على ملف العميل.");
      window.setTimeout(() => setFormFlash(null), 5000);
      void queryClient.invalidateQueries({ queryKey: ["customer-measurements"] });
    },
    onError: (e: Error) => {
      setFormFlash(e.message || "تعذر الحفظ");
      window.setTimeout(() => setFormFlash(null), 5000);
    },
  });

  const { data: abayaCatalog } = useQuery({
    queryKey: ["abaya-catalog"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { types: AbayaCatalogType[] } }>("/abaya-catalog");
      return res.data.data;
    },
  });

  const { data: rolls } = useQuery({
    queryKey: ["fabric-rolls", "tailoring-intake"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: FabricRollRow[] };
      }>("/fabric-rolls", { params: { limit: 300, activeOnly: "true" } });
      return res.data.data.items;
    },
  });

  const fabricRolls = useMemo(() => rolls?.filter((r) => (r.category ?? "FABRIC") === "FABRIC"), [rolls]);
  const laceRolls = useMemo(() => rolls?.filter((r) => r.category === "LACE"), [rolls]);

  const selectedRoll = useMemo(
    () => rolls?.find((r) => r.id === tailoringDraft.rollId),
    [rolls, tailoringDraft.rollId],
  );

  const selectedLaceRoll = useMemo(
    () => rolls?.find((r) => r.id === tailoringDraft.laceRollId),
    [rolls, tailoringDraft.laceRollId],
  );

  const selectedAbayaType = useMemo(
    () => resolveAbayaType(tailoringDraft.abayaTypeId, abayaCatalog),
    [abayaCatalog, tailoringDraft.abayaTypeId],
  );

  const selectedCatalogModel = useMemo(() => {
    if (!selectedAbayaType || !needsModelPicker(selectedAbayaType) || !tailoringDraft.abayaModelId) {
      return undefined;
    }
    return selectedAbayaType.models.find((m) => m.id === tailoringDraft.abayaModelId);
  }, [selectedAbayaType, tailoringDraft.abayaModelId]);

  const lastAutofillModelIdRef = useRef<string | null>(null);
  useEffect(() => {
    lastAutofillModelIdRef.current = null;
  }, [tailoringDraft.abayaTypeId]);

  useEffect(() => {
    if (!selectedAbayaType || !needsModelPicker(selectedAbayaType)) return;
    const mid = tailoringDraft.abayaModelId;
    if (!mid) {
      lastAutofillModelIdRef.current = null;
      return;
    }
    if (mid === lastAutofillModelIdRef.current) return;
    lastAutofillModelIdRef.current = mid;
    const mod = selectedAbayaType.models.find((m) => m.id === mid);
    if (!mod) return;

    const sale = defaultSaleAedFromCatalogModel(mod);
    const due = dueDateTimeLocalFromNowCalendarDays(
      Number.isFinite(mod.defaultDeliveryDays) ? mod.defaultDeliveryDays : 7,
    );
    setTailoringDraft({
      ...(sale ? { saleAed: sale } : {}),
      dueDate: due,
    });
  }, [tailoringDraft.abayaModelId, selectedAbayaType, setTailoringDraft]);

  /** When fabric rolls load after model selection, apply default fabric if still unset. */
  useEffect(() => {
    if (!selectedAbayaType || !needsModelPicker(selectedAbayaType)) return;
    const mid = tailoringDraft.abayaModelId;
    if (!mid || !rolls?.length || tailoringDraft.rollId) return;
    const mod = selectedAbayaType.models.find((m) => m.id === mid);
    const fid = mod?.defaultFabricRollId;
    if (!fid || !rolls.some((r) => r.id === fid)) return;
    setTailoringDraft({ rollId: fid });
  }, [rolls, tailoringDraft.abayaModelId, tailoringDraft.rollId, selectedAbayaType, setTailoringDraft]);

  useEffect(() => {
    if (!abayaCatalog?.types.length || tailoringDraft.abayaTypeId) return;
    setTailoringDraft({ abayaTypeId: abayaCatalog.types[0].id });
  }, [abayaCatalog, tailoringDraft.abayaTypeId, setTailoringDraft]);

  const addToCart = async () => {
    const st = useCartStore.getState();
    const draftSnap = { ...st.tailoringDraft };
    const latestMeasId = st.latestProfileMeasurementId;
    const cid = st.posCustomerId;
    const wasEditing = Boolean(st.editingTailoringId);

    const vErr = validateTailoringAbayaSelection(
      draftSnap.abayaTypeId,
      draftSnap.abayaModelId,
      draftSnap.customStyleText,
      abayaCatalog,
    );
    if (vErr) {
      setFormFlash(vErr);
      window.setTimeout(() => setFormFlash(null), 5000);
      return;
    }

    useCartStore.getState().setTailoringDraft({ meters: DEFAULT_METERS, materialCostAed: "0" });
    const result = useCartStore.getState().commitTailoringDraft();
    if (!result.ok) {
      setFormFlash(result.error);
      window.setTimeout(() => setFormFlash(null), 5000);
      return;
    }
    setFormFlash(wasEditing ? "تم التحديث في السلة." : "أُضيف للسلة.");
    window.setTimeout(() => setFormFlash(null), 4000);

    if (!cid) return;
    try {
      const body = tailoringDraftToMeasurementBody(draftSnap, abayaCatalog);
      if (Object.keys(body).length === 0) return;
      if (latestMeasId) {
        await api.patch(`/customers/measurements/${latestMeasId}`, body);
      } else {
        const res = await api.post<{ success: boolean; data: { id: string } }>(
          `/customers/${cid}/measurements`,
          body,
        );
        useCartStore.getState().setLatestProfileMeasurementId(res.data.data.id);
      }
      void queryClient.invalidateQueries({ queryKey: ["pos-measurement-hint", cid] });
    } catch {
      /* optional */
    }
  };

  return (
    <Card className="border bg-card shadow-sm">
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Scissors className="h-4 w-4 text-muted-foreground" />
          {editingTailoringId ? "تعديل تفصيل" : "طلب تفصيل"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          بعد اختيار العميل أعلى الصفحة، املأ البيانات ثم أضِف للسلة.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!posCustomerId ? (
          <p
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-center text-sm font-medium text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
            role="status"
          >
            Please select a customer first
          </p>
        ) : null}

        {posCustomerId && isHintLoading ? (
          <p className="text-xs text-muted-foreground">جاري تحميل المقاسات…</p>
        ) : null}
        {measurementNotice === "loaded" ? (
          <p className="text-xs text-muted-foreground">Loaded last measurements</p>
        ) : null}
        {measurementNotice === "edited" ? (
          <p className="text-xs font-medium text-brand-800 dark:text-brand-200">Measurements updated</p>
        ) : null}

        <fieldset
          disabled={!posCustomerId}
          className="min-w-0 space-y-4 border-0 p-0 disabled:pointer-events-none disabled:opacity-55 [&_button]:disabled:opacity-100"
        >
        <div className="space-y-2">
          <Label htmlFor="abaya-type">نوع العباية</Label>
          <select
            id="abaya-type"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={tailoringDraft.abayaTypeId}
            onChange={(e) =>
              setTailoringDraft({
                abayaTypeId: e.target.value,
                abayaModelId: "",
                customStyleText: "",
                sourceDisplaySampleJobId: null,
                sourceDisplayModelId: null,
              })
            }
          >
            {!abayaCatalog?.types.length ? (
              <option value="">جاري التحميل…</option>
            ) : (
              abayaCatalog.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.labelAr}
                </option>
              ))
            )}
          </select>
          <p className="text-xs text-muted-foreground">اختر النوع أولاً؛ ثم الموديل أو الوصف إن وُجد.</p>
        </div>

        {selectedAbayaType && needsModelPicker(selectedAbayaType) ? (
          <div className="space-y-2">
            <Label htmlFor="abaya-model">
              {selectedAbayaType.subFieldKind === "EMBROIDERY_PICK" ? "تصميم التطريز" : "رقم / اسم الموديل"}
            </Label>
            <select
              id="abaya-model"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={tailoringDraft.abayaModelId}
              onChange={(e) =>
                setTailoringDraft({
                  abayaModelId: e.target.value,
                  rollId: "",
                  sourceDisplayModelId: null,
                  sourceDisplaySampleJobId: null,
                })
              }
            >
              <option value="">— اختر —</option>
              {selectedAbayaType.models.map((mod) => (
                <option key={mod.id} value={mod.id}>
                  {formatModelOption(mod)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {selectedAbayaType && needsCustomText(selectedAbayaType) ? (
          <div className="space-y-2">
            <Label htmlFor="custom-style">وصف التفصيل المخصص</Label>
            <Input
              id="custom-style"
              className="h-10"
              value={tailoringDraft.customStyleText}
              onChange={(e) => setTailoringDraft({ customStyleText: e.target.value })}
              placeholder="اكتب ما يطلبه العميل بالتفصيل"
            />
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="fabric-roll">القماش</Label>
          <select
            id="fabric-roll"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={tailoringDraft.rollId}
            onChange={(e) => setTailoringDraft({ rollId: e.target.value })}
          >
            <option value="">— اختر لفة —</option>
            {fabricRolls?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.rollCode} · {r.name} ({r.color})
              </option>
            ))}
          </select>
          {selectedCatalogModel?.defaultFabricRoll ? (
            <p className="text-xs text-muted-foreground">
              افتراضي الموديل: {selectedCatalogModel.defaultFabricRoll.rollCode} ·{" "}
              {selectedCatalogModel.defaultFabricRoll.name} ({selectedCatalogModel.defaultFabricRoll.color})
            </p>
          ) : null}
        </div>

        {/* Lace selector */}
        {laceRolls && laceRolls.length > 0 ? (
          <div className="space-y-2">
            <Label htmlFor="lace-roll">الدانتيل <span className="font-normal text-muted-foreground">(اختياري)</span></Label>
            <select
              id="lace-roll"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={tailoringDraft.laceRollId}
              onChange={(e) => setTailoringDraft({ laceRollId: e.target.value })}
            >
              <option value="">— بدون دانتيل —</option>
              {laceRolls.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.rollCode} · {r.name} ({r.color})
                </option>
              ))}
            </select>
            {tailoringDraft.laceRollId && (
              <div className="flex items-center gap-2">
                <Label htmlFor="lace-meters" className="shrink-0 text-xs">أمتار الدانتيل</Label>
                <Input
                  id="lace-meters"
                  className="h-8 w-24"
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={tailoringDraft.laceMeters}
                  onChange={(e) => setTailoringDraft({ laceMeters: e.target.value })}
                />
                {selectedLaceRoll && (
                  <span className="text-xs text-muted-foreground">
                    متاح: {selectedLaceRoll.availableMeters.toFixed(1)} م
                  </span>
                )}
              </div>
            )}
          </div>
        ) : null}

        <div className="space-y-2">
          <Label>اللون</Label>
          {selectedRoll ? (
            <p className="text-sm font-medium text-foreground">{selectedRoll.color}</p>
          ) : (
            <p className="text-sm text-muted-foreground">يظهر بعد اختيار القماش</p>
          )}
          <Label htmlFor="color-note" className="text-xs font-normal text-muted-foreground">
            توضيح لون (اختياري)
          </Label>
          <Input
            id="color-note"
            className="h-10"
            value={tailoringDraft.colorNote}
            onChange={(e) => setTailoringDraft({ colorNote: e.target.value })}
            placeholder="مثال: نفس عيّنة العميل"
          />
        </div>

        <div className="space-y-2">
          <Label>المقاس</Label>
          <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-1">
            <button
              type="button"
              className={cn(
                "rounded-md py-2 text-sm font-medium transition-colors",
                tailoringDraft.sizeMode === "STANDARD"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setTailoringDraft({ sizeMode: "STANDARD" })}
            >
              مقاس جاهز
            </button>
            <button
              type="button"
              className={cn(
                "rounded-md py-2 text-sm font-medium transition-colors",
                tailoringDraft.sizeMode === "CUSTOM"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setTailoringDraft({ sizeMode: "CUSTOM" })}
            >
              قياس خاص
            </button>
          </div>
        </div>

        {tailoringDraft.sizeMode === "STANDARD" ? (
          <div className="space-y-2">
            <Label htmlFor="std-size">المقاس الجاهز</Label>
            <select
              id="std-size"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={tailoringDraft.standardSize}
              onChange={(e) => setTailoringDraft({ standardSize: e.target.value })}
            >
              {STANDARD_ABAYA_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="space-y-2">
            <Label>قياسات الجسم (سم)</Label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              <Input
                placeholder={t("measurements.shoulder")}
                className="h-9"
                value={tailoringDraft.shoulder}
                onChange={(e) => setTailoringDraft({ shoulder: e.target.value })}
              />
              <Input
                placeholder={t("measurements.chest")}
                className="h-9"
                value={tailoringDraft.chest}
                onChange={(e) => setTailoringDraft({ chest: e.target.value })}
              />
              <Input
                placeholder={t("measurements.waist")}
                className="h-9"
                value={tailoringDraft.waist}
                onChange={(e) => setTailoringDraft({ waist: e.target.value })}
              />
              <Input
                placeholder={t("measurements.hip")}
                className="h-9"
                value={tailoringDraft.hip}
                onChange={(e) => setTailoringDraft({ hip: e.target.value })}
              />
              <Input
                placeholder={t("measurements.length")}
                className="h-9"
                value={tailoringDraft.lengthVal}
                onChange={(e) => setTailoringDraft({ lengthVal: e.target.value })}
              />
              <Input
                placeholder={t("measurements.sleeve")}
                className="h-9"
                value={tailoringDraft.sleeve}
                onChange={(e) => setTailoringDraft({ sleeve: e.target.value })}
              />
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sale-price">السعر (درهم)</Label>
            <Input
              id="sale-price"
              className="h-10"
              type="number"
              min={0}
              step={0.01}
              inputMode="decimal"
              value={tailoringDraft.saleAed}
              onChange={(e) => setTailoringDraft({ saleAed: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              عند اختيار موديل، يُقترح السعر وموعد التسليم والقماش (إن وُجد) من إعدادات الموديل ويمكن تعديلها.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="due">موعد التسليم</Label>
            <Input
              id="due"
              className="h-10"
              type="datetime-local"
              value={tailoringDraft.dueDate}
              onChange={(e) => setTailoringDraft({ dueDate: e.target.value })}
            />
            {selectedCatalogModel != null && selectedCatalogModel.defaultDeliveryDays < 2 ? (
              <p className="text-xs text-amber-800 dark:text-amber-200">
                مدة التسليم الافتراضية لهذا الموديل قصيرة جداً — تأكد من الموعد مع العميل.
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="item-notes">ملاحظات (اختياري)</Label>
          <Input
            id="item-notes"
            className="h-10"
            value={tailoringDraft.itemNotes}
            onChange={(e) => setTailoringDraft({ itemNotes: e.target.value })}
            placeholder="للورشة: سحّاب، كم، تفاصيل…"
          />
        </div>

        {posCustomerId ? (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
            <span className="text-muted-foreground">ملف: {posCustomerLabel}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1"
              disabled={saveProfile.isPending}
              onClick={() => saveProfile.mutate()}
            >
              <Save className="h-3 w-3" />
              حفظ المقاس
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 gap-1"
              disabled={reloadProfile.isPending}
              onClick={() => reloadProfile.mutate()}
            >
              <RefreshCw className="h-3 w-3" />
              تحميل من الملف
            </Button>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" className="h-10 gap-2" onClick={addToCart}>
            <ShoppingBag className="h-4 w-4" />
            {editingTailoringId ? "تحديث السلة" : "إضافة للسلة"}
          </Button>
          <Button type="button" variant="outline" className="h-10" onClick={() => resetTailoringDraft()}>
            مسح
          </Button>
        </div>
        </fieldset>

        {formFlash ? (
          <p
            className={cn(
              "rounded-md px-3 py-2 text-center text-sm",
              formFlash.startsWith("تم") || formFlash.startsWith("أُضيف")
                ? "bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-100"
                : "bg-destructive/10 text-destructive",
            )}
          >
            {formFlash}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
