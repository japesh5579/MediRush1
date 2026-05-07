import { useLocation, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useSignup } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Activity } from "lucide-react";

const signupSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  phone: z.string().min(8, "Valid phone number is required"),
  email: z.string().email("Valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  location: z.string().min(2, "Delivery location is required"),
});

type SignupFormValues = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const { toast } = useToast();

  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: "",
      phone: "",
      email: "",
      password: "",
      location: "",
    },
  });

  const signupMutation = useSignup();

  const onSubmit = (data: SignupFormValues) => {
    signupMutation.mutate(
      { data },
      {
        onSuccess: (res) => {
          login(res.user, res.token);
          toast({ title: "Account created", description: "Welcome to Medirush." });
          setLocation("/user");
        },
        onError: (err: any) => {
          form.setError("email", { message: err?.message || "Could not create account" });
        },
      }
    );
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-muted/30 p-4 py-12">
      <div className="w-full max-w-md mb-8 flex flex-col items-center">
        <Link href="/" className="w-16 h-16 bg-primary text-primary-foreground rounded-2xl flex items-center justify-center mb-4 shadow-lg hover:opacity-90 transition-opacity">
          <Activity size={32} />
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Create Account</h1>
        <p className="text-muted-foreground mt-2">Join Medirush for fast delivery.</p>
      </div>

      <Card className="w-full max-w-md shadow-xl border-border/50">
        <CardHeader>
          <CardTitle>Sign Up</CardTitle>
          <CardDescription>Fill in your details to get started</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <Label>Full Name</Label>
                    <FormControl>
                      <Input autoComplete="name" placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <Label>Email</Label>
                    <FormControl>
                      <Input type="email" autoComplete="email" placeholder="name@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <Label>Phone Number</Label>
                    <FormControl>
                      <Input autoComplete="tel" placeholder="9876543210" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <Label>Password</Label>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" placeholder="Create a password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <Label>Delivery Address</Label>
                    <FormControl>
                      <Input autoComplete="street-address" placeholder="MG Road, Bengaluru" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full mt-4" disabled={signupMutation.isPending}>
                {signupMutation.isPending ? "Creating account..." : "Create account"}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex justify-center border-t p-4">
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/" className="text-primary font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
