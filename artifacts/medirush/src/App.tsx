import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useState, useEffect } from "react";

import AuthPage from "@/pages/auth";
import SignupPage from "@/pages/signup";
import UserDashboard from "@/pages/user-dashboard";
import OwnerDashboard from "@/pages/owner-dashboard";

const queryClient = new QueryClient();

function SplashScreen({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 1800);
    const doneTimer = setTimeout(() => onDone(), 2400);
    return () => { clearTimeout(fadeTimer); clearTimeout(doneTimer); };
  }, [onDone]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "linear-gradient(160deg, #00C853 0%, #007A33 100%)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        transition: "opacity 0.6s ease",
        opacity: fading ? 0 : 1,
        pointerEvents: fading ? "none" : "all",
      }}
    >
      {/* Logo circle */}
      <div style={{
        width: 112, height: 112, borderRadius: "50%",
        background: "rgba(255,255,255,0.22)",
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 24,
        boxShadow: "0 12px 48px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.4)",
      }}>
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          {/* Pill capsule shape */}
          <rect x="4" y="20" width="56" height="24" rx="12" fill="white" opacity="0.95"/>
          {/* Left half tint */}
          <path d="M4 32a12 12 0 0 1 12-12h16v24H16A12 12 0 0 1 4 32z" fill="#00C853" opacity="0.22"/>
          {/* Center divider */}
          <rect x="31.5" y="20" width="1.5" height="24" fill="#00A846" opacity="0.35"/>
          {/* Speed lines (left of pill) */}
          <rect x="0" y="26" width="8" height="2.5" rx="1.25" fill="white" opacity="0.5"/>
          <rect x="0" y="32" width="5" height="2.5" rx="1.25" fill="white" opacity="0.35"/>
          <rect x="0" y="38" width="6" height="2.5" rx="1.25" fill="white" opacity="0.4"/>
        </svg>
      </div>

      {/* App name */}
      <div style={{ color: "white", fontSize: 36, fontWeight: 900, letterSpacing: "-1px", fontFamily: "Inter, sans-serif" }}>
        Medirush
      </div>

      {/* Tagline */}
      <div style={{
        marginTop: 8,
        background: "rgba(255,255,255,0.2)",
        color: "white",
        fontSize: 13, fontWeight: 700,
        padding: "4px 16px", borderRadius: 20,
        letterSpacing: "0.5px",
        fontFamily: "Inter, sans-serif",
      }}>
        ⚡ Medicine in 10 Minutes
      </div>

      {/* Dots loader */}
      <div style={{ display: "flex", gap: 8, marginTop: 48 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "rgba(255,255,255,0.7)",
            animation: `splash-bounce 1s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>

      <style>{`
        @keyframes splash-bounce {
          0%, 100% { transform: translateY(0); opacity: 0.5; }
          50% { transform: translateY(-10px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

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
  const [showSplash, setShowSplash] = useState(true);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </AuthProvider>
        <Toaster />
        {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;