import React, { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
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

export default function App() {
  const { activeView, showSetup, showStrategies, setAiSuggestions, productInfo, initProjects } = useStore();

  useEffect(() => {
    initProjects();
    if (productInfo.name) {
      setAiSuggestions(generateAISuggestions(productInfo));
    }
  }, []); // eslint-disable-line

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#070818]">
      <TopBar />

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

      {/* Product setup modal */}
      {showSetup && <ProductSetupModal />}

      {/* Cloud strategies modal */}
      {showStrategies && <StrategiesModal />}
    </div>
  );
}
