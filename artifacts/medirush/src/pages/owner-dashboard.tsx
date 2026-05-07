import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, BarChart2, DollarSign, Edit3, FileText, FlaskConical, ListOrdered, LogOut, Package, Plus, Tags, Trash2, TrendingUp, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { getGetDashboardSummaryQueryKey, getListCategoriesQueryKey, getListMedicinesQueryKey, getListOrdersQueryKey, Medicine, useCreateCategory, useCreateMedicine, useDeleteCategory, useDeleteMedicine, useGetDashboardSummary, useListCategories, useListMedicines, useListOrders, useUpdateMedicine, useUpdateOrderStatus } from "@workspace/api-client-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const emptyMedicine = { name: "", price: "", mrp: "", company: "", stock: "", categoryId: "", imageUrl: "", description: "" };
const money = (value: number) => `₹${value.toFixed(0)}`;

function authFetch(url: string, init?: RequestInit) {
  const token = localStorage.getItem("medirush_token");
  return fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers, Authorization: `Bearer ${token}` },
  }).then(async (res) => {
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).message || "Request failed"); }
    return res.status === 204 ? null : res.json();
  });
}

export default function OwnerDashboard() {
  const { logout } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [medicineForm, setMedicineForm] = useState(emptyMedicine);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [chartPeriod, setChartPeriod] = useState<"daily" | "weekly">("daily");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [hideOOS, setHideOOS] = useState(false);
  const [activeSection, setActiveSection] = useState<"overview" | "catalogue" | "orders" | "reports" | "tests">("overview");
  const [editingStock, setEditingStock] = useState(false);
  const [stockEdits, setStockEdits] = useState<Record<string, string>>({});
  const [testForm, setTestForm] = useState({ name: "", price: "", description: "", preparation: "", turnaroundTime: "24 hrs" });
  const [editingTestId, setEditingTestId] = useState<string | null>(null);

  const { data: summary, isLoading } = useGetDashboardSummary();
  const { data: medicines } = useListMedicines();
  const { data: categories } = useListCategories();
  const { data: orders } = useListOrders({ query: { refetchInterval: 12000 } });

  const { data: storeConfig } = useQuery<{ hideOutOfStock: boolean }>({
    queryKey: ["store-config"],
    queryFn: () => fetch("/api/config/store").then(r => r.json()),
  });

  useEffect(() => {
    if (storeConfig !== undefined) setHideOOS(storeConfig.hideOutOfStock);
  }, [storeConfig]);

  type LabTest = { id: string; name: string; price: number; description?: string; preparation?: string; turnaroundTime: string };
  type TestBooking = { id: string; userName: string; userPhone: string; tests: LabTest[]; total: number; date: string; timeSlot: string; collectionType: string; address: string; status: string; createdAt: string };

  const { data: labTests = [], refetch: refetchTests } = useQuery<LabTest[]>({
    queryKey: ["lab-tests"],
    queryFn: () => authFetch("/api/tests"),
  });
  const { data: testBookings = [], refetch: refetchTestBookings } = useQuery<TestBooking[]>({
    queryKey: ["test-bookings-all"],
    queryFn: () => authFetch("/api/test-bookings/all"),
    refetchInterval: 15000,
  });
  const saveTest = useMutation({
    mutationFn: (data: object) => editingTestId
      ? authFetch(`/api/tests/${editingTestId}`, { method: "PUT", body: JSON.stringify(data) })
      : authFetch("/api/tests", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { refetchTests(); setTestForm({ name: "", price: "", description: "", preparation: "", turnaroundTime: "24 hrs" }); setEditingTestId(null); toast({ title: editingTestId ? "Test updated" : "Test added" }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const deleteTest = useMutation({
    mutationFn: (testId: string) => authFetch(`/api/tests/${testId}`, { method: "DELETE" }),
    onSuccess: () => { refetchTests(); toast({ title: "Test deleted" }); },
  });
  const updateBookingStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => authFetch(`/api/test-bookings/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => refetchTestBookings(),
  });

  const updateStoreConfig = useMutation({
    mutationFn: (value: boolean) => authFetch("/api/config/store", { method: "PATCH", body: JSON.stringify({ hideOutOfStock: value }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["store-config"] }),
  });

  const prevOrderCount = useRef<number | null>(null);

  function playAlertSound() {
    try {
      const ctx = new AudioContext();
      [0, 0.18, 0.36].forEach((t) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.4, ctx.currentTime + t);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15);
        osc.start(ctx.currentTime + t); osc.stop(ctx.currentTime + t + 0.15);
      });
    } catch {}
  }

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission();
  }, []);

  useEffect(() => {
    if (!orders) return;
    const count = orders.length;
    if (prevOrderCount.current !== null && count > prevOrderCount.current) {
      const newest = orders[0];
      playAlertSound();
      toast({ title: "New order received!", description: `${newest.customerName ?? "Customer"} · ₹${newest.total.toFixed(0)}` });
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("Medirush — New Order!", { body: `${newest.customerName ?? "Customer"} ordered ₹${newest.total.toFixed(0)}`, icon: "/favicon.ico" });
      }
    }
    prevOrderCount.current = count;
  }, [orders?.length]);

  const refreshOwnerData = () => {
    queryClient.invalidateQueries({ queryKey: getListMedicinesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
  };

  const createMedicine = useCreateMedicine({ mutation: { onSuccess: () => { refreshOwnerData(); setMedicineForm(emptyMedicine); toast({ title: "Medicine added" }); } } });
  const updateMedicine = useUpdateMedicine({ mutation: { onSuccess: () => { refreshOwnerData(); setMedicineForm(emptyMedicine); setEditingId(null); toast({ title: "Medicine updated" }); } } });
  const deleteMedicine = useDeleteMedicine({ mutation: { onSuccess: () => { refreshOwnerData(); toast({ title: "Medicine deleted" }); } } });
  const createCategory = useCreateCategory({ mutation: { onSuccess: () => { refreshOwnerData(); setCategoryName(""); toast({ title: "Category added" }); } } });
  const deleteCategory = useDeleteCategory({ mutation: { onSuccess: refreshOwnerData } });
  const updateOrderStatus = useUpdateOrderStatus({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() }) } });

  const saveAllStock = async () => {
    const entries = Object.entries(stockEdits).filter(([, v]) => v !== "");
    for (const [medId, val] of entries) {
      await authFetch(`/api/medicines/${medId}`, {
        method: "PUT",
        body: JSON.stringify({
          ...(medicines?.find(m => m.id === medId) ?? {}),
          stock: Number(val),
          categoryId: medicines?.find(m => m.id === medId)?.categoryId ?? "",
          imageUrl: medicines?.find(m => m.id === medId)?.imageUrl ?? "",
          description: medicines?.find(m => m.id === medId)?.description ?? "",
          price: medicines?.find(m => m.id === medId)?.price ?? 0,
          name: medicines?.find(m => m.id === medId)?.name ?? "",
        }),
      });
    }
    queryClient.invalidateQueries({ queryKey: getListMedicinesQueryKey() });
    setEditingStock(false);
    setStockEdits({});
    toast({ title: `Stock updated for ${entries.length} medicine${entries.length !== 1 ? "s" : ""}` });
  };

  const saveMedicine = () => {
    const fallbackCategory = medicineForm.categoryId || categories?.[0]?.id || "";
    const data = {
      name: medicineForm.name,
      price: Number(medicineForm.price),
      mrp: medicineForm.mrp ? Number(medicineForm.mrp) : undefined,
      company: medicineForm.company || undefined,
      stock: medicineForm.stock !== "" ? Number(medicineForm.stock) : undefined,
      categoryId: fallbackCategory,
      imageUrl: medicineForm.imageUrl || "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='220'%3E%3Crect width='320' height='220' rx='32' fill='%2300C853'/%3E%3Ctext x='160' y='125' text-anchor='middle' font-family='Arial' font-size='28' font-weight='700' fill='white'%3EMedirush%3C/text%3E%3C/svg%3E",
      description: medicineForm.description || "Pharmacy verified medicine available for quick delivery.",
    };
    if (!data.name || !data.price || !data.categoryId) {
      toast({ title: "Missing details", description: "Add name, price, and category before saving.", variant: "destructive" });
      return;
    }
    if (editingId) updateMedicine.mutate({ id: editingId, data });
    else createMedicine.mutate({ data });
  };

  const editMedicine = (medicine: Medicine) => {
    setEditingId(medicine.id);
    setMedicineForm({
      name: medicine.name,
      price: String(medicine.price),
      mrp: medicine.mrp ? String(medicine.mrp) : "",
      company: medicine.company ?? "",
      stock: medicine.stock !== undefined && medicine.stock !== null ? String(medicine.stock) : "",
      categoryId: medicine.categoryId,
      imageUrl: medicine.imageUrl,
      description: medicine.description,
    });
    setActiveSection("catalogue");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Revenue chart data
  const revenueChartData = useMemo(() => {
    if (!orders) return [];
    if (chartPeriod === "daily") {
      const days: string[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        days.push(d.toLocaleDateString("en-IN", { month: "short", day: "numeric" }));
      }
      const map: Record<string, number> = {};
      orders.forEach(o => {
        if (o.status === "Cancelled") return;
        const day = new Date(o.createdAt).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
        map[day] = (map[day] ?? 0) + o.total;
      });
      return days.map(day => ({ label: day, revenue: Math.round(map[day] ?? 0) }));
    } else {
      const map: Record<number, number> = {};
      orders.forEach(o => {
        if (o.status === "Cancelled") return;
        const diffDays = Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 86400000);
        const wi = Math.floor(diffDays / 7);
        if (wi < 4) map[3 - wi] = (map[3 - wi] ?? 0) + o.total;
      });
      return [0, 1, 2, 3].map(i => ({ label: `Week ${i + 1}`, revenue: Math.round(map[i] ?? 0) }));
    }
  }, [orders, chartPeriod]);

  // Top selling medicines
  const topSelling = useMemo(() => {
    if (!orders) return [];
    const map: Record<string, { name: string; units: number; revenue: number }> = {};
    orders.forEach(o => {
      if (o.status === "Cancelled") return;
      (o.items as any[]).forEach((item: any) => {
        const mid = item.medicine?.id; if (!mid) return;
        if (!map[mid]) map[mid] = { name: item.medicine.name, units: 0, revenue: 0 };
        map[mid].units += item.quantity;
        map[mid].revenue += item.medicine.price * item.quantity;
      });
    });
    return Object.values(map).sort((a, b) => b.units - a.units).slice(0, 8);
  }, [orders]);

  // Sales report
  const reportOrders = useMemo(() => {
    if (!orders) return [];
    return [...orders].reverse().filter(o => {
      const d = new Date(o.createdAt);
      if (filterFrom && d < new Date(filterFrom)) return false;
      if (filterTo) { const t = new Date(filterTo); t.setHours(23,59,59,999); if (d > t) return false; }
      return true;
    });
  }, [orders, filterFrom, filterTo]);

  const reportSummary = useMemo(() => ({
    count: reportOrders.length,
    revenue: reportOrders.filter(o => o.status !== "Cancelled").reduce((s, o) => s + o.total, 0),
    cancelled: reportOrders.filter(o => o.status === "Cancelled").length,
  }), [reportOrders]);

  const lowStockAlerts = useMemo(() => {
    if (!medicines) return [];
    return medicines.filter(m => m.stock !== undefined && m.stock !== null && m.stock <= 10);
  }, [medicines]);

  const navItems = [
    { id: "overview", label: "Overview", icon: BarChart2 },
    { id: "catalogue", label: "Catalogue", icon: Package },
    { id: "orders", label: "Orders", icon: ListOrdered },
    { id: "tests", label: "Tests", icon: FlaskConical },
    { id: "reports", label: "Reports", icon: FileText },
  ] as const;

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/90 px-5 pb-4 backdrop-blur-xl" style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500 text-slate-950"><Activity size={23} /></div>
            <div>
              <span className="block text-xl font-black tracking-tight">Medirush Admin</span>
              <span className="text-xs text-emerald-200">Owner operations dashboard</span>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => { logout(); setLocation("/"); }}>
            <LogOut size={16} className="mr-2" /> Logout
          </Button>
        </div>
        {/* Nav tabs */}
        <div className="mx-auto max-w-6xl mt-3 flex gap-1">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setActiveSection(id)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${activeSection === id ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"}`}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">

        {/* ─── OVERVIEW ─── */}
        {activeSection === "overview" && (
          <>
            {/* Low stock alerts */}
            {lowStockAlerts.length > 0 && (
              <div className="rounded-2xl border border-orange-500/40 bg-orange-500/10 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={18} className="text-orange-400 shrink-0" />
                  <p className="font-bold text-orange-300">Stock Alert — {lowStockAlerts.length} medicine{lowStockAlerts.length !== 1 ? "s" : ""} running low</p>
                </div>
                <div className="space-y-2">
                  {lowStockAlerts.map(m => (
                    <div key={m.id} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${m.stock === 0 ? "bg-red-500/20 text-red-300" : "bg-orange-500/20 text-orange-300"}`}>
                          {m.stock === 0 ? "OUT" : `${m.stock} left`}
                        </span>
                        <span className="text-sm text-white truncate">{m.name}</span>
                      </div>
                      <button onClick={() => { editMedicine(m); setActiveSection("catalogue"); }} className="shrink-0 text-xs text-orange-300 font-semibold hover:text-orange-200 underline underline-offset-2">
                        Update stock
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Summary cards */}
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { label: "Revenue", value: money(summary?.revenue ?? 0), icon: DollarSign },
                { label: "Orders", value: summary?.orders ?? 0, icon: ListOrdered },
                { label: "Medicines", value: summary?.medicines ?? 0, icon: Package },
                { label: "Categories", value: summary?.categories ?? 0, icon: Tags },
              ].map((item) => (
                <Card key={item.label} className="border-white/10 bg-white/10 text-white shadow-2xl">
                  <CardContent className="p-4">
                    <item.icon className="mb-3 h-5 w-5 text-emerald-300" />
                    <p className="text-sm text-slate-300">{item.label}</p>
                    <p className="text-2xl font-black">{isLoading ? "..." : item.value}</p>
                  </CardContent>
                </Card>
              ))}
            </section>

            {/* Revenue chart */}
            <Card className="border-white/10 bg-white/5 text-white">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-white"><BarChart2 size={18} className="text-emerald-400" /> Revenue</CardTitle>
                  <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
                    <button onClick={() => setChartPeriod("daily")} className={`px-3 py-1 rounded-md text-xs font-semibold transition ${chartPeriod === "daily" ? "bg-emerald-500 text-slate-950" : "text-slate-400"}`}>Daily</button>
                    <button onClick={() => setChartPeriod("weekly")} className={`px-3 py-1 rounded-md text-xs font-semibold transition ${chartPeriod === "weekly" ? "bg-emerald-500 text-slate-950" : "text-slate-400"}`}>Weekly</button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {revenueChartData.every(d => d.revenue === 0) ? (
                  <div className="h-48 flex items-center justify-center text-slate-500 text-sm">No revenue data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={revenueChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff15" />
                      <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `₹${v}`} />
                      <Tooltip contentStyle={{ background: "#1e293b", border: "none", borderRadius: 12, color: "#fff" }} formatter={(v: number) => [`₹${v}`, "Revenue"]} />
                      <Bar dataKey="revenue" fill="#10b981" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Top Sellers + Settings */}
            <div className="grid gap-6 lg:grid-cols-[1fr_0.6fr]">
              <Card className="border-white/10 bg-white/5 text-white">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white"><TrendingUp size={18} className="text-emerald-400" /> Top Selling Medicines</CardTitle>
                </CardHeader>
                <CardContent>
                  {topSelling.length === 0 ? (
                    <p className="text-slate-500 text-sm">No sales data yet</p>
                  ) : (
                    <div className="space-y-2">
                      {topSelling.map((item, i) => (
                        <div key={i} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${i === 0 ? "bg-yellow-400 text-slate-900" : i === 1 ? "bg-slate-300 text-slate-900" : i === 2 ? "bg-amber-600 text-white" : "bg-white/10 text-slate-300"}`}>{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate">{item.name}</p>
                            <p className="text-xs text-slate-400">{item.units} units sold</p>
                          </div>
                          <span className="font-bold text-emerald-400 text-sm shrink-0">{money(item.revenue)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-white/5 text-white">
                <CardHeader>
                  <CardTitle className="text-white text-base">Store Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">Auto-hide out-of-stock</p>
                      <p className="text-xs text-slate-400 mt-0.5">Hide medicines with stock = 0 from user app</p>
                    </div>
                    <Switch
                      checked={hideOOS}
                      onCheckedChange={(v) => { setHideOOS(v); updateStoreConfig.mutate(v); }}
                    />
                  </div>
                  <div className="border-t border-white/10 pt-4">
                    <p className="text-xs text-slate-500">{hideOOS ? "✓ Out-of-stock medicines are hidden from users" : "Out-of-stock medicines are visible to users"}</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* ─── CATALOGUE ─── */}
        {activeSection === "catalogue" && (
          <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
            {/* Medicine form */}
            <Card className="border-white/10 bg-white text-slate-950">
              <CardHeader>
                <CardTitle>{editingId ? "Edit medicine" : "Add medicine"}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-2">
                  <Label>Name</Label>
                  <Input value={medicineForm.name} onChange={e => setMedicineForm({ ...medicineForm, name: e.target.value })} placeholder="Medicine name" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Company / Brand</Label>
                    <Input value={medicineForm.company} onChange={e => setMedicineForm({ ...medicineForm, company: e.target.value })} placeholder="e.g. Cipla" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Category</Label>
                    <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={medicineForm.categoryId} onChange={e => setMedicineForm({ ...medicineForm, categoryId: e.target.value })}>
                      <option value="">Select</option>
                      {categories?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="grid gap-2">
                    <Label>MRP (₹)</Label>
                    <Input type="number" value={medicineForm.mrp} onChange={e => setMedicineForm({ ...medicineForm, mrp: e.target.value })} placeholder="150" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Sell Price (₹)</Label>
                    <Input type="number" value={medicineForm.price} onChange={e => setMedicineForm({ ...medicineForm, price: e.target.value })} placeholder="120" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Stock (units)</Label>
                    <Input type="number" value={medicineForm.stock} onChange={e => setMedicineForm({ ...medicineForm, stock: e.target.value })} placeholder="50" min="0" />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Product Photo</Label>
                  {medicineForm.imageUrl && <img src={medicineForm.imageUrl} alt="Preview" className="h-24 w-full rounded-xl object-cover bg-slate-100" />}
                  <label className="flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-3 hover:border-emerald-400 transition-colors">
                    <Upload size={16} className="shrink-0 text-slate-400" />
                    <span className="text-sm text-slate-500">{medicineForm.imageUrl ? "Change photo" : "Upload photo"}</span>
                    <input type="file" accept="image/*" className="hidden" onChange={e => {
                      const file = e.target.files?.[0]; if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => setMedicineForm(prev => ({ ...prev, imageUrl: String(reader.result) }));
                      reader.readAsDataURL(file);
                    }} />
                  </label>
                </div>
                <div className="grid gap-2">
                  <Label>Description</Label>
                  <Input value={medicineForm.description} onChange={e => setMedicineForm({ ...medicineForm, description: e.target.value })} placeholder="Short medicine description" />
                </div>
                <div className="flex gap-2">
                  <Button onClick={saveMedicine} disabled={createMedicine.isPending || updateMedicine.isPending} className="flex-1">
                    <Plus size={16} className="mr-2" /> {editingId ? "Save changes" : "Add medicine"}
                  </Button>
                  {editingId && <Button variant="outline" onClick={() => { setEditingId(null); setMedicineForm(emptyMedicine); }}>Cancel</Button>}
                </div>
              </CardContent>
            </Card>

            {/* Categories + Medicine list */}
            <div className="space-y-6">
              <Card className="border-white/10 bg-white text-slate-950">
                <CardHeader><CardTitle>Manage categories</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Input value={categoryName} onChange={e => setCategoryName(e.target.value)} placeholder="New category" />
                    <Button onClick={() => categoryName.trim() && createCategory.mutate({ data: { name: categoryName } })}>Add</Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {categories?.map(c => (
                      <span key={c.id} className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                        {c.name}
                        <button onClick={() => deleteCategory.mutate({ id: c.id })} className="text-red-500"><Trash2 size={13} /></button>
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-white text-slate-950">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Medicine catalogue</CardTitle>
                    <div className="flex gap-2">
                      {editingStock && (
                        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs" onClick={saveAllStock} disabled={Object.keys(stockEdits).length === 0}>
                          Save all
                        </Button>
                      )}
                      <Button size="sm" variant={editingStock ? "destructive" : "outline"} className="text-xs" onClick={() => { setEditingStock(v => !v); setStockEdits({}); }}>
                        {editingStock ? "Cancel" : "Edit Stock"}
                      </Button>
                    </div>
                  </div>
                  {editingStock && <p className="text-xs text-slate-400 mt-1">Edit stock values inline, then tap Save all</p>}
                </CardHeader>
                <CardContent className="space-y-3 max-h-[500px] overflow-y-auto">
                  {medicines?.map(medicine => {
                    const oos = medicine.stock !== undefined && medicine.stock !== null && medicine.stock === 0;
                    const lowStock = medicine.stock !== undefined && medicine.stock !== null && medicine.stock > 0 && medicine.stock <= 10;
                    return (
                      <div key={medicine.id} className={`flex items-center gap-3 rounded-2xl border p-3 ${oos ? "opacity-60 border-red-200 bg-red-50" : ""}`}>
                        <img src={medicine.imageUrl} alt={medicine.name} className="h-14 w-14 rounded-xl object-cover" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold">{medicine.name}</p>
                          <p className="text-sm text-slate-500">{medicine.categoryName}{medicine.company ? ` · ${medicine.company}` : ""}</p>
                          {editingStock ? (
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-slate-500">Stock:</span>
                              <input
                                type="number" min="0"
                                className="w-20 h-7 text-sm border border-slate-300 rounded-lg px-2 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                                placeholder={medicine.stock !== undefined && medicine.stock !== null ? String(medicine.stock) : "—"}
                                value={stockEdits[medicine.id] ?? ""}
                                onChange={e => setStockEdits(prev => ({ ...prev, [medicine.id]: e.target.value }))}
                              />
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 mt-0.5">
                              <p className="text-sm font-semibold text-slate-700">
                                {money(medicine.price)}
                                {medicine.mrp && medicine.mrp > medicine.price && <span className="ml-1 text-xs font-normal text-slate-400 line-through">{money(medicine.mrp)}</span>}
                              </p>
                              {oos && <span className="text-[10px] bg-red-100 text-red-600 font-bold px-1.5 py-0.5 rounded-full">Out of stock</span>}
                              {lowStock && <span className="text-[10px] bg-orange-100 text-orange-600 font-bold px-1.5 py-0.5 rounded-full">Low: {medicine.stock}</span>}
                              {!oos && !lowStock && medicine.stock !== undefined && medicine.stock !== null && (
                                <span className="text-[10px] bg-green-100 text-green-700 font-bold px-1.5 py-0.5 rounded-full">Stock: {medicine.stock}</span>
                              )}
                            </div>
                          )}
                        </div>
                        {!editingStock && <Button size="icon" variant="outline" onClick={() => editMedicine(medicine)}><Edit3 size={15} /></Button>}
                        {!editingStock && <Button size="icon" variant="destructive" onClick={() => deleteMedicine.mutate({ id: medicine.id })}><Trash2 size={15} /></Button>}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* ─── ORDERS ─── */}
        {activeSection === "orders" && (
          <Card className="border-white/10 bg-white text-slate-950">
            <CardHeader><CardTitle>All orders</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {orders?.length ? orders.map(order => {
                const statusColor = order.status === "Delivered" ? "bg-green-100 text-green-700" : order.status === "Out for Delivery" ? "bg-blue-100 text-blue-700" : order.status === "Cancelled" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700";
                return (
                  <div key={order.id} className="rounded-2xl bg-slate-50 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold">{money(order.total)} · {order.paymentMethod.toUpperCase()}</p>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${statusColor}`}>{order.status}</span>
                    </div>
                    {order.customerName && <p className="text-sm font-medium text-slate-700">{order.customerName}</p>}
                    {order.customerPhone && <a href={`tel:${order.customerPhone}`} className="block text-sm text-emerald-600 hover:underline">{order.customerPhone}</a>}
                    <p className="truncate text-xs text-slate-400">{order.deliveryAddress}</p>
                    {order.deliveryInstructions && <p className="text-xs text-slate-400 italic">Note: {order.deliveryInstructions}</p>}
                    <div className="text-xs text-slate-400 space-y-0.5">
                      {(order.items as any[]).map((item: any, i: number) => (
                        <span key={i} className="inline-block mr-2">{item.medicine?.name} ×{item.quantity}</span>
                      ))}
                    </div>
                    {order.status === "Placed" && (
                      <Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700 text-white" onClick={() => updateOrderStatus.mutate({ id: order.id, data: { status: "Out for Delivery" } })}>Start Delivery</Button>
                    )}
                    {order.status === "Out for Delivery" && (
                      <Button size="sm" className="w-full bg-green-600 hover:bg-green-700 text-white" onClick={() => updateOrderStatus.mutate({ id: order.id, data: { status: "Delivered" } })}>Mark Delivered</Button>
                    )}
                  </div>
                );
              }) : <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No orders yet.</p>}
            </CardContent>
          </Card>
        )}

        {/* ─── REPORTS ─── */}
        {activeSection === "reports" && (
          <>
            {/* Date filter */}
            <Card className="border-white/10 bg-white/5 text-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white"><FileText size={18} className="text-emerald-400" /> Sales Report</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-slate-300 text-xs shrink-0">From</Label>
                    <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="bg-slate-800 border-slate-700 text-white w-36 text-sm" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-slate-300 text-xs shrink-0">To</Label>
                    <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="bg-slate-800 border-slate-700 text-white w-36 text-sm" />
                  </div>
                  {(filterFrom || filterTo) && (
                    <Button variant="ghost" size="sm" onClick={() => { setFilterFrom(""); setFilterTo(""); }} className="text-slate-400 hover:text-white">Clear</Button>
                  )}
                </div>

                {/* Summary row */}
                <div className="grid grid-cols-3 gap-3 mb-5">
                  {[
                    { label: "Orders", value: reportSummary.count },
                    { label: "Revenue", value: money(reportSummary.revenue) },
                    { label: "Cancelled", value: reportSummary.cancelled },
                  ].map(s => (
                    <div key={s.label} className="bg-white/5 rounded-xl p-3 text-center">
                      <p className="text-slate-400 text-xs">{s.label}</p>
                      <p className="text-xl font-black text-emerald-400">{s.value}</p>
                    </div>
                  ))}
                </div>

                {/* Orders table */}
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/5 text-slate-400 text-xs uppercase tracking-wide">
                        <th className="text-left px-3 py-2">Date</th>
                        <th className="text-left px-3 py-2">Customer</th>
                        <th className="text-left px-3 py-2">Items</th>
                        <th className="text-left px-3 py-2">Amount</th>
                        <th className="text-left px-3 py-2">Payment</th>
                        <th className="text-left px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportOrders.length === 0 ? (
                        <tr><td colSpan={6} className="text-center py-8 text-slate-500">No orders in this range</td></tr>
                      ) : reportOrders.map(o => (
                        <tr key={o.id} className="border-t border-white/5 hover:bg-white/5">
                          <td className="px-3 py-2 text-slate-300 text-xs whitespace-nowrap">{new Date(o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                          <td className="px-3 py-2 text-white font-medium">{o.customerName ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs">
                            {(o.items as any[]).map((item: any) => item.medicine?.name).join(", ").slice(0, 40)}
                          </td>
                          <td className="px-3 py-2 font-bold text-emerald-400">{money(o.total)}</td>
                          <td className="px-3 py-2 text-slate-300 uppercase text-xs">{o.paymentMethod}</td>
                          <td className="px-3 py-2">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${o.status === "Delivered" ? "bg-green-900 text-green-300" : o.status === "Cancelled" ? "bg-red-900 text-red-300" : o.status === "Out for Delivery" ? "bg-blue-900 text-blue-300" : "bg-yellow-900 text-yellow-300"}`}>{o.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* ── Tests Section ── */}
        {activeSection === "tests" && (
          <>
            {/* Add / Edit Test */}
            <Card className="bg-slate-900 border-white/10">
              <CardHeader><CardTitle className="text-white text-base">{editingTestId ? "Edit Test" : "Add New Test"}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-slate-400 text-xs">Test Name *</Label><Input className="mt-1 bg-slate-800 border-white/10 text-white" value={testForm.name} onChange={e => setTestForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. CBC Blood Test" /></div>
                  <div><Label className="text-slate-400 text-xs">Price (₹) *</Label><Input className="mt-1 bg-slate-800 border-white/10 text-white" type="number" value={testForm.price} onChange={e => setTestForm(f => ({ ...f, price: e.target.value }))} placeholder="350" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-slate-400 text-xs">Report Turnaround</Label><Input className="mt-1 bg-slate-800 border-white/10 text-white" value={testForm.turnaroundTime} onChange={e => setTestForm(f => ({ ...f, turnaroundTime: e.target.value }))} placeholder="24 hrs" /></div>
                  <div><Label className="text-slate-400 text-xs">Preparation</Label><Input className="mt-1 bg-slate-800 border-white/10 text-white" value={testForm.preparation} onChange={e => setTestForm(f => ({ ...f, preparation: e.target.value }))} placeholder="Fasting 8 hrs" /></div>
                </div>
                <div><Label className="text-slate-400 text-xs">Description</Label><Input className="mt-1 bg-slate-800 border-white/10 text-white" value={testForm.description} onChange={e => setTestForm(f => ({ ...f, description: e.target.value }))} placeholder="Short description" /></div>
                <div className="flex gap-2">
                  <Button onClick={() => saveTest.mutate(testForm)} disabled={!testForm.name || !testForm.price || saveTest.isPending} className="bg-emerald-500 text-slate-950 hover:bg-emerald-400">{saveTest.isPending ? "Saving..." : editingTestId ? "Update Test" : "Add Test"}</Button>
                  {editingTestId && <Button variant="outline" onClick={() => { setEditingTestId(null); setTestForm({ name: "", price: "", description: "", preparation: "", turnaroundTime: "24 hrs" }); }}>Cancel</Button>}
                </div>
              </CardContent>
            </Card>

            {/* Tests list */}
            <Card className="bg-slate-900 border-white/10">
              <CardHeader><CardTitle className="text-white text-base">Test Catalogue ({labTests.length})</CardTitle></CardHeader>
              <CardContent>
                {labTests.length === 0 ? <p className="text-slate-400 text-sm py-4 text-center">No tests added yet</p> : (
                  <div className="space-y-2">
                    {labTests.map(t => (
                      <div key={t.id} className="flex items-center justify-between bg-slate-800 rounded-xl px-4 py-3">
                        <div>
                          <p className="font-semibold text-white text-sm">{t.name}</p>
                          <p className="text-xs text-slate-400">{money(t.price)} · {t.turnaroundTime}{t.preparation ? ` · ${t.preparation}` : ""}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="border-white/10 text-slate-300 h-8 px-2" onClick={() => { setEditingTestId(t.id); setTestForm({ name: t.name, price: String(t.price), description: t.description ?? "", preparation: t.preparation ?? "", turnaroundTime: t.turnaroundTime }); }}><Edit3 size={13} /></Button>
                          <Button size="sm" variant="destructive" className="h-8 px-2" onClick={() => deleteTest.mutate(t.id)}><Trash2 size={13} /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Test Bookings */}
            <Card className="bg-slate-900 border-white/10">
              <CardHeader><CardTitle className="text-white text-base">Test Bookings ({testBookings.length})</CardTitle></CardHeader>
              <CardContent>
                {testBookings.length === 0 ? <p className="text-slate-400 text-sm py-4 text-center">No bookings yet</p> : (
                  <div className="space-y-3">
                    {testBookings.map(b => (
                      <div key={b.id} className="bg-slate-800 rounded-xl p-4">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div>
                            <p className="font-semibold text-white text-sm">{b.userName} · {b.userPhone}</p>
                            <p className="text-xs text-slate-400">{b.tests.map((t: any) => t.name).join(", ")}</p>
                            <p className="text-xs text-slate-400 mt-0.5">{b.date} · {b.timeSlot} · {b.collectionType === "home" ? "🏠 " + b.address : "🏥 Walk-in"}</p>
                            <p className="text-xs text-emerald-400 font-bold mt-1">{money(b.total)}</p>
                          </div>
                          <span className={`text-xs font-bold px-2 py-1 rounded-full shrink-0 ${b.status === "Report Ready" ? "bg-emerald-500/20 text-emerald-400" : b.status === "Cancelled" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}`}>{b.status}</span>
                        </div>
                        <select value={b.status} onChange={e => updateBookingStatus.mutate({ id: b.id, status: e.target.value })} className="w-full bg-slate-700 border border-white/10 text-white text-xs rounded-lg px-3 py-1.5">
                          {["Pending", "Confirmed", "Sample Collected", "Report Ready", "Cancelled"].map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
