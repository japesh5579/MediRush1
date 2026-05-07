import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, Bookmark, ChevronDown, ChevronRight, ChevronUp, Clock, FileImage, Home, LogOut, MapPin, Minus, Package, Plus, Printer, RefreshCw, Search, ShoppingCart, Star, Trash2, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getGetCartQueryKey, getListOrdersQueryKey, useAddCartItem, useCreateOrder, useGetCart, useGetPaymentConfig, useListCategories, useListMedicines, useRemoveCartItem, useUpdateCartItem, useUploadPrescription, useListOrders } from "@workspace/api-client-react";
import type { Medicine, Order } from "@workspace/api-client-react";

const money = (value: number) => `₹${value.toFixed(0)}`;

type Tab = "home" | "orders" | "account";
type SavedAddress = { id: string; label: string; address: string; createdAt: string };

const FAQ_ITEMS = [
  { q: "How long does delivery take?", a: "We deliver in 10-20 minutes from the nearest pharmacy." },
  { q: "Can I cancel my order?", a: "Yes, tap Cancel on any order that is still in 'Placed' status." },
  { q: "Do you accept prescriptions?", a: "Yes, you can upload a prescription photo when placing your order." },
  { q: "What payment methods are accepted?", a: "Cash on Delivery (COD) and UPI payment." },
  { q: "Is there a delivery charge?", a: "No! Delivery is completely free on all orders." },
  { q: "Can I reorder from past orders?", a: "Yes, tap Reorder on any past order to add all items back to cart." },
  { q: "How do I rate an order?", a: "After delivery, tap the stars on your order to leave a rating." },
];

const STATUS_STEPS = ["Placed", "Out for Delivery", "Delivered"];

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

function printBill(order: Order) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<html><head><title>Medirush Bill</title><style>
    body{font-family:Arial,sans-serif;max-width:400px;margin:20px auto;padding:16px}
    h1{color:#16a34a;margin:0 0 4px}
    .row{display:flex;justify-content:space-between;margin:4px 0;font-size:14px}
    .bold{font-weight:700}.total{border-top:2px solid #000;padding-top:8px;margin-top:8px}
    .green{color:#16a34a}.strike{text-decoration:line-through;color:#999}
    hr{border:none;border-top:1px solid #ccc;margin:12px 0}
  </style></head><body>
    <h1>Medirush</h1>
    <p style="margin:0;color:#666;font-size:13px">Order ID: ${order.id}</p>
    <p style="margin:0;color:#666;font-size:13px">${new Date(order.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
    <p style="margin:4px 0;font-size:13px">Status: <strong>${order.status}</strong></p>
    <hr>
    <p class="bold" style="margin:0 0 6px">Items</p>
    ${(order.items as any[]).map(item => `<div class="row"><span>${item.medicine?.name} × ${item.quantity}</span><span>₹${(item.medicine?.price * item.quantity).toFixed(0)}</span></div>`).join("")}
    <hr>
    <div class="row"><span>Subtotal</span><span>₹${order.total.toFixed(0)}</span></div>
    <div class="row"><span>Delivery</span><span><span class="strike">₹50</span> <span class="green bold">FREE</span></span></div>
    <div class="row bold total"><span>Total Paid</span><span class="green">₹${order.total.toFixed(0)}</span></div>
    <hr>
    <p style="font-size:12px;color:#666">Payment: ${order.paymentMethod.toUpperCase()}<br>Delivered to: ${order.deliveryAddress}</p>
  </body></html>`);
  w.document.close();
  w.print();
}

export default function UserDashboard() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [showCart, setShowCart] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [deliveryAddress, setDeliveryAddress] = useState(user?.location ?? "");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "upi">("cod");
  const [prescriptionId, setPrescriptionId] = useState<string | undefined>();
  const [viewingMedicine, setViewingMedicine] = useState<Medicine | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [addrLabel, setAddrLabel] = useState("");
  const [savingAddr, setSavingAddr] = useState(false);

  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("mrh_search_history") ?? "[]"); } catch { return []; }
  });
  const [recentlyViewed, setRecentlyViewed] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("mrh_recently_viewed") ?? "[]"); } catch { return []; }
  });

  const medicineParams = useMemo(() => ({ search: searchQuery || undefined }), [searchQuery]);
  const { data: medicines, isLoading: loadingMedicines } = useListMedicines(medicineParams);
  const filteredMedicines = useMemo(() => {
    if (!medicines) return [];
    return categoryId ? medicines.filter((m) => m.categoryId === categoryId) : medicines;
  }, [medicines, categoryId]);
  const medicinesByCategory = useMemo(() => {
    const map = new Map<string, NonNullable<typeof medicines>>();
    filteredMedicines.forEach((med) => {
      const arr = map.get(med.categoryId) ?? [];
      arr.push(med);
      map.set(med.categoryId, arr);
    });
    return map;
  }, [filteredMedicines]);

  const { data: categories } = useListCategories();
  const { data: cart } = useGetCart();
  const { data: paymentConfig } = useGetPaymentConfig();
  const { data: orders } = useListOrders();

  const { data: savedAddresses = [], refetch: refetchAddresses } = useQuery<SavedAddress[]>({
    queryKey: ["saved-addresses"],
    queryFn: () => authFetch("/api/medirush/saved-addresses"),
  });

  const cancelOrder = useMutation({
    mutationFn: (orderId: string) => authFetch(`/api/medirush/orders/${orderId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      toast({ title: "Order cancelled" });
    },
    onError: (e: any) => toast({ title: "Cannot cancel", description: e.message, variant: "destructive" }),
  });

  const rateOrder = useMutation({
    mutationFn: ({ orderId, rating }: { orderId: string; rating: number }) =>
      authFetch(`/api/medirush/orders/${orderId}/rate`, { method: "POST", body: JSON.stringify({ rating }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() }),
  });

  const saveAddress = useMutation({
    mutationFn: ({ label, address }: { label: string; address: string }) =>
      authFetch("/api/medirush/saved-addresses", { method: "POST", body: JSON.stringify({ label, address }) }),
    onSuccess: () => { refetchAddresses(); setSavingAddr(false); setAddrLabel(""); toast({ title: "Address saved" }); },
  });

  const deleteAddress = useMutation({
    mutationFn: (addrId: string) => authFetch(`/api/medirush/saved-addresses/${addrId}`, { method: "DELETE" }),
    onSuccess: () => refetchAddresses(),
  });

  const refreshCart = () => queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
  const onCartError = () => toast({ title: "Could not update cart", variant: "destructive" });
  const addCartItem = useAddCartItem({ mutation: { onSuccess: refreshCart, onError: onCartError } });
  const updateCartItem = useUpdateCartItem({ mutation: { onSuccess: refreshCart, onError: onCartError } });
  const removeCartItem = useRemoveCartItem({ mutation: { onSuccess: refreshCart, onError: onCartError } });
  const uploadPrescription = useUploadPrescription({ mutation: { onSuccess: (p) => { setPrescriptionId(p.id); toast({ title: "Prescription uploaded" }); } } });
  const createOrder = useCreateOrder({
    mutation: {
      onSuccess: (order) => {
        setShowCart(false);
        refreshCart();
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        toast({ title: "Order placed!", description: `Delivery in ${order.etaMinutes} min` });
        setActiveTab("orders");
      },
    },
  });

  const cartCount = cart?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0;
  const cartTotal = cart?.total ?? 0;
  const cartSavings = useMemo(() => {
    return cart?.items.reduce((sum, item) => {
      const saving = item.medicine.mrp ? Math.max(0, (item.medicine.mrp - item.medicine.price) * item.quantity) : 0;
      return sum + saving;
    }, 0) ?? 0;
  }, [cart]);

  const getItemQty = (medicineId: string) => cart?.items.find(i => i.medicine.id === medicineId)?.quantity ?? 0;
  const handleAdd = (medicineId: string) => addCartItem.mutate({ data: { medicineId, quantity: 1 } });
  const handleInc = (medicineId: string, qty: number) => updateCartItem.mutate({ medicineId, data: { quantity: qty + 1 } });
  const handleDec = (medicineId: string, qty: number) => updateCartItem.mutate({ medicineId, data: { quantity: qty - 1 } });

  const handlePrescription = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => uploadPrescription.mutate({ data: { fileName: file.name, dataUrl: String(reader.result) } });
    reader.readAsDataURL(file);
  };

  const checkout = () => createOrder.mutate({ data: { paymentMethod, deliveryAddress, prescriptionId, deliveryInstructions: deliveryInstructions.trim() || undefined } });

  const handleViewProduct = (med: Medicine) => {
    setViewingMedicine(med);
    const current = JSON.parse(localStorage.getItem("mrh_recently_viewed") ?? "[]") as string[];
    const updated = [med.id, ...current.filter(id => id !== med.id)].slice(0, 12);
    localStorage.setItem("mrh_recently_viewed", JSON.stringify(updated));
    setRecentlyViewed(updated);
  };

  const handleSearchSubmit = (q: string) => {
    if (!q.trim() || q.trim().length < 2) return;
    const current = JSON.parse(localStorage.getItem("mrh_search_history") ?? "[]") as string[];
    const updated = [q.trim(), ...current.filter(s => s !== q.trim())].slice(0, 6);
    localStorage.setItem("mrh_search_history", JSON.stringify(updated));
    setSearchHistory(updated);
  };

  const handleReorder = async (orderItems: Order["items"]) => {
    for (const item of orderItems) {
      await addCartItem.mutateAsync({ data: { medicineId: item.medicine.id, quantity: item.quantity } });
    }
    setActiveTab("home");
    setShowCart(true);
    toast({ title: "Added to cart", description: "All items from this order were added" });
  };

  const searchSuggestions = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2 || !medicines) return [];
    const q = searchQuery.toLowerCase();
    return medicines.filter(m => m.name.toLowerCase().startsWith(q)).slice(0, 5).map(m => m.name);
  }, [searchQuery, medicines]);

  const buyAgainItems = useMemo(() => {
    if (!orders?.length || !medicines) return [];
    const seen = new Set<string>();
    const items: Medicine[] = [];
    [...orders].reverse().forEach(order => {
      (order.items as any[]).forEach(item => {
        if (!seen.has(item.medicine.id)) {
          seen.add(item.medicine.id);
          const live = medicines.find(m => m.id === item.medicine.id);
          if (live) items.push(live);
        }
      });
    });
    return items.slice(0, 10);
  }, [orders, medicines]);

  const recentlyViewedMedicines = useMemo(() => {
    if (!medicines || !recentlyViewed.length) return [];
    return recentlyViewed.map(id => medicines.find(m => m.id === id)).filter(Boolean) as Medicine[];
  }, [medicines, recentlyViewed]);

  const ProductCard = ({ med, size = "grid" }: { med: Medicine; size?: "grid" | "scroll" }) => {
    const qty = getItemQty(med.id);
    const discount = med.mrp && med.mrp > med.price ? Math.round((med.mrp - med.price) / med.mrp * 100) : 0;
    const lowStock = med.stock !== undefined && med.stock <= 10;
    if (size === "scroll") {
      return (
        <div className="shrink-0 w-36 bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100">
          <div className="relative cursor-pointer" onClick={() => handleViewProduct(med)}>
            <img src={med.imageUrl} alt={med.name} className="w-full h-[100px] object-cover" />
            {lowStock && med.stock! > 0 && <span className="absolute top-1.5 left-1.5 bg-orange-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full">Only {med.stock} left</span>}
            {lowStock && med.stock === 0 && <span className="absolute top-1.5 left-1.5 bg-red-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full">Out of stock</span>}
          </div>
          <div className="p-2.5 space-y-1">
            <p className="font-bold text-xs leading-tight line-clamp-2 cursor-pointer" onClick={() => handleViewProduct(med)}>{med.name}</p>
            {med.company && <p className="text-[10px] text-slate-400 truncate">{med.company}</p>}
            <div>
              {discount > 0 && <p className="text-[10px] text-slate-400 line-through leading-none">{money(med.mrp!)}</p>}
              <p className="font-black text-sm text-slate-900">{money(med.price)}</p>
            </div>
            {qty === 0 ? (
              <button onClick={() => handleAdd(med.id)} disabled={med.stock === 0} className="w-full border-2 border-green-600 text-green-600 font-bold text-xs py-1 rounded-lg hover:bg-green-50 transition disabled:opacity-40 disabled:cursor-not-allowed">+ Add</button>
            ) : (
              <div className="flex items-center justify-between border-2 border-green-600 rounded-lg overflow-hidden">
                <button onClick={() => handleDec(med.id, qty)} className="bg-green-600 text-white px-2 py-1"><Minus size={10} /></button>
                <span className="text-green-700 font-bold text-xs">{qty}</span>
                <button onClick={() => handleInc(med.id, qty)} className="bg-green-600 text-white px-2 py-1"><Plus size={10} /></button>
              </div>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100">
        <div className="relative cursor-pointer" onClick={() => handleViewProduct(med)}>
          <img src={med.imageUrl} alt={med.name} className="w-full h-28 object-cover" />
          {lowStock && med.stock! > 0 && <span className="absolute top-1.5 left-1.5 bg-orange-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">Only {med.stock} left</span>}
          {lowStock && med.stock === 0 && <span className="absolute top-1.5 left-1.5 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">Out of stock</span>}
        </div>
        <div className="p-3 space-y-1">
          <p className="font-bold text-sm leading-tight line-clamp-2 cursor-pointer" onClick={() => handleViewProduct(med)}>{med.name}</p>
          {med.company && <p className="text-[11px] text-slate-400 truncate">{med.company}</p>}
          <div className="flex items-end justify-between pt-1 gap-1">
            <div>
              {discount > 0 && <p className="text-[10px] text-slate-400 line-through leading-none">{money(med.mrp!)}</p>}
              <span className="font-black text-sm text-slate-900">{money(med.price)}</span>
            </div>
            {qty === 0 ? (
              <button onClick={() => handleAdd(med.id)} disabled={med.stock === 0} className="shrink-0 border-2 border-green-600 text-green-600 font-bold text-xs px-2.5 py-1 rounded-lg hover:bg-green-50 transition disabled:opacity-40 disabled:cursor-not-allowed">Add</button>
            ) : (
              <div className="shrink-0 flex items-center gap-0.5 border-2 border-green-600 rounded-lg overflow-hidden">
                <button onClick={() => handleDec(med.id, qty)} className="bg-green-600 text-white px-1.5 py-1"><Minus size={11} /></button>
                <span className="text-green-700 font-bold text-xs px-1">{qty}</span>
                <button onClick={() => handleInc(med.id, qty)} className="bg-green-600 text-white px-1.5 py-1"><Plus size={11} /></button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-[100dvh] bg-gray-50 text-slate-900 max-w-md mx-auto relative" style={{ paddingBottom: 'calc(7rem + env(safe-area-inset-bottom))' }}>
      {/* Header */}
      <header className="sticky top-0 z-30 bg-green-600 px-4 pb-3 shadow-lg" style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Activity size={22} className="text-white" />
            <span className="text-white font-black text-lg tracking-tight">Medirush</span>
            <span className="bg-yellow-400 text-yellow-900 text-[10px] font-bold px-2 py-0.5 rounded-full">10 MIN</span>
          </div>
          <button onClick={() => setShowCart(true)} className="relative p-2">
            <ShoppingCart size={22} className="text-white" />
            {cartCount > 0 && <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{cartCount}</span>}
          </button>
        </div>
        <div className="flex items-center gap-1.5 mb-3">
          <MapPin size={14} className="text-green-200 shrink-0" />
          <span className="text-green-100 text-sm truncate">Delivering to <span className="text-white font-semibold">{user?.location}</span></span>
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full bg-white rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 outline-none"
            placeholder="Search medicines, vitamins..."
            value={searchQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearchSubmit(searchQuery)}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2"><X size={14} className="text-slate-400" /></button>
          )}
        </div>
        {/* Search suggestions / history dropdown */}
        {searchFocused && (
          <div className="absolute left-4 right-4 top-full mt-1 bg-white rounded-xl shadow-xl z-50 overflow-hidden">
            {searchQuery.length >= 2 && searchSuggestions.length > 0 ? (
              searchSuggestions.map((s, i) => (
                <button key={i} onMouseDown={() => { setSearchQuery(s); handleSearchSubmit(s); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2">
                  <Search size={13} className="text-slate-400" /> {s}
                </button>
              ))
            ) : !searchQuery && searchHistory.length > 0 ? (
              <>
                <p className="px-4 pt-2.5 pb-1 text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Recent</p>
                {searchHistory.map((s, i) => (
                  <button key={i} onMouseDown={() => setSearchQuery(s)} className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 flex items-center gap-2">
                    <Clock size={13} className="text-slate-400" /> {s}
                  </button>
                ))}
              </>
            ) : null}
          </div>
        )}
      </header>

      {/* Tab: Home */}
      {activeTab === "home" && (
        <main className="px-3 pt-4 space-y-5">
          {/* Buy Again */}
          {buyAgainItems.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2.5">
                <h2 className="font-bold text-base">Buy Again</h2>
                <span className="text-xs text-slate-400">{buyAgainItems.length} item{buyAgainItems.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-3 px-3 scrollbar-hide">
                {buyAgainItems.map(med => <ProductCard key={med.id} med={med} size="scroll" />)}
              </div>
            </section>
          )}

          {/* Recently Viewed */}
          {recentlyViewedMedicines.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2.5">
                <h2 className="font-bold text-base">Recently Viewed</h2>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-3 px-3 scrollbar-hide">
                {recentlyViewedMedicines.map(med => <ProductCard key={med.id} med={med} size="scroll" />)}
              </div>
            </section>
          )}

          {/* Delivery banner */}
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex items-center gap-3">
            <div className="bg-green-600 rounded-xl p-2.5"><Clock size={20} className="text-white" /></div>
            <div>
              <p className="font-bold text-green-800">Medicine in 10-20 minutes</p>
              <p className="text-xs text-green-600">Pharmacy verified · Free delivery</p>
            </div>
          </div>

          {/* Categories */}
          <section>
            <h2 className="font-bold text-base mb-2.5">Categories</h2>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              <button onClick={() => setCategoryId(undefined)} className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold border transition ${!categoryId ? "bg-green-600 text-white border-green-600" : "bg-white text-slate-600 border-slate-200"}`}>All</button>
              {categories?.map(cat => (
                <button key={cat.id} onClick={() => setCategoryId(categoryId === cat.id ? undefined : cat.id)} className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold border transition ${categoryId === cat.id ? "bg-green-600 text-white border-green-600" : "bg-white text-slate-600 border-slate-200"}`}>{cat.name}</button>
              ))}
            </div>
          </section>

          {/* Products */}
          <section className="space-y-5">
            {loadingMedicines ? (
              <div className="grid grid-cols-2 gap-3">{[1,2,3,4].map(i => <div key={i} className="h-52 bg-white rounded-2xl animate-pulse" />)}</div>
            ) : searchQuery ? (
              <>
                <h2 className="font-bold text-base">{`Results for "${searchQuery}"`}</h2>
                {filteredMedicines.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">No medicines found</div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {filteredMedicines.map(med => <ProductCard key={med.id} med={med} size="grid" />)}
                  </div>
                )}
              </>
            ) : (
              (categoryId ? categories?.filter(c => c.id === categoryId) : categories)?.map(cat => {
                const catMeds = medicinesByCategory.get(cat.id) ?? [];
                if (catMeds.length === 0) return null;
                return (
                  <div key={cat.id}>
                    <div className="flex items-center justify-between mb-2.5">
                      <h2 className="font-bold text-base">{cat.name}</h2>
                      <span className="text-xs text-slate-400">{catMeds.length} item{catMeds.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-2 -mx-3 px-3 scrollbar-hide">
                      {catMeds.map(med => <ProductCard key={med.id} med={med} size="scroll" />)}
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </main>
      )}

      {/* Tab: Orders */}
      {activeTab === "orders" && (
        <main className="px-3 pt-4 space-y-3">
          <h2 className="font-bold text-lg">Your Orders</h2>
          {!orders?.length ? (
            <div className="text-center py-16 text-slate-400">
              <Package size={48} className="mx-auto mb-3 opacity-30" />
              <p>No orders yet</p>
            </div>
          ) : [...orders].reverse().map(order => {
            const stepIndex = order.status === "Cancelled" ? -1 : STATUS_STEPS.indexOf(order.status);
            return (
              <div key={order.id} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                {/* Receipt header */}
                <div className={`px-4 py-3 flex items-center justify-between ${order.status === "Cancelled" ? "bg-red-500" : "bg-green-600"}`}>
                  <div>
                    <p className="text-white font-bold text-sm">Order Receipt</p>
                    <p className="text-green-200 text-[10px]">{new Date(order.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${order.status === "Placed" ? "bg-blue-100 text-blue-700" : order.status === "Cancelled" ? "bg-white text-red-600" : "bg-white text-green-700"}`}>{order.status}</span>
                </div>

                {/* Status timeline */}
                {order.status !== "Cancelled" && (
                  <div className="px-4 py-3 flex items-center gap-0">
                    {STATUS_STEPS.map((step, i) => (
                      <div key={step} className="flex items-center flex-1">
                        <div className="flex flex-col items-center">
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[9px] font-bold ${i <= stepIndex ? "bg-green-600 border-green-600 text-white" : "bg-white border-slate-300 text-slate-300"}`}>{i < stepIndex ? "✓" : i + 1}</div>
                          <span className={`text-[9px] mt-0.5 text-center leading-tight ${i <= stepIndex ? "text-green-700 font-semibold" : "text-slate-400"}`}>{step}</span>
                        </div>
                        {i < STATUS_STEPS.length - 1 && <div className={`flex-1 h-0.5 mb-3 ${i < stepIndex ? "bg-green-600" : "bg-slate-200"}`} />}
                      </div>
                    ))}
                  </div>
                )}

                {/* Items */}
                <div className="px-4 py-2 space-y-1">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mb-1">Items</p>
                  {(order.items as any[]).map((item: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700 flex-1 mr-2">{item.medicine?.name} <span className="text-slate-400">× {item.quantity}</span></span>
                      <span className="font-semibold shrink-0">{item.medicine?.price != null ? money(item.medicine.price * item.quantity) : ""}</span>
                    </div>
                  ))}
                </div>

                {/* Bill summary */}
                <div className="px-4 pb-3 pt-2 border-t border-slate-100 space-y-1 text-sm">
                  <div className="flex items-center justify-between text-slate-500">
                    <span>Subtotal</span><span>{money(order.total)}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-500">
                    <span>Delivery</span>
                    <span className="flex items-center gap-1.5"><span className="line-through text-slate-400 text-xs">₹50</span><span className="text-green-600 font-bold text-xs">FREE</span></span>
                  </div>
                  <div className="flex items-center justify-between font-bold border-t border-slate-100 pt-1.5">
                    <span>Total Paid</span><span className="text-green-700">{money(order.total)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                    <span>{order.paymentMethod.toUpperCase()}</span>
                    <span className="truncate ml-2 max-w-[55%] text-right">{order.deliveryAddress}</span>
                  </div>
                  {order.deliveryInstructions && (
                    <p className="text-[11px] text-slate-400 italic">Note: {order.deliveryInstructions}</p>
                  )}
                </div>

                {/* Action buttons */}
                <div className="px-4 pb-3 flex flex-wrap gap-2">
                  <button onClick={() => handleReorder(order.items)} className="flex items-center gap-1 bg-green-50 text-green-700 font-semibold text-xs px-3 py-1.5 rounded-xl border border-green-200">
                    <RefreshCw size={12} /> Reorder
                  </button>
                  {order.status === "Placed" && (
                    <button onClick={() => cancelOrder.mutate(order.id)} disabled={cancelOrder.isPending} className="flex items-center gap-1 bg-red-50 text-red-600 font-semibold text-xs px-3 py-1.5 rounded-xl border border-red-200 disabled:opacity-50">
                      <XCircle size={12} /> Cancel
                    </button>
                  )}
                  <button onClick={() => printBill(order)} className="flex items-center gap-1 bg-slate-50 text-slate-600 font-semibold text-xs px-3 py-1.5 rounded-xl border border-slate-200">
                    <Printer size={12} /> Print Bill
                  </button>
                </div>

                {/* Star rating */}
                {order.status === "Delivered" && (
                  <div className="px-4 pb-3 border-t border-slate-100 pt-2">
                    <p className="text-xs text-slate-500 mb-1.5">{order.rating ? "Your rating" : "Rate this order"}</p>
                    <div className="flex gap-1">
                      {[1,2,3,4,5].map(star => (
                        <button key={star} onClick={() => !order.rating && rateOrder.mutate({ orderId: order.id, rating: star })} disabled={!!order.rating}>
                          <Star size={20} className={star <= (order.rating ?? 0) ? "fill-yellow-400 text-yellow-400" : "text-slate-300"} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </main>
      )}

      {/* Tab: Account */}
      {activeTab === "account" && (
        <main className="px-3 pt-4 space-y-4">
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-green-600 flex items-center justify-center text-white text-2xl font-black">{user?.fullName?.[0]?.toUpperCase()}</div>
            <div>
              <p className="font-bold text-lg">{user?.fullName}</p>
              <p className="text-sm text-slate-500">{user?.email}</p>
              <p className="text-sm text-slate-500">{user?.phone}</p>
            </div>
          </div>

          {/* Saved Addresses */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bookmark size={16} className="text-green-600" />
                <p className="text-sm font-bold">Saved Addresses</p>
              </div>
              <button onClick={() => setSavingAddr(v => !v)} className="text-xs text-green-600 font-semibold">+ Add</button>
            </div>
            {savingAddr && (
              <div className="px-4 py-3 border-b border-slate-100 space-y-2">
                <Input placeholder="Label (e.g. Home, Office)" value={addrLabel} onChange={e => setAddrLabel(e.target.value)} className="text-sm" />
                <div className="flex gap-2">
                  <Input placeholder="Full address" value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} className="text-sm flex-1" />
                  <Button size="sm" onClick={() => saveAddress.mutate({ label: addrLabel, address: deliveryAddress })} disabled={!addrLabel.trim() || !deliveryAddress.trim() || saveAddress.isPending} className="bg-green-600 hover:bg-green-700">Save</Button>
                </div>
              </div>
            )}
            {savedAddresses.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-400">No saved addresses yet</p>
            ) : savedAddresses.map(addr => (
              <div key={addr.id} className="px-4 py-3 border-b border-slate-100 flex items-center justify-between last:border-0">
                <div>
                  <p className="text-sm font-semibold text-slate-700">{addr.label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{addr.address}</p>
                </div>
                <button onClick={() => deleteAddress.mutate(addr.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>

          {/* Help & FAQ */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-sm font-bold">Help & FAQ</p>
            </div>
            {FAQ_ITEMS.map((item, i) => (
              <div key={i} className="border-b border-slate-100 last:border-0">
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full px-4 py-3 flex items-center justify-between text-left">
                  <span className="text-sm font-medium text-slate-700">{item.q}</span>
                  {openFaq === i ? <ChevronUp size={16} className="text-slate-400 shrink-0 ml-2" /> : <ChevronDown size={16} className="text-slate-400 shrink-0 ml-2" />}
                </button>
                {openFaq === i && <p className="px-4 pb-3 text-sm text-slate-500">{item.a}</p>}
              </div>
            ))}
          </div>

          <button onClick={() => { logout(); setLocation("/"); }} className="w-full bg-red-50 text-red-600 font-semibold rounded-2xl py-3.5 flex items-center justify-center gap-2">
            <LogOut size={18} /> Sign Out
          </button>
        </main>
      )}

      {/* Sticky cart bar */}
      {cartCount > 0 && !showCart && (
        <div className="fixed bottom-16 left-0 right-0 z-20 px-3 max-w-md mx-auto" style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}>
          <button onClick={() => setShowCart(true)} className="w-full bg-green-600 text-white rounded-2xl px-4 py-3.5 flex items-center justify-between shadow-2xl">
            <span className="bg-green-700 text-white text-xs font-bold px-2 py-0.5 rounded-lg">{cartCount} item{cartCount > 1 ? "s" : ""}</span>
            <span className="font-bold">View cart</span>
            <span className="font-bold">{money(cartTotal)} <ChevronRight size={16} className="inline" /></span>
          </button>
        </div>
      )}

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200 max-w-md mx-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="grid grid-cols-3 py-1">
          {([
            { tab: "home" as Tab, icon: Home, label: "Home" },
            { tab: "orders" as Tab, icon: Package, label: "Orders" },
            { tab: "account" as Tab, icon: Activity, label: "Account" },
          ] as const).map(({ tab, icon: Icon, label }) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`flex flex-col items-center py-2 gap-0.5 ${activeTab === tab ? "text-green-600" : "text-slate-400"}`}>
              <Icon size={22} />
              <span className="text-[10px] font-semibold">{label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Cart Sheet */}
      {showCart && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={e => { if (e.target === e.currentTarget) setShowCart(false); }}>
          <div className="bg-white rounded-t-3xl max-h-[90vh] flex flex-col shadow-2xl max-w-md mx-auto w-full">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-black text-lg">Your Cart</h3>
                <p className="text-xs text-slate-500">{cartCount} item{cartCount !== 1 ? "s" : ""}</p>
              </div>
              <button onClick={() => setShowCart(false)} className="p-2 rounded-full bg-slate-100"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3">
              {cart?.items.length === 0 ? (
                <div className="text-center py-10 text-slate-400">Your cart is empty</div>
              ) : cart?.items.map(item => (
                <div key={item.medicine.id} className="flex items-center gap-3 bg-slate-50 rounded-2xl p-3">
                  <img src={item.medicine.imageUrl} alt={item.medicine.name} className="w-14 h-14 rounded-xl object-cover" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">{item.medicine.name}</p>
                    <p className="text-xs text-slate-500">{money(item.medicine.price)} each</p>
                    {(item.medicine as any).mrp > item.medicine.price && (
                      <p className="text-[10px] text-green-600">Save {money(((item.medicine as any).mrp - item.medicine.price) * item.quantity)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 border-2 border-green-600 rounded-xl overflow-hidden">
                    <button onClick={() => handleDec(item.medicine.id, item.quantity)} className="bg-green-600 text-white px-2 py-1.5"><Minus size={12} /></button>
                    <span className="text-green-700 font-bold text-sm px-2">{item.quantity}</span>
                    <button onClick={() => handleInc(item.medicine.id, item.quantity)} className="bg-green-600 text-white px-2 py-1.5"><Plus size={12} /></button>
                  </div>
                </div>
              ))}

              {(cart?.items.length ?? 0) > 0 && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  {/* Saved address chips */}
                  {savedAddresses.length > 0 && (
                    <div>
                      <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Saved Addresses</Label>
                      <div className="flex gap-2 flex-wrap mt-1.5">
                        {savedAddresses.map(addr => (
                          <button key={addr.id} onClick={() => setDeliveryAddress(addr.address)} className={`text-xs px-3 py-1 rounded-full border font-medium transition ${deliveryAddress === addr.address ? "bg-green-600 text-white border-green-600" : "bg-white text-slate-600 border-slate-200"}`}>{addr.label}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Delivery Address</Label>
                    <Input className="mt-1" value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} placeholder="Enter delivery address" />
                  </div>

                  <div>
                    <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Delivery Instructions (optional)</Label>
                    <Input className="mt-1" value={deliveryInstructions} onChange={e => setDeliveryInstructions(e.target.value)} placeholder="e.g. Leave at door, Call on arrival" />
                  </div>

                  <div>
                    <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Prescription (optional)</Label>
                    <Input type="file" accept="image/*" className="mt-1" onChange={e => handlePrescription(e.target.files?.[0])} />
                    {prescriptionId && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><FileImage size={12} /> Prescription attached</p>}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setPaymentMethod("cod")} className={`py-2.5 rounded-xl text-sm font-bold border-2 transition ${paymentMethod === "cod" ? "border-green-600 bg-green-50 text-green-700" : "border-slate-200 text-slate-500"}`}>Cash on Delivery</button>
                    <button onClick={() => setPaymentMethod("upi")} className={`py-2.5 rounded-xl text-sm font-bold border-2 transition ${paymentMethod === "upi" ? "border-green-600 bg-green-50 text-green-700" : "border-slate-200 text-slate-500"}`}>UPI</button>
                  </div>

                  {paymentMethod === "upi" && (
                    <div className="bg-green-50 rounded-2xl p-3 flex items-center gap-3">
                      <img src={paymentConfig?.qrCodeImageUrl} alt="QR" className="w-16 h-16 rounded-xl object-cover" />
                      <div>
                        <p className="text-xs text-slate-500">Pay to UPI ID</p>
                        <p className="font-bold text-sm">{paymentConfig?.upiId ?? "medirush@upi"}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {(cart?.items.length ?? 0) > 0 && (
              <div className="px-4 pb-6 pt-3 border-t border-slate-100">
                <div className="space-y-1.5 mb-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Subtotal</span>
                    <span className="font-semibold">{money(cartTotal)}</span>
                  </div>
                  {cartSavings > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-green-600 font-medium">You save</span>
                      <span className="text-green-600 font-bold">-{money(cartSavings)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Delivery charges</span>
                    <span className="flex items-center gap-1.5"><span className="text-slate-400 line-through text-xs">₹50</span><span className="text-green-600 font-bold text-xs">FREE</span></span>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-100 pt-1.5">
                    <span className="font-bold">Total</span>
                    <span className="font-black text-lg">{money(cartTotal)}</span>
                  </div>
                </div>
                <button onClick={checkout} disabled={createOrder.isPending || !deliveryAddress.trim()} className="w-full bg-green-600 disabled:opacity-50 text-white font-bold py-4 rounded-2xl text-base">
                  {createOrder.isPending ? "Placing order..." : `Place Order · ETA 10-20 min`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Product Detail Modal */}
      {viewingMedicine && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={e => { if (e.target === e.currentTarget) setViewingMedicine(null); }}>
          <div className="bg-white rounded-t-3xl w-full max-w-md mx-auto max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="relative">
              <img src={viewingMedicine.imageUrl} alt={viewingMedicine.name} className="w-full h-52 object-cover rounded-t-3xl" />
              <button onClick={() => setViewingMedicine(null)} className="absolute top-3 right-3 bg-white/90 p-1.5 rounded-full shadow"><X size={18} /></button>
              {viewingMedicine.stock !== undefined && viewingMedicine.stock <= 10 && (
                <span className={`absolute top-3 left-3 text-white text-xs font-bold px-2.5 py-1 rounded-full ${viewingMedicine.stock === 0 ? "bg-red-500" : "bg-orange-500"}`}>
                  {viewingMedicine.stock === 0 ? "Out of stock" : `Only ${viewingMedicine.stock} left`}
                </span>
              )}
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <h2 className="font-black text-xl leading-tight">{viewingMedicine.name}</h2>
                {viewingMedicine.company && <p className="text-sm text-slate-500 mt-0.5">{viewingMedicine.company}</p>}
                <span className="inline-block mt-1 text-[11px] bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full">{viewingMedicine.categoryName}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-black text-slate-900">{money(viewingMedicine.price)}</span>
                {viewingMedicine.mrp && viewingMedicine.mrp > viewingMedicine.price && (
                  <>
                    <span className="text-slate-400 line-through text-base">{money(viewingMedicine.mrp)}</span>
                    <span className="text-green-600 font-bold text-sm">{Math.round((viewingMedicine.mrp - viewingMedicine.price) / viewingMedicine.mrp * 100)}% off</span>
                  </>
                )}
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">{viewingMedicine.description}</p>
              <div className="pt-2">
                {(() => {
                  const qty = getItemQty(viewingMedicine.id);
                  return qty === 0 ? (
                    <button onClick={() => { handleAdd(viewingMedicine.id); setViewingMedicine(null); }} disabled={viewingMedicine.stock === 0} className="w-full bg-green-600 text-white font-bold py-3.5 rounded-2xl text-base disabled:opacity-40">
                      {viewingMedicine.stock === 0 ? "Out of Stock" : "Add to Cart"}
                    </button>
                  ) : (
                    <div className="flex items-center justify-between border-2 border-green-600 rounded-2xl overflow-hidden">
                      <button onClick={() => handleDec(viewingMedicine.id, qty)} className="bg-green-600 text-white px-5 py-3"><Minus size={18} /></button>
                      <span className="text-green-700 font-black text-lg">{qty}</span>
                      <button onClick={() => handleInc(viewingMedicine.id, qty)} className="bg-green-600 text-white px-5 py-3"><Plus size={18} /></button>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
