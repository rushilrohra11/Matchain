import { lazy, Suspense, useState, useEffect } from 'react';
import { NavLink, Route, Routes, Link, useLocation } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Blocks,
  FlaskConical,
  Home,
  LogIn,
  LogOut,
  ShoppingCart,
  Sparkles,
  Wallet,
  Wrench,
  UserCheck,
  Edit3,
} from 'lucide-react';
import { networkConfig, walletConfigured } from './services/contractClient';
import { useWalletState } from './services/wallet';
import { useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import EditProfileModal from './components/EditProfileModal';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const DiscoveryPage = lazy(() => import('./pages/DiscoveryPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const MarketplacePage = lazy(() => import('./pages/MarketplacePage'));
const RegistryPage = lazy(() => import('./pages/RegistryPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AuthPage = lazy(() => import('./pages/AuthPage'));

const navItems = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/dashboard', label: 'Dashboard', icon: Activity },
  { to: '/discovery', label: 'Discovery', icon: FlaskConical },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/marketplace', label: 'Marketplace', icon: ShoppingCart },
  { to: '/registry', label: 'Registry', icon: Blocks },
  { to: '/settings', label: 'Settings', icon: Wrench },
];

export default function App() {
  const location = useLocation();
  const wallet = useWalletState();
  const { user, userProfile, logOut, linkWalletAddress } = useAuth();
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);

  const address = wallet?.address ?? null;
  const chainId = wallet?.chainId ?? null;
  const connected = wallet?.connected ?? false;
  const correctNetwork = wallet?.correctNetwork ?? false;

  // Auto-sync connected MetaMask wallet address to Firestore user profile
  useEffect(() => {
    if (user && connected && address) {
      if (userProfile && userProfile.walletAddress !== address) {
        void linkWalletAddress(address);
      }
    }
  }, [user, connected, address, userProfile?.walletAddress, linkWalletAddress]);

  // Check if current route is a standalone auth route
  const isAuthRoute = ['/login', '/signup', '/auth'].includes(location.pathname);

  // If on login/signup page, render standalone full-screen view (no app sidebar/header)
  if (isAuthRoute) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">Loading portal…</div>}>
        <AuthPage />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col lg:flex-row">
        {/* Main Application Sidebar */}
        <aside className="border-b border-slate-800 bg-slate-950/95 p-5 lg:w-72 lg:border-b-0 lg:border-r">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-300">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="text-lg font-semibold">MatChain</div>
              <div className="text-xs text-slate-400">Materials Intelligence</div>
            </div>
          </div>

          <nav className="flex flex-col gap-2">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={label}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
                    isActive ? 'bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-500/40' : 'text-slate-300 hover:bg-slate-800'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className={`mt-8 rounded-2xl border p-4 ${correctNetwork ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
            <div className={`flex items-center gap-2 text-sm font-medium ${correctNetwork ? 'text-emerald-200' : 'text-amber-200'}`}>
              <Wallet className="h-4 w-4" />
              {correctNetwork ? networkConfig.chainName : `Target chain ${networkConfig.chainId}`}
            </div>
            <p className="mt-2 text-xs text-slate-300">
              {walletConfigured ? 'Transactions require MetaMask and a confirmed local chain.' : 'Deploy the contracts, configure frontend addresses, then restart Vite.'}
            </p>
          </div>
        </aside>

        {/* Main Workspace Area */}
        <main className="flex-1 p-4 md:p-8">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            {/* Wallet Status Badge (Green/Red Pulsing Light with explicit status text) */}
            <div className="flex items-center gap-2">
              {connected ? (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
                  <span className="relative flex h-2.5 w-2.5" title="Wallet Connected">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]"></span>
                  </span>
                  <span className="font-medium">Connected</span>
                  <span className="font-mono text-[11px] text-emerald-400/80">({address?.slice(0, 6)}…{address?.slice(-4)})</span>
                  {!correctNetwork && <span className="ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300 border border-amber-500/30">Wrong Chain</span>}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
                  <span className="relative flex h-2.5 w-2.5" title="Wallet Disconnected">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.9)]"></span>
                  </span>
                  <span className="font-medium">Not Connected</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              {/* User Profile Badge / Sign In Button */}
              {user ? (
                <div className="flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/90 pl-3 pr-2 py-1.5 text-xs shadow-md">
                  <button
                    type="button"
                    onClick={() => setIsEditProfileOpen(true)}
                    className="flex items-center gap-2 hover:opacity-80 transition text-left group"
                    title="Click to edit profile"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/20 font-semibold text-indigo-300 group-hover:ring-1 group-hover:ring-indigo-400">
                      {userProfile?.displayName ? userProfile.displayName.charAt(0).toUpperCase() : 'U'}
                    </div>
                    <div className="hidden sm:block text-left">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-slate-100">{userProfile?.displayName || user.email?.split('@')[0]}</span>
                        <Edit3 className="h-3 w-3 text-slate-500 group-hover:text-indigo-300" />
                      </div>
                      <div className="text-[10px] text-indigo-300 truncate max-w-[140px]">{userProfile?.role || 'Materials Scientist'}</div>
                    </div>
                  </button>

                  <div className="h-4 w-px bg-slate-800 mx-1" />

                  <button
                    type="button"
                    onClick={() => void logOut()}
                    title="Sign Out"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-300 transition"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <Link
                  to="/login"
                  className="button-secondary flex items-center gap-2 py-1.5 text-xs text-indigo-200 hover:text-white"
                >
                  <LogIn className="h-3.5 w-3.5 text-indigo-300" />
                  <span>Sign In</span>
                </Link>
              )}

              {/* Dedicated Connect / Disconnect Wallet Button */}
              {!connected ? (
                <button
                  type="button"
                  className="button-primary flex items-center gap-2 py-1.5 px-3.5 text-xs shadow-md shadow-indigo-600/20"
                  onClick={() => void wallet?.connect().catch(() => undefined)}
                >
                  <Wallet className="h-4 w-4" />
                  <span>Connect Wallet</span>
                </button>
              ) : !correctNetwork ? (
                <button
                  type="button"
                  className="button-primary flex items-center gap-2 py-1.5 px-3.5 text-xs bg-amber-600 hover:bg-amber-500 shadow-md"
                  onClick={() => void wallet?.switchNetwork().catch(() => undefined)}
                >
                  <span>Switch to Ganache</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="button-secondary flex items-center gap-2 py-1.5 px-3 text-xs hover:border-rose-500/50 hover:text-rose-300 transition"
                  onClick={() => wallet?.disconnect()}
                >
                  <span>Disconnect</span>
                </button>
              )}
            </div>
          </div>

          {wallet?.error && <p role="alert" className="mb-4 text-sm text-rose-300">{wallet.error}</p>}

          {/* Application Routing with Protected Routes */}
          <Routes>
            {/* Public Landing Page */}
            <Route path="/" element={<Suspense fallback={<div className="card p-6 text-slate-300">Loading page…</div>}><LandingPage /></Suspense>} />

            {/* Protected Routes: Require authenticated researcher account */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Suspense fallback={<div className="card p-6 text-slate-300">Loading page…</div>}><DashboardPage /></Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="/discovery"
              element={
                <ProtectedRoute>
                  <Suspense fallback={<div className="card p-6 text-slate-300">Loading page…</div>}><DiscoveryPage /></Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="/analytics"
              element={
                <ProtectedRoute>
                  <Suspense fallback={<div className="card p-6 text-slate-300">Loading page…</div>}><AnalyticsPage /></Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="/marketplace"
              element={
                <ProtectedRoute>
                  <Suspense fallback={<div className="card p-6 text-slate-300">Loading page…</div>}><MarketplacePage /></Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="/registry"
              element={
                <ProtectedRoute>
                  <Suspense fallback={<div className="card p-6 text-slate-300">Loading page…</div>}><RegistryPage /></Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <Suspense fallback={<div className="card p-6 text-slate-300">Loading page…</div>}><SettingsPage /></Suspense>
                </ProtectedRoute>
              }
            />
          </Routes>
        </main>
      </div>

      {/* Interactive Edit Profile Modal */}
      <EditProfileModal
        isOpen={isEditProfileOpen}
        onClose={() => setIsEditProfileOpen(false)}
      />
    </div>
  );
}
