import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, CheckCircle2, FileImage, LogOut, Minus, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getGetCartQueryKey, getListOrdersQueryKey, useAddCartItem, useCreateOrder, useGetCart, useGetPaymentConfig, useListCategories, useListMedicines, useRemoveCartItem, useUpdateCartItem, useUploadPrescription } from "@workspace/api-client-react";

const money = (value: number) => `₹${value.toFixed(0)}`;

export default function UserDashboard() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [showCart, setShowCart] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState(user?.location ?? "");
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "upi">("cod");
  const [prescriptionId, setPrescriptionId] = useState<string | undefined>();
  const [lastOrderEta, setLastOrderEta] = useState<number | null>(null);

  const medicineParams = useMemo(() => ({ search: searchQuery || undefined, categoryId }), [searchQuery, categoryId]);
  const { data: medicines, isLoading: loadingMedicines } = useListMedicines(medicineParams);
  const { data: categories } = useListCategories();
  const { data: cart } = useGetCart();
  const { data: paymentConfig } = useGetPaymentConfig();

  const refreshCart = () => queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
  const addCartItem = useAddCartItem({ mutation: { onSuccess: () => { refreshCart(); toast({ title: "Added to cart", description: "Medicine added for fast delivery." }); } } });
  const updateCartItem = useUpdateCartItem({ mutation: { onSuccess: refreshCart } });
  const removeCartItem = useRemoveCartItem({ mutation: { onSuccess: refreshCart } });
  const uploadPrescription = useUploadPrescription({ mutation: { onSuccess: (prescription) => { setPrescriptionId(prescription.id); toast({ title: "Prescription uploaded", description: "You can continue checkout." }); } } });
  const createOrder = useCreateOrder({ mutation: { onSuccess: (order) => { setLastOrderEta(order.etaMinutes); setShowCart(false); refreshCart(); queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() }); toast({ title: "Order placed successfully", description: `Estimated delivery in ${order.etaMinutes} minutes.` }); } } });

  const handleLogout = () => {
    logout();
    setLocation("/");
  };

  const handlePrescription = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => uploadPrescription.mutate({ data: { fileName: file.name, dataUrl: String(reader.result) } });
    reader.readAsDataURL(file);
  };

  const checkout = () => {
    createOrder.mutate({ data: { paymentMethod, deliveryAddress, prescriptionId } });
  };

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-emerald-50 via-white to-slate-100 pb-24 text-slate-950">
      <header className="sticky top-0 z-20 border-b border-emerald-100 bg-white/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3 text-emerald-700">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-200">
              <Activity size={22} />
            </div>
            <div>
              <span className="block text-lg font-black tracking-tight">Medirush</span>
              <span className="text-xs font-medium text-slate-500">10-minute medicine delivery</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="relative rounded-full border-emerald-200" onClick={() => setShowCart((value) => !value)}>
              <ShoppingCart size={19} />
              {cart?.items && cart.items.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {cart.items.length}
                </span>
              )}
            </Button>
            <Button variant="ghost" size="icon" onClick={handleLogout} className="rounded-full">
              <LogOut size={19} />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 p-4">
        <section className="rounded-[2rem] bg-emerald-600 p-5 text-white shadow-2xl shadow-emerald-200">
          <p className="text-sm font-medium text-emerald-100">Delivering to {user?.location}</p>
          <h1 className="mt-2 text-3xl font-black leading-tight">Pharmacy essentials at your door in 10-20 minutes.</h1>
          <div className="mt-5 rounded-2xl bg-white p-2 shadow-inner">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <Input className="h-12 rounded-xl border-0 bg-slate-50 pl-10 text-slate-950" placeholder="Search medicines or symptoms" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
            </div>
          </div>
        </section>

        {lastOrderEta && (
          <Card className="border-emerald-200 bg-emerald-50">
            <CardContent className="flex items-center gap-3 p-4 text-emerald-800">
              <CheckCircle2 size={24} />
              <div>
                <p className="font-bold">Order placed successfully</p>
                <p className="text-sm">Estimated delivery time: {lastOrderEta} minutes.</p>
              </div>
            </CardContent>
          </Card>
        )}

        <section className="space-y-3">
          <h2 className="text-lg font-bold">Categories</h2>
          <div className="flex gap-2 overflow-x-auto pb-1">
            <Button className="shrink-0 rounded-full" variant={!categoryId ? "default" : "secondary"} onClick={() => setCategoryId(undefined)}>All</Button>
            {categories?.map((category) => (
              <Button key={category.id} className="shrink-0 rounded-full" variant={categoryId === category.id ? "default" : "secondary"} onClick={() => setCategoryId(category.id)}>
                {category.name}
              </Button>
            ))}
          </div>
        </section>

        {showCart && (
          <Card className="border-emerald-100 shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Your cart</span>
                <span className="text-emerald-700">{money(cart?.total ?? 0)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {cart?.items.length ? cart.items.map((item) => (
                <div key={item.medicine.id} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
                  <img src={item.medicine.imageUrl} alt={item.medicine.name} className="h-14 w-14 rounded-xl object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{item.medicine.name}</p>
                    <p className="text-sm text-slate-500">{money(item.medicine.price)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="outline" className="h-8 w-8 rounded-full" onClick={() => updateCartItem.mutate({ medicineId: item.medicine.id, data: { quantity: item.quantity - 1 } })}><Minus size={14} /></Button>
                    <span className="w-7 text-center text-sm font-bold">{item.quantity}</span>
                    <Button size="icon" variant="outline" className="h-8 w-8 rounded-full" onClick={() => updateCartItem.mutate({ medicineId: item.medicine.id, data: { quantity: item.quantity + 1 } })}><Plus size={14} /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full text-red-500" onClick={() => removeCartItem.mutate({ medicineId: item.medicine.id })}><Trash2 size={14} /></Button>
                  </div>
                </div>
              )) : <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Your cart is empty. Add medicines to begin checkout.</p>}

              <div className="grid gap-3 rounded-2xl border border-dashed border-emerald-200 p-4">
                <Label htmlFor="prescription">Prescription upload optional</Label>
                <Input id="prescription" type="file" accept="image/*" onChange={(event) => handlePrescription(event.target.files?.[0])} />
                {prescriptionId && <p className="flex items-center gap-2 text-sm font-medium text-emerald-700"><FileImage size={16} /> Prescription attached</p>}
              </div>

              <div className="grid gap-3">
                <Label htmlFor="address">Delivery address</Label>
                <Input id="address" value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} placeholder="Enter delivery address" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button variant={paymentMethod === "cod" ? "default" : "outline"} onClick={() => setPaymentMethod("cod")}>Cash on Delivery</Button>
                <Button variant={paymentMethod === "upi" ? "default" : "outline"} onClick={() => setPaymentMethod("upi")}>UPI Payment</Button>
              </div>

              {paymentMethod === "upi" && (
                <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-4">
                  <img src={paymentConfig?.qrCodeImageUrl} alt="UPI QR code" className="h-20 w-20 rounded-xl object-cover" />
                  <div>
                    <p className="text-sm text-slate-500">Pay to UPI ID</p>
                    <Input className="mt-1" value={paymentConfig?.upiId ?? "medirush@upi"} readOnly />
                  </div>
                </div>
              )}

              <Button className="h-12 w-full rounded-2xl text-base font-bold" disabled={!cart?.items.length || createOrder.isPending || !deliveryAddress.trim()} onClick={checkout}>
                {createOrder.isPending ? "Placing order..." : "Place order, ETA 10-20 min"}
              </Button>
            </CardContent>
          </Card>
        )}

        <section className="space-y-3">
          <h2 className="text-lg font-bold">Popular medicines</h2>
          {loadingMedicines ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((item) => <div key={item} className="h-56 animate-pulse rounded-3xl bg-white" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {medicines?.map((medicine) => (
                <Card key={medicine.id} className="overflow-hidden rounded-3xl border-emerald-100 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
                  <img src={medicine.imageUrl} alt={medicine.name} className="h-28 w-full object-cover" />
                  <CardContent className="space-y-3 p-3">
                    <div>
                      <p className="truncate font-bold">{medicine.name}</p>
                      <p className="truncate text-xs text-slate-500">{medicine.categoryName}</p>
                    </div>
                    <p className="line-clamp-2 min-h-9 text-xs text-slate-500">{medicine.description}</p>
                    <div className="flex items-center justify-between">
                      <span className="font-black text-emerald-700">{money(medicine.price)}</span>
                      <Button size="sm" className="rounded-xl" onClick={() => addCartItem.mutate({ data: { medicineId: medicine.id, quantity: 1 } })}>Add</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
