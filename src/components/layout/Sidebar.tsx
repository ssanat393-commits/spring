import {
  Activity,
  AlertTriangle,
  BarChart3,
  Cpu,
  FlaskConical,
  Layers,
  LayoutDashboard,
  Link2,
  Server,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type { NavPageId } from '../../../shared/types';

interface SidebarProps {
  activePage: NavPageId;
  onSelectPage: (page: NavPageId) => void;
  openAlertsCount: number;
  demoModeEnabled: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{
  id: NavPageId;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'monitoring', label: 'Live Monitoring', icon: Activity },
  { id: 'hosts', label: 'Hosts', icon: Server },
  { id: 'connect-devices', label: 'Connect Devices', icon: Link2 },
  { id: 'tier2-saas', label: 'Tier 2 SaaS', icon: Layers },
  { id: 'alerts', label: 'Alerts & Incidents', icon: AlertTriangle },
  { id: 'ai-insights', label: 'AI Insights', icon: Sparkles },
  { id: 'egress-proof', label: 'Egress Proof', icon: ShieldCheck },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
  { id: 'demo-mode', label: 'Demo Mode', icon: FlaskConical },
];

export function Sidebar({
  activePage,
  onSelectPage,
  openAlertsCount,
  demoModeEnabled,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const navContent = (
    <div className="flex flex-col h-full bg-white dark:bg-[#0A101E] border-r border-slate-200 dark:border-slate-800/80 w-64 shrink-0">
      <div className="flex items-center justify-between px-5 h-16 border-b border-slate-200 dark:border-slate-800/80">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 via-blue-600 to-purple-600 flex items-center justify-center text-white shrink-0">
            <Cpu className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="font-display font-bold text-sm tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
              CICADA 2026
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap truncate">
              Smart Observability
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
          aria-label="Close navigation menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectPage(item.id);
                onCloseMobile();
              }}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-cyan-500/12 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/50 border border-transparent'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-cyan-500' : ''}`} />
                <span className="truncate">{item.label}</span>
              </span>
              {item.id === 'alerts' && openAlertsCount > 0 && (
                <span className="font-mono tabular-nums text-xs font-semibold text-red-600 dark:text-red-400">
                  {openAlertsCount}
                </span>
              )}
              {item.id === 'demo-mode' && demoModeEnabled && (
                <span className="text-[10px] font-mono font-semibold text-purple-600 dark:text-purple-400">
                  ON
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-200 dark:border-slate-800/80 text-xs text-slate-500 dark:text-slate-400">
        <div className="font-medium text-slate-700 dark:text-slate-300">Privacy-First Architecture</div>
        <div className="mt-1">Raw credentials and user paths remain local in SQLite.</div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block shrink-0">{navContent}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 h-full">{navContent}</aside>
        </div>
      )}
    </>
  );
}
