// content.js - Minimal content script for Steam store pages

// This script runs on Steam store pages and can help extract information if needed
// Currently minimal as most work is done in background.js

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getPageInfo') {
    // Extract game info from current page if needed
    const appIdMatch = window.location.href.match(/\/app\/(\d+)/);
    const gameNameElement = document.querySelector('.apphub_AppName');
    
    sendResponse({
      appId: appIdMatch ? appIdMatch[1] : null,
      gameName: gameNameElement ? gameNameElement.textContent.trim() : null
    });
  }
  return true;
});