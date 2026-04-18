import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AuthProvider, useAuth } from "@/lib/auth";

import AuthPage from "@/pages/auth";
import SignupPage from "@/pages/signup";
import UserDashboard from "@/pages/user-dashboard";
import OwnerDashboard from "@/pages/owner-dashboard";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component, allowedRole, ...rest }: any) {
  const { user } = useAuth();

  if (!user) {
    return <Redirect to="/" />;
  }

  if (allowedRole && user.role !== allowedRole) {
    return <Redirect to={user.role === 'owner' ? '/owner' : '/user'} />;
  }

  return <Component {...rest} />;
}

function Router() {
  const { user } = useAuth();

  return (
    <Switch>
      <Route path="/">
        {user ? (
          <Redirect to={user.role === 'owner' ? '/owner' : '/user'} />
        ) : (
          <AuthPage />
        )}
      </Route>
      <Route path="/signup" component={SignupPage} />
      <Route path="/user">
        <ProtectedRoute component={UserDashboard} allowedRole="user" />
      </Route>
      <Route path="/owner">
        <ProtectedRoute component={OwnerDashboard} allowedRole="owner" />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;