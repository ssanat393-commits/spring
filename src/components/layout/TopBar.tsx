import { Menu, ShieldCheck } from 'lucide-react';
import type { NavPageId } from '../../../shared/types';

interface TopBarProps {
  activePage: NavPageId;
  wsConnected: boolean;
  demoModeEnabled: boolean;
  operatorName: string;
  onOpenMobileMenu: () => void;
  onNavigate: (page: NavPageId) => void;
}

const PAGE_TITLES: Record<NavPageId, string> = {
  overview: 'Overview',
  monitoring: 'Live Monitoring',
  hosts: 'Hosts',
  'connect-devices': 'Connect Devices',
  'tier2-saas': 'Tier 2 SaaS Control Plane',
  alerts: 'Alerts & Incidents',
  'ai-insights': 'AI Insights',
  'egress-proof': 'Egress Proof',
  reports: 'Reports',
  settings: 'Settings',
  'demo-mode': 'Demo Mode',
};

export function TopBar({
  activePage,
  wsConnected,
  demoModeEnabled,
  operatorName,
  onOpenMobileMenu,
  onNavigate,
}: TopBarProps) {
  return (
    <header className="h-16 px-3 sm:px-6 border-b border-slate-200 dark:border-slate-800/80 bg-white/85 dark:bg-[#0A101E]/85 backdrop-blur-md flex items-center justify-between gap-2 sm:gap-4 shrink-0 sticky top-0 z-30">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 shrink-0"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="text-slate-500 dark:text-slate-400 hidden sm:inline whitespace-nowrap">
            CICADA 2026
          </span>
          <span className="text-slate-400 hidden sm:inline" aria-hidden="true">
            /
          </span>
          <h1 className="font-display font-semibold text-slate-900 dark:text-slate-100 truncate">
            {PAGE_TITLES[activePage]}
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        {demoModeEnabled && (
          <button
            type="button"
            onClick={() => onNavigate('demo-mode')}
            className="text-[11px] sm:text-xs font-mono font-semibold text-purple-700 dark:text-purple-300 bg-purple-500/12 border border-purple-500/30 px-2 sm:px-2.5 py-1 rounded-md whitespace-nowrap hover:bg-purple-500/20 transition-colors"
            title="Simulated telemetry active"
          >
            DEMO DATA
          </button>
        )}

        <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
          <span
            className={`w-2 h-2 rounded-full ${
              wsConnected ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
            aria-hidden="true"
          />
          <span>{wsConnected ? 'Stream Connected' : 'Polling Fallback'}</span>
          <span aria-hidden="true">·</span>
          <span className="text-slate-700 dark:text-slate-300 font-medium">{operatorName}</span>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('egress-proof')}
          className="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors whitespace-nowrap shrink-0"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Inspect Egress Proof</span>
          <span className="sm:hidden">Egress Proof</span>
        </button>
      </div>
    </header>
  );
}
