import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useCartStore } from "@/store/cartStore";
import { cn } from "@/lib/utils";

interface CustomerMini {
  id: string;
  name: string;
  mobile: string;
  code: number;
}

function numIn(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const x = parseFloat(t);
  return Number.isFinite(x) ? x : undefined;
}

export type PosCustomerBarVariant = "default" | "pageHero";

interface PosCustomerBarProps {
  /** `pageHero`: top-of-POS layout, auto-focus search, stronger visuals */
  variant?: PosCustomerBarVariant;
  className?: string;
}

export function PosCustomerBar({ variant = "default", className }: PosCustomerBarProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const posCustomerId = useCartStore((s) => s.posCustomerId);
  const posCustomerLabel = useCartStore((s) => s.posCustomerLabel);
  const setPosCustomer = useCartStore((s) => s.setPosCustomer);
  const clearTailoringMeasurementFields = useCartStore((s) => s.clearTailoringMeasurementFields);

  const [customerQuery, setCustomerQuery] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [qName, setQName] = useState("");
  const [qMobile, setQMobile] = useState("");
  const [qNotes, setQNotes] = useState("");
  const [qShoulder, setQShoulder] = useState("");
  const [qChest, setQChest] = useState("");
  const [qSleeve, setQSleeve] = useState("");
  const [qWaist, setQWaist] = useState("");
  const [qHip, setQHip] = useState("");
  const [qLength, setQLength] = useState("");
  const [qMeasNotes, setQMeasNotes] = useState("");

  const prevCustomerRef = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isHero = variant === "pageHero";

  const { data: customerHits } = useQuery({
    queryKey: ["customers", "pos-bar", customerQuery],
    queryFn: async () => {
      if (customerQuery.length < 2) return [];
      const res = await api.get<{
        success: boolean;
        data: { items: CustomerMini[] };
      }>("/customers", { params: { q: customerQuery, limit: 10 } });
      return res.data.data.items;
    },
    enabled: customerQuery.length >= 2,
  });

  useEffect(() => {
    if (posCustomerId === prevCustomerRef.current) return;
    prevCustomerRef.current = posCustomerId;

    if (!posCustomerId) {
      clearTailoringMeasurementFields();
    }
  }, [posCustomerId, clearTailoringMeasurementFields]);

  useEffect(() => {
    if (!isHero || posCustomerId) return;
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [isHero, posCustomerId]);

  const quickCreate = useMutation({
    mutationFn: async () => {
      const name = qName.trim();
      const mobile = qMobile.trim();
      if (name.length < 2) throw new Error("أدخل اسماً صحيحاً");
      if (mobile.length < 5) throw new Error("أدخل رقم جوال صحيحاً");

      const im = {
        shoulder: numIn(qShoulder),
        chest: numIn(qChest),
        waist: numIn(qWaist),
        hip: numIn(qHip),
        length: numIn(qLength),
        sleeve: numIn(qSleeve),
        notes: qMeasNotes.trim() || undefined,
      };
      const hasMeas =
        im.shoulder != null ||
        im.chest != null ||
        im.waist != null ||
        im.hip != null ||
        im.length != null ||
        im.sleeve != null ||
        (im.notes != null && im.notes.length > 0);

      const res = await api.post<{
        success: boolean;
        data: { id: string; name: string; mobile: string; code: number };
      }>("/customers", {
        name,
        mobile,
        notes: qNotes.trim() || undefined,
        initialMeasurement: hasMeas ? im : undefined,
      });
      return res.data.data;
    },
    onSuccess: (c) => {
      setPosCustomer(c.id, `${c.name} — ${c.mobile}`);
      setCustomerQuery("");
      setQuickOpen(false);
      setQName("");
      setQMobile("");
      setQNotes("");
      setQShoulder("");
      setQChest("");
      setQSleeve("");
      setQWaist("");
      setQHip("");
      setQLength("");
      setQMeasNotes("");
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: ["customer-measurements"] });
    },
  });

  return (
    <div
      className={cn(
        "space-y-3",
        isHero
          ? "rounded-xl border-2 border-brand-600/35 bg-gradient-to-b from-brand-50/90 to-background p-4 shadow-md dark:border-brand-500/40 dark:from-brand-950/40 dark:to-background"
          : "rounded-md border bg-muted/30 p-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <Label className={cn("font-semibold text-foreground", isHero ? "text-base" : "text-sm")}>
            {isHero ? "العميل" : "من العميل؟"}
          </Label>
          {isHero ? (
            <p className="text-xs text-muted-foreground">ابدأ هنا: بحث بالاسم أو الجوال ثم اختيار العميل.</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant={isHero ? "default" : "outline"}
          size={isHero ? "default" : "sm"}
          className={cn("h-auto shrink-0 gap-2", isHero && "px-4 py-2.5")}
          onClick={() => setQuickOpen(true)}
          aria-label="Add new customer"
        >
          <UserPlus className={cn("shrink-0", isHero ? "h-4 w-4" : "h-3.5 w-3.5")} />
          <span className="flex flex-col items-start leading-tight text-start">
            <span className="font-medium">عميل جديد</span>
            <span className={cn("font-normal opacity-90", isHero ? "text-xs" : "text-[10px]")}>
              Add new customer
            </span>
          </span>
        </Button>
      </div>

      {posCustomerId ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-background px-3 py-2.5 text-sm shadow-sm dark:border-brand-800 dark:bg-card">
          <span className="font-medium">{posCustomerLabel || "عميل محدد"}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => {
              setPosCustomer(null, "");
              setCustomerQuery("");
            }}
            aria-label="إلغاء اختيار العميل"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <>
          <Input
            ref={searchInputRef}
            placeholder={isHero ? "ابحث بالاسم أو الجوال (name or phone)" : "ابحث بالاسم أو الجوال"}
            value={customerQuery}
            onChange={(e) => setCustomerQuery(e.target.value)}
            className={cn("h-10", isHero && "border-brand-200 bg-background dark:border-brand-800")}
            autoComplete="off"
            name="pos-customer-search"
          />
          {customerHits && customerHits.length > 0 ? (
            <ul className="max-h-36 overflow-y-auto rounded-lg border bg-background text-sm shadow-sm">
              {customerHits.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2.5 text-right hover:bg-muted"
                    onClick={() => {
                      setPosCustomer(c.id, `${c.name} — ${c.mobile}`);
                      setCustomerQuery("");
                    }}
                  >
                    {c.name} · {c.mobile}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>عميل جديد سريع</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>الاسم</Label>
                <Input value={qName} onChange={(e) => setQName(e.target.value)} placeholder="اسم العميل" />
              </div>
              <div>
                <Label>الجوال</Label>
                <Input inputMode="tel" value={qMobile} onChange={(e) => setQMobile(e.target.value)} placeholder="05xxxxxxxx" />
              </div>
            </div>
            <div>
              <Label>ملاحظات العميل (اختياري)</Label>
              <Input value={qNotes} onChange={(e) => setQNotes(e.target.value)} placeholder="ملاحظات عامة…" />
            </div>
            <p className="text-xs font-medium text-muted-foreground">المقاسات (اختياري — تُحفظ مع العميل)</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div>
                <Label className="text-xs">{t("measurements.shoulder")}</Label>
                <Input value={qShoulder} onChange={(e) => setQShoulder(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">{t("measurements.chest")}</Label>
                <Input value={qChest} onChange={(e) => setQChest(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">{t("measurements.waist")}</Label>
                <Input value={qWaist} onChange={(e) => setQWaist(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">{t("measurements.sleeve")}</Label>
                <Input value={qSleeve} onChange={(e) => setQSleeve(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">{t("measurements.hip")}</Label>
                <Input value={qHip} onChange={(e) => setQHip(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">{t("measurements.length")}</Label>
                <Input value={qLength} onChange={(e) => setQLength(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">ملاحظات المقاس</Label>
                <Input value={qMeasNotes} onChange={(e) => setQMeasNotes(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setQuickOpen(false)}>
              إلغاء
            </Button>
            <Button type="button" disabled={quickCreate.isPending} onClick={() => quickCreate.mutate()}>
              {quickCreate.isPending ? "جاري الحفظ…" : "إنشاء واختيار"}
            </Button>
          </DialogFooter>
          {quickCreate.isError ? (
            <p className="text-sm text-destructive">
              {(quickCreate.error as Error).message || "تعذر الإنشاء (ربما الجوال مسجّل)"}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
