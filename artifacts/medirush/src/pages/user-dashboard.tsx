import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, ChevronRight, Clock, FileImage, Home, LogOut, MapPin, Minus, Package, Plus, Search, ShoppingCart, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getGetCartQueryKey, getListOrdersQueryKey, useAddCartItem, useCreateOrder, useGetCart, useGetPaymentConfig, useListCategories, useListMedicines, useRemoveCartItem, useUpdateCartItem, useUploadPrescription, useListOrders } from "@workspace/api-client-react";

const money = (value: number) => `₹${value.toFixed(0)}`;

type Tab = "home" | "orders" | "account";

export default function UserDashboard() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [showCart, setShowCart] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [deliveryAddress, setDeliveryAddress] = useState(user?.location ?? "");
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "upi">("cod");
  const [prescriptionId, setPrescriptionId] = useState<string | undefined>();

  const medicineParams = useMemo(() => ({ search: searchQuery || undefined, categoryId }), [searchQuery, categoryId]);
  const { data: medicines, isLoading: loadingMedicines } = useListMedicines(medicineParams);
  const { data: categories } = useListCategories();
  const { data: cart } = useGetCart();
  const { data: paymentConfig } = useGetPaymentConfig();
  const { data: orders } = useListOrders();

  const refreshCart = () => queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
  const onCartError = () => toast({ title: "Could not update cart", description: "Please log in again or check your connection.", variant: "destructive" });
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
      }
    }
  });

  const cartCount = cart?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0;
  const cartTotal = cart?.total ?? 0;

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

  const checkout = () => createOrder.mutate({ data: { paymentMethod, deliveryAddress, prescriptionId } });

  return (
    <div className="min-h-[100dvh] bg-gray-50 text-slate-900 max-w-md mx-auto relative" style={{ paddingBottom: 'calc(7rem + env(safe-area-inset-bottom))' }}>
      {/* Header */}
      <header className="sticky top-0 z-30 bg-green-600 px-4 pt-4 pb-3 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Activity size={22} className="text-white" />
            <span className="text-white font-black text-lg tracking-tight">Medirush</span>
            <span className="bg-yellow-400 text-yellow-900 text-[10px] font-bold px-2 py-0.5 rounded-full">10 MIN</span>
          </div>
          <button onClick={() => setShowCart(true)} className="relative p-2">
            <ShoppingCart size={22} className="text-white" />
            {cartCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{cartCount}</span>
            )}
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
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </header>

      {/* Tab: Home */}
      {activeTab === "home" && (
        <main className="px-3 pt-4 space-y-5">
          {/* Delivery banner */}
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex items-center gap-3">
            <div className="bg-green-600 rounded-xl p-2.5">
              <Clock size={20} className="text-white" />
            </div>
            <div>
              <p className="font-bold text-green-800">Medicine in 10-20 minutes</p>
              <p className="text-xs text-green-600">Pharmacy verified · Fast delivery</p>
            </div>
          </div>

          {/* Categories */}
          <section>
            <h2 className="font-bold text-base mb-2.5">Categories</h2>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              <button
                onClick={() => setCategoryId(undefined)}
                className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold border transition ${!categoryId ? "bg-green-600 text-white border-green-600" : "bg-white text-slate-600 border-slate-200"}`}
              >All</button>
              {categories?.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setCategoryId(categoryId === cat.id ? undefined : cat.id)}
                  className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold border transition ${categoryId === cat.id ? "bg-green-600 text-white border-green-600" : "bg-white text-slate-600 border-slate-200"}`}
                >{cat.name}</button>
              ))}
            </div>
          </section>

          {/* Products */}
          <section>
            <h2 className="font-bold text-base mb-2.5">{searchQuery ? `Results for "${searchQuery}"` : "All Medicines"}</h2>
            {loadingMedicines ? (
              <div className="grid grid-cols-2 gap-3">
                {[1,2,3,4].map(i => <div key={i} className="h-52 bg-white rounded-2xl animate-pulse" />)}
              </div>
            ) : medicines?.length === 0 ? (
              <div className="text-center py-12 text-slate-400">No medicines found</div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {medicines?.map(med => {
                  const qty = getItemQty(med.id);
                  return (
                    <div key={med.id} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100">
                      <div className="relative">
                        <img src={med.imageUrl} alt={med.name} className="w-full h-28 object-cover" />
                      </div>
                      <div className="p-3 space-y-1.5">
                        <p className="font-bold text-sm leading-tight line-clamp-2">{med.name}</p>
                        <p className="text-xs text-slate-400">{med.categoryName}</p>
                        <div className="flex items-center justify-between pt-1">
                          <span className="font-black text-sm text-slate-900">{money(med.price)}</span>
                          {qty === 0 ? (
                            <button
                              onClick={() => handleAdd(med.id)}
                              className="bg-white border-2 border-green-600 text-green-600 font-bold text-sm px-3 py-1 rounded-lg hover:bg-green-50 transition"
                            >Add</button>
                          ) : (
                            <div className="flex items-center gap-1 border-2 border-green-600 rounded-lg overflow-hidden">
                              <button onClick={() => handleDec(med.id, qty)} className="bg-green-600 text-white px-2 py-1 hover:bg-green-700"><Minus size={12} /></button>
                              <span className="text-green-700 font-bold text-sm px-1.5">{qty}</span>
                              <button onClick={() => handleInc(med.id, qty)} className="bg-green-600 text-white px-2 py-1 hover:bg-green-700"><Plus size={12} /></button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
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
          ) : [...orders].reverse().map(order => (
            <div key={order.id} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-green-700">{money(order.total)}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${order.status === "Placed" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>{order.status}</span>
              </div>
              <p className="text-xs text-slate-500">ETA: {order.etaMinutes} min · {order.paymentMethod.toUpperCase()}</p>
              <p className="text-xs text-slate-400 truncate mt-1">{order.deliveryAddress}</p>
              <div className="mt-2 pt-2 border-t border-slate-100">
                {(order.items as any[]).map((item: any, idx: number) => (
                  <p key={idx} className="text-xs text-slate-600">{item.medicine?.name} × {item.quantity}</p>
                ))}
              </div>
            </div>
          ))}
        </main>
      )}

      {/* Tab: Account */}
      {activeTab === "account" && (
        <main className="px-3 pt-4 space-y-4">
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-green-600 flex items-center justify-center text-white text-2xl font-black">
              {user?.fullName?.[0]?.toUpperCase()}
            </div>
            <div>
              <p className="font-bold text-lg">{user?.fullName}</p>
              <p className="text-sm text-slate-500">{user?.email}</p>
              <p className="text-sm text-slate-500">{user?.phone}</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Delivery Address</p>
              <p className="text-sm font-medium mt-0.5">{user?.location}</p>
            </div>
          </div>
          <button
            onClick={() => { logout(); setLocation("/"); }}
            className="w-full bg-red-50 text-red-600 font-semibold rounded-2xl py-3.5 flex items-center justify-center gap-2"
          >
            <LogOut size={18} /> Sign Out
          </button>
        </main>
      )}

      {/* Sticky cart bar */}
      {cartCount > 0 && !showCart && (
        <div className="fixed bottom-16 left-0 right-0 z-20 px-3 max-w-md mx-auto" style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}>
          <button
            onClick={() => setShowCart(true)}
            className="w-full bg-green-600 text-white rounded-2xl px-4 py-3.5 flex items-center justify-between shadow-2xl"
          >
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
          <div className="bg-white rounded-t-3xl max-h-[85vh] flex flex-col shadow-2xl max-w-md mx-auto w-full">
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
                  <div>
                    <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Delivery Address</Label>
                    <Input className="mt-1" value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} placeholder="Enter delivery address" />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Prescription (optional)</Label>
                    <Input type="file" accept="image/*" className="mt-1" onChange={e => handlePrescription(e.target.files?.[0])} />
                    {prescriptionId && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><FileImage size={12} /> Prescription attached</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setPaymentMethod("cod")}
                      className={`py-2.5 rounded-xl text-sm font-bold border-2 transition ${paymentMethod === "cod" ? "border-green-600 bg-green-50 text-green-700" : "border-slate-200 text-slate-500"}`}
                    >Cash on Delivery</button>
                    <button
                      onClick={() => setPaymentMethod("upi")}
                      className={`py-2.5 rounded-xl text-sm font-bold border-2 transition ${paymentMethod === "upi" ? "border-green-600 bg-green-50 text-green-700" : "border-slate-200 text-slate-500"}`}
                    >UPI</button>
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
                <div className="flex items-center justify-between mb-3 text-sm">
                  <span className="text-slate-500">Total</span>
                  <span className="font-black text-lg">{money(cartTotal)}</span>
                </div>
                <button
                  onClick={checkout}
                  disabled={createOrder.isPending || !deliveryAddress.trim()}
                  className="w-full bg-green-600 disabled:opacity-50 text-white font-bold py-4 rounded-2xl text-base"
                >
                  {createOrder.isPending ? "Placing order..." : `Place Order · ETA 10-20 min`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
