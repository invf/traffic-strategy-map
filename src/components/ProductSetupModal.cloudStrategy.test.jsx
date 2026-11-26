// ADV-004-FIX-3 (requirement A) - "Edit Product" must NEVER invoke AI
// strategy generation when a linked Cloud Strategy is active; editing
// metadata must not replace nodes/edges; the legacy generator stays
// available only as a separate, explicitly-confirmed action; an AI
// failure must never fall back to the mock/template strategy for a Cloud
// Strategy. Same isolated-component convention as
// AdveserProjectsSelector.test.jsx (mocked useStore/useTranslation/services).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../i18n/useTranslation', () => ({
  useTranslation: () => (key) => ({
    modal_title: 'Setup', modal_subtitle: 'sub',
    modal_field_name: 'Name', modal_field_desc: 'Description', modal_field_audience: 'Audience',
    modal_field_goal: 'Goal', modal_field_countries: 'Countries', modal_field_budget: 'Budget',
    modal_placeholder_name: 'name', modal_placeholder_desc: 'desc', modal_placeholder_audience: 'aud',
    modal_placeholder_budget: 'budget',
    modal_btn_cancel: 'Cancel', modal_btn_generate: 'Generate Strategy Map',
    modal_btn_save_details: 'Save', modal_btn_regenerate: 'Regenerate from AI…',
    modal_regenerate_confirm_text: 'This will replace all {count} blocks. Your edits will be lost.',
    modal_regenerate_confirm_btn: 'Replace with new map',
    goal_traffic_label: 'Traffic', goal_traffic_desc: 'd',
    goal_sales_label: 'Sales', goal_sales_desc: 'd',
    goal_signups_label: 'Signups', goal_signups_desc: 'd',
    goal_installs_label: 'Installs', goal_installs_desc: 'd',
    goal_subscribers_label: 'Subscribers', goal_subscribers_desc: 'd',
  }[key] || key),
}));

const generateStrategyWithAI = vi.fn();
vi.mock('../services/openai', () => ({ generateStrategyWithAI: (...a) => generateStrategyWithAI(...a) }));

let storeState;
const generateMap = vi.fn();
const setProductInfo = vi.fn();
const setShowSetup = vi.fn();
const setAiSuggestions = vi.fn();
const setIsGenerating = vi.fn();
vi.mock('../store/useStore', () => ({ useStore: () => storeState }));

import ProductSetupModal from './ProductSetupModal';

const BASE_PRODUCT = { name: 'Existing Product', description: 'Does things', audience: 'Developers', countries: ['US'], budget: '', goal: 'traffic' };

describe('ProductSetupModal - Cloud Strategy editing (ADV-004-FIX-3 requirement A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = {
      productInfo: BASE_PRODUCT,
      generateMap, setProductInfo, setShowSetup, setAiSuggestions,
      isGenerating: false, setIsGenerating,
      language: 'en',
      activeProjectSource: 'cloud',
      nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }],
    };
  });

  it('scenario 1 - clicking the primary "Save" action on a Cloud Strategy updates metadata only, never calls generateMap', () => {
    render(<ProductSetupModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(setProductInfo).toHaveBeenCalledWith(expect.objectContaining({ name: 'Existing Product' }));
    expect(generateMap).not.toHaveBeenCalled();
  });

  it('does not show the legacy single "Generate Strategy Map" button at all for a Cloud Strategy', () => {
    render(<ProductSetupModal />);
    expect(screen.queryByRole('button', { name: 'Generate Strategy Map' })).not.toBeInTheDocument();
  });

  it('"Regenerate from AI…" requires an explicit confirm before touching the graph', () => {
    render(<ProductSetupModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate from AI…' }));

    // Naming the consequence - the exact node count that will be replaced.
    expect(screen.getByText(/replace all 3 blocks/i)).toBeInTheDocument();
    expect(generateMap).not.toHaveBeenCalled();

    // Two "Cancel" buttons are visible while the confirm panel is open
    // (the confirm panel's own Cancel, plus the modal's regular Cancel) -
    // the confirm panel's is the first in DOM order.
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
    expect(screen.queryByText(/replace all 3 blocks/i)).not.toBeInTheDocument();
    expect(generateMap).not.toHaveBeenCalled();
  });

  it('scenario 2 (part 1) - confirming "Replace with new map" on success calls generateMap with the real AI result', async () => {
    generateStrategyWithAI.mockResolvedValue({ nodes: [{ id: 'ai1' }], edges: [], aiSuggestions: { x: 1 } });
    render(<ProductSetupModal />);

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate from AI…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace with new map' }));

    await waitFor(() => expect(generateMap).toHaveBeenCalledWith(BASE_PRODUCT, [{ id: 'ai1' }], []));
  });

  it('scenario 2 (part 2) - AI generation failure on a Cloud Strategy shows an error but NEVER falls back to the mock/template graph', async () => {
    generateStrategyWithAI.mockRejectedValue(new Error('AI unavailable'));
    render(<ProductSetupModal />);

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate from AI…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace with new map' }));

    await waitFor(() => expect(screen.getByText(/AI unavailable/i)).toBeInTheDocument());
    // The current graph (the Cloud Strategy) is preserved - generateMap is
    // never called on this path, unlike the Local Draft fallback below.
    expect(generateMap).not.toHaveBeenCalled();
  });

  it('for a Local Draft (not a Cloud Strategy), the existing single-button behavior and mock fallback are completely unchanged', async () => {
    storeState.activeProjectSource = 'local';
    generateStrategyWithAI.mockRejectedValue(new Error('AI unavailable'));
    render(<ProductSetupModal />);

    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Strategy Map' }));

    await waitFor(() => expect(generateMap).toHaveBeenCalledWith(BASE_PRODUCT));
  });
});
