/**
 * Private Pilot - Background Service Worker
 *
 * Configures the Chrome Extension Manifest V3 Side Panel API so that
 * clicking the toolbar action icon automatically toggles the native Side Panel.
 */

async function configureSidePanelBehavior(): Promise<void> {
  if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (error) {
      console.error('[Private Pilot] Failed to set side panel behavior:', error);
    }
  }
}

// Configure immediately on service worker startup
configureSidePanelBehavior();

// Re-configure on extension install or update
chrome.runtime.onInstalled.addListener(() => {
  configureSidePanelBehavior();
});
