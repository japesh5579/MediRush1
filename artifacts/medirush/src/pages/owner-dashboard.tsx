import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, DollarSign, Edit3, ListOrdered, LogOut, Package, Plus, Tags, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { getGetDashboardSummaryQueryKey, getListCategoriesQueryKey, getListMedicinesQueryKey, getListOrdersQueryKey, Medicine, useCreateCategory, useCreateMedicine, useDeleteCategory, useDeleteMedicine, useGetDashboardSummary, useListCategories, useListMedicines, useListOrders, useUpdateMedicine } from "@workspace/api-client-react";

const emptyMedicine = { name: "", price: "", categoryId: "", imageUrl: "", description: "" };
const money = (value: number) => `₹${value.toFixed(0)}`;

export default function OwnerDashboard() {
  const { logout } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [medicineForm, setMedicineForm] = useState(emptyMedicine);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");

  const { data: summary, isLoading } = useGetDashboardSummary();
  const { data: medicines } = useListMedicines();
  const { data: categories } = useListCategories();
  const { data: orders } = useListOrders();

  const refreshOwnerData = () => {
    queryClient.invalidateQueries({ queryKey: getListMedicinesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
  };

  const createMedicine = useCreateMedicine({ mutation: { onSuccess: () => { refreshOwnerData(); setMedicineForm(emptyMedicine); toast({ title: "Medicine added", description: "Catalogue updated." }); } } });
  const updateMedicine = useUpdateMedicine({ mutation: { onSuccess: () => { refreshOwnerData(); setMedicineForm(emptyMedicine); setEditingId(null); toast({ title: "Medicine updated", description: "Changes saved." }); } } });
  const deleteMedicine = useDeleteMedicine({ mutation: { onSuccess: () => { refreshOwnerData(); toast({ title: "Medicine deleted", description: "Item removed from catalogue." }); } } });
  const createCategory = useCreateCategory({ mutation: { onSuccess: () => { refreshOwnerData(); setCategoryName(""); toast({ title: "Category added", description: "Category is ready for medicines." }); } } });
  const deleteCategory = useDeleteCategory({ mutation: { onSuccess: refreshOwnerData } });

  const handleLogout = () => {
    logout();
    setLocation("/");
  };

  const saveMedicine = () => {
    const fallbackCategory = medicineForm.categoryId || categories?.[0]?.id || "";
    const data = {
      name: medicineForm.name,
      price: Number(medicineForm.price),
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
    setMedicineForm({ name: medicine.name, price: String(medicine.price), categoryId: medicine.categoryId, imageUrl: medicine.imageUrl, description: medicine.description });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/90 px-5 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500 text-slate-950"><Activity size={23} /></div>
            <div>
              <span className="block text-xl font-black tracking-tight">Medirush Admin</span>
              <span className="text-xs text-emerald-200">Owner operations dashboard</span>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={handleLogout}>
            <LogOut size={16} className="mr-2" /> Logout
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
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

        <section className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
          <Card className="border-white/10 bg-white text-slate-950">
            <CardHeader>
              <CardTitle>{editingId ? "Edit medicine" : "Add medicine"}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label>Name</Label>
                <Input value={medicineForm.name} onChange={(event) => setMedicineForm({ ...medicineForm, name: event.target.value })} placeholder="Medicine name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Price</Label>
                  <Input type="number" value={medicineForm.price} onChange={(event) => setMedicineForm({ ...medicineForm, price: event.target.value })} placeholder="120" />
                </div>
                <div className="grid gap-2">
                  <Label>Category</Label>
                  <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={medicineForm.categoryId} onChange={(event) => setMedicineForm({ ...medicineForm, categoryId: event.target.value })}>
                    <option value="">Select</option>
                    {categories?.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Image URL</Label>
                <Input value={medicineForm.imageUrl} onChange={(event) => setMedicineForm({ ...medicineForm, imageUrl: event.target.value })} placeholder="Paste image URL or leave blank" />
              </div>
              <div className="grid gap-2">
                <Label>Description</Label>
                <Input value={medicineForm.description} onChange={(event) => setMedicineForm({ ...medicineForm, description: event.target.value })} placeholder="Short medicine description" />
              </div>
              <div className="flex gap-2">
                <Button onClick={saveMedicine} disabled={createMedicine.isPending || updateMedicine.isPending} className="flex-1">
                  <Plus size={16} className="mr-2" /> {editingId ? "Save changes" : "Add medicine"}
                </Button>
                {editingId && <Button variant="outline" onClick={() => { setEditingId(null); setMedicineForm(emptyMedicine); }}>Cancel</Button>}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white text-slate-950">
            <CardHeader>
              <CardTitle>Manage categories</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="New category" />
                <Button onClick={() => categoryName.trim() && createCategory.mutate({ data: { name: categoryName } })}>Add</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {categories?.map((category) => (
                  <span key={category.id} className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                    {category.name}
                    <button type="button" onClick={() => deleteCategory.mutate({ id: category.id })} className="text-red-500"><Trash2 size={13} /></button>
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-white/10 bg-white text-slate-950">
            <CardHeader>
              <CardTitle>Medicine catalogue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {medicines?.map((medicine) => (
                <div key={medicine.id} className="flex items-center gap-3 rounded-2xl border p-3">
                  <img src={medicine.imageUrl} alt={medicine.name} className="h-14 w-14 rounded-xl object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{medicine.name}</p>
                    <p className="text-sm text-slate-500">{medicine.categoryName} · {money(medicine.price)}</p>
                  </div>
                  <Button size="icon" variant="outline" onClick={() => editMedicine(medicine)}><Edit3 size={15} /></Button>
                  <Button size="icon" variant="destructive" onClick={() => deleteMedicine.mutate({ id: medicine.id })}><Trash2 size={15} /></Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white text-slate-950">
            <CardHeader>
              <CardTitle>Recent orders</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {orders?.length ? orders.slice(-5).reverse().map((order) => (
                <div key={order.id} className="rounded-2xl bg-slate-50 p-3">
                  <p className="font-bold">{money(order.total)} · {order.paymentMethod.toUpperCase()}</p>
                  <p className="text-sm text-slate-500">{order.status}, ETA {order.etaMinutes} min</p>
                  <p className="mt-1 truncate text-xs text-slate-400">{order.deliveryAddress}</p>
                </div>
              )) : <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No orders yet.</p>}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
