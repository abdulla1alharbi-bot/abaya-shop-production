import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

export function FabricRollForm() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { id: string; name: string }[] }>(
        "/branches",
      );
      return res.data.data;
    },
  });

  const { data: existing, isLoading } = useQuery({
    queryKey: ["fabric-roll", id],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(`/fabric-rolls/${id}`);
      return res.data.data;
    },
    enabled: !isNew && Boolean(id),
  });

  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const payload = {
        name: String(form.get("name") ?? ""),
        type: String(form.get("type") ?? ""),
        color: String(form.get("color") ?? ""),
        branchId: String(form.get("branchId") ?? "") || undefined,
        totalMeters: parseFloat(String(form.get("totalMeters") ?? "0")),
        costPerMeter: Math.round((parseFloat(String(form.get("costPerMeter"))) || 0) * 100),
        lowStockAt: parseFloat(String(form.get("lowStockAt") ?? "5")),
        isActive: form.has("isActiveFabric"),
        category: String(form.get("category") ?? "FABRIC"),
      };
      if (isNew) {
        await api.post("/fabric-rolls", payload);
      } else {
        await api.patch(`/fabric-rolls/${id}`, payload);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["fabric-rolls"] });
      void navigate("/fabrics");
    },
  });

  if (!isNew && isLoading) {
    return (
      <div>
        <PageHeader title="Fabric roll" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <PageHeader title={isNew ? "New fabric roll" : "Edit fabric roll"} />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(new FormData(e.currentTarget));
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="category">الفئة</Label>
          <select
            id="category"
            name="category"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            defaultValue={existing ? String((existing as { category?: string }).category ?? "FABRIC") : "FABRIC"}
            key={String((existing as { category?: string })?.category ?? "cat")}
          >
            <option value="FABRIC">قماش</option>
            <option value="LACE">دانتيل</option>
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="name">الاسم</Label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={existing ? String(existing.name ?? "") : ""}
            key={String(existing?.name ?? "n")}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="type">Type</Label>
            <Input
              id="type"
              name="type"
              required
              defaultValue={existing ? String(existing.type ?? "") : ""}
              key={String(existing?.type ?? "t")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="color">Color</Label>
            <Input
              id="color"
              name="color"
              required
              defaultValue={existing ? String(existing.color ?? "") : ""}
              key={String(existing?.color ?? "c")}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="branchId">Branch</Label>
          <select
            id="branchId"
            name="branchId"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            defaultValue={existing ? String((existing as { branchId?: string }).branchId ?? "") : ""}
          >
            <option value="">Default branch</option>
            {branches?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="totalMeters">Total meters</Label>
            <Input
              id="totalMeters"
              name="totalMeters"
              type="number"
              step={0.01}
              min={0.01}
              required
              defaultValue={existing ? String((existing as { totalMeters?: number }).totalMeters ?? "") : ""}
              key={String((existing as { totalMeters?: number })?.totalMeters ?? "tm")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lowStockAt">Low stock at (m)</Label>
            <Input
              id="lowStockAt"
              name="lowStockAt"
              type="number"
              step={0.1}
              min={0}
              defaultValue={existing ? String((existing as { lowStockAt?: number }).lowStockAt ?? 5) : "5"}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="costPerMeter">Cost per meter (AED)</Label>
          <Input
            id="costPerMeter"
            name="costPerMeter"
            type="number"
            step={0.01}
            min={0}
            required
            defaultValue={
              existing
                ? String(((existing as { costPerMeter?: number }).costPerMeter ?? 0) / 100)
                : ""
            }
            key={String((existing as { costPerMeter?: number })?.costPerMeter ?? "cp")}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isActiveFabric"
            defaultChecked={existing ? (existing as { isActive?: boolean }).isActive !== false : true}
            className="h-4 w-4 rounded border-input"
          />
          نشط (يظهر في اختيار القماش للتفصيل)
        </label>
        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link to="/fabrics">Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
