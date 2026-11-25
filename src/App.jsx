import React, { useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { AlertCircle, X } from 'lucide-react';
import { useStore } from './store/useStore';
import TopBar from './components/TopBar';
import LeftSidebar from './components/LeftSidebar';
import RightPanel from './components/RightPanel';
import MapCanvas from './components/MapCanvas';
import TrafficResearch from './components/TrafficResearch';
import AIAssistant from './components/AIAssistant';
import ProductSetupModal from './components/ProductSetupModal';
import StrategiesModal from './components/StrategiesModal';
import { generateAISuggestions } from './data/mockData';
import { useTranslation } from './i18n/useTranslation';
import { useCloudProjectsSync } from './hooks/useCloudProjectsSync';
import { useAdveserProjectsSync } from './hooks/useAdveserProjectsSync';
import { useOpenStrategyFromUrl } from './hooks/useOpenStrategyFromUrl';

// AUTH-003B - backend/routes/ssoRoutes.js redirects a failed sign-in
// back here as `?sso_error=<code>`, never a raw 500 or a dead end.
// Read it once on load, show it, then strip it from the URL so it
// doesn't reappear on refresh/share.
const KNOWN_SSO_ERRORS = new Set([
  'denied', 'invalid_state', 'config_error', 'token_exchange_failed', 'verification_failed',
]);

function useSsoErrorBanner() {
  const [code, setCode] = useState(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get('sso_error');
    if (errorCode) {
      setCode(KNOWN_SSO_ERRORS.has(errorCode) ? errorCode : 'generic');
      params.delete('sso_error');
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
      window.history.replaceState({}, '', next);
    }
  }, []);
  return [code, () => setCode(null)];
}

export default function App() {
  const { activeView, showSetup, showStrategies, setAiSuggestions, productInfo, initProjects } = useStore();
  const t = useTranslation();
  const [ssoErrorCode, dismissSsoError] = useSsoErrorBanner();
  useCloudProjectsSync();
  useAdveserProjectsSync();
  const strategyLoadState = useOpenStrategyFromUrl();

  useEffect(() => {
    initProjects();
    if (productInfo.name) {
      setAiSuggestions(generateAISuggestions(productInfo));
    }
  }, []); // eslint-disable-line

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#070818]">
      {ssoErrorCode && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-[12px] text-red-300">
          <AlertCircle size={13} className="flex-shrink-0" />
          <span className="flex-1">{t(`sso_error_${ssoErrorCode}`)}</span>
          <button onClick={dismissSsoError} className="p-0.5 rounded hover:bg-red-500/15 transition-colors">
            <X size={13} />
          </button>
        </div>
      )}
      <TopBar />

      {/* ADV-004-FIX-2 (final correction) - a direct `?strategy=<id>` open
          (the new tab this app's own import flow opens, or a reload of
          it) blocks the normal UI until it resolves, so the user never
          sees a flash of the default/empty canvas before the real
          content loads - loading/unauthorized/not-found/error are each
          shown distinctly, never collapsed into a silent fallback. Once
          'ready' (or when there was no ?strategy= param at all, 'idle'),
          the app renders completely normally - the loaded strategy is
          already on the canvas via the hook's own loadStrategy() call. */}
      {strategyLoadState !== 'idle' && strategyLoadState !== 'ready' ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="max-w-sm text-center space-y-2 px-6">
            {strategyLoadState === 'loading' && (
              <p className="text-sm text-slate-300">{t('open_strategy_loading')}</p>
            )}
            {strategyLoadState === 'unauthorized' && (
              <>
                <p className="text-sm text-slate-200 font-medium">{t('open_strategy_unauthorized_title')}</p>
                <p className="text-xs text-slate-400">{t('open_strategy_unauthorized_body')}</p>
              </>
            )}
            {strategyLoadState === 'not-found' && (
              <>
                <p className="text-sm text-slate-200 font-medium">{t('open_strategy_not_found_title')}</p>
                <p className="text-xs text-slate-400">{t('open_strategy_not_found_body')}</p>
              </>
            )}
            {strategyLoadState === 'error' && (
              <>
                <p className="text-sm text-slate-200 font-medium">{t('open_strategy_error_title')}</p>
                <p className="text-xs text-slate-400">{t('open_strategy_error_body')}</p>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Left sidebar — always visible on map view */}
          {activeView === 'map' && <LeftSidebar />}

          {/* Main content area — flex-col so children can use flex-1 + overflow */}
          <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {activeView === 'map' && (
              <ReactFlowProvider>
                <MapCanvas />
              </ReactFlowProvider>
            )}
            {activeView === 'traffic' && <TrafficResearch />}
            {activeView === 'ai' && <AIAssistant />}
          </main>

          {/* Right panel — only on map view */}
          {activeView === 'map' && <RightPanel />}
        </div>
      )}

      {/* Product setup modal */}
      {showSetup && <ProductSetupModal />}

      {/* Cloud strategies modal */}
      {showStrategies && <StrategiesModal />}
    </div>
  );
}
