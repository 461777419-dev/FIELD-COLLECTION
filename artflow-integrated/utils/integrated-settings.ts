// Integrated gallery storage, shared AI and board appearance replace these
// standalone-host pages. Only navigation is filtered; documents and prefs stay intact.
export const INTEGRATED_HIDDEN_SECTIONS=new Set([
  'builtin.settings-ai-models','builtin.headless.mcp','builtin.asset-library.panel',
  'builtin.core-settings.appearance',
]);
export const INTEGRATED_ADVANCED_SECTIONS=new Set(['builtin.config-manager.presets','builtin.config-manager.storage']);
export const INTEGRATED_HIDDEN_PLUGINS=new Set([
  'builtin.ai-providers','builtin.headless','builtin.asset-library','builtin.ui-skin-picker',
  'builtin.perf-monitor','builtin.external-plugins',
]);
