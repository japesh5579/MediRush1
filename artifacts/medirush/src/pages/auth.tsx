import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useLogin } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Activity } from "lucide-react";

const loginSchema = z.object({
  identifier: z.string().min(2, "Email or phone is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const { toast } = useToast();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      identifier: "",
      password: "",
    },
  });

  const loginMutation = useLogin();

  const onSubmit = (data: LoginFormValues) => {
    loginMutation.mutate(
      { data },
      {
        onSuccess: (res) => {
          login(res.user, res.token);
          toast({ title: "Welcome back", description: "Successfully logged in." });
          setLocation(res.user.role === "owner" ? "/owner" : "/user");
        },
        onError: (err: any) => {
          form.setError("identifier", { message: err?.message || "Invalid email/phone or password" });
        },
      }
    );
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md mb-8 flex flex-col items-center">
        <div className="w-16 h-16 bg-primary text-primary-foreground rounded-2xl flex items-center justify-center mb-4 shadow-lg">
          <Activity size={32} />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Medirush</h1>
        <p className="text-muted-foreground mt-2">10-minute medicine delivery.</p>
      </div>

      <Card className="w-full max-w-md shadow-xl border-border/50">
        <CardHeader>
          <CardTitle>Sign In</CardTitle>
          <CardDescription>Enter your credentials to access your account</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="identifier"
                render={({ field }) => (
                  <FormItem>
                    <Label>Email or Phone</Label>
                    <FormControl>
                      <Input autoComplete="username" placeholder="Enter your email or phone" {...field} />
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
                      <Input type="password" autoComplete="current-password" placeholder="Enter your password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full mt-4" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </Form>
        </CardContent>

        <CardFooter className="flex justify-center border-t p-4">
          <p className="text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link href="/signup" className="text-primary font-medium hover:underline">
              Sign up
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}