// popup.js - Handles UI interactions and communicates with background script

let updateInterval = null;

document.addEventListener('DOMContentLoaded', async () => {
  const overlapSlider = document.getElementById('overlapSlider');
  const overlapValue = document.getElementById('overlapValue');
  const similaritySlider = document.getElementById('similaritySlider');
  const similarityValue = document.getElementById('similarityValue');
  const maxProfilesSlider = document.getElementById('maxProfilesSlider');
  const maxProfilesValue = document.getElementById('maxProfilesValue');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const steamIdInput = document.getElementById('steamId');
  const saveSteamIdBtn = document.getElementById('saveSteamId');
  const statusDisplay = document.getElementById('statusDisplay');
  const resultsDisplay = document.getElementById('resultsDisplay');
  const logWindow = document.getElementById('logWindow');
  const clearLogBtn = document.getElementById('clearLogBtn');
  const loggingToggle = document.getElementById('loggingToggle');

  // Load saved values including sliders
  const stored = await chrome.storage.local.get([
    'steamId', 
    'loggingEnabled',
    'minOverlap',
    'minSimilarity', 
    'maxProfiles',
    'analysisResult',
    'analysisRunning'
  ]);
  
  // Load Steam ID
  if (stored.steamId) {
    steamIdInput.value = stored.steamId;
  }
  
  // Load logging preference
  loggingToggle.checked = stored.loggingEnabled !== false; // default true
  if (!loggingToggle.checked) {
    logWindow.classList.add('disabled');
  }
  
  // Load slider values
  if (stored.minOverlap) {
    overlapSlider.value = stored.minOverlap;
    overlapValue.textContent = stored.minOverlap;
  }
  if (stored.minSimilarity) {
    similaritySlider.value = stored.minSimilarity;
    similarityValue.textContent = `${stored.minSimilarity}%`;
  }
  if (stored.maxProfiles) {
    maxProfilesSlider.value = stored.maxProfiles;
    maxProfilesValue.textContent = stored.maxProfiles;
  }

  // Clear any leftover error state from previous sessions
  if (!stored.analysisRunning) {
    await chrome.storage.local.set({ 
      analysisError: null
    });
  }

  // Check for ongoing or completed analysis
  await checkAnalysisState();

  // Poll for updates every 500ms
  updateInterval = setInterval(checkAnalysisState, 500);

  // Update slider displays AND save to storage
  overlapSlider.addEventListener('input', async (e) => {
    const value = e.target.value;
    overlapValue.textContent = value;
    await chrome.storage.local.set({ minOverlap: parseInt(value) });
  });

  similaritySlider.addEventListener('input', async (e) => {
    const value = e.target.value;
    similarityValue.textContent = `${value}%`;
    await chrome.storage.local.set({ minSimilarity: parseInt(value) });
  });

  maxProfilesSlider.addEventListener('input', async (e) => {
    const value = e.target.value;
    maxProfilesValue.textContent = value;
    await chrome.storage.local.set({ maxProfiles: parseInt(value) });
  });

  // Logging toggle
  loggingToggle.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    await chrome.storage.local.set({ loggingEnabled: enabled });
    
    if (enabled) {
      logWindow.classList.remove('disabled');
      addLog('Logging enabled', 'success');
    } else {
      logWindow.classList.add('disabled');
      logWindow.innerHTML = ''; // Clear display immediately
      // Clear logs from storage to save space
      await chrome.storage.local.set({ analysisLogs: [] });
    }
    
    // Notify background script (non-blocking)
    try {
      chrome.runtime.sendMessage({ action: 'setLogging', enabled });
    } catch (error) {
      // Ignore if background script isn't ready
    }
  });

  // Clear log button
  clearLogBtn.addEventListener('click', async () => {
    logWindow.innerHTML = '';
    await chrome.storage.local.set({ analysisLogs: [] });
  });

  // Copy log button
  const copyLogBtn = document.getElementById('copyLogBtn');
  copyLogBtn.addEventListener('click', async () => {
    const { analysisLogs = [] } = await chrome.storage.local.get('analysisLogs');
    
    if (analysisLogs.length === 0) {
      showStatus('Log is empty', 'warning');
      return;
    }
    
    // Format logs as text
    const logText = analysisLogs.map(log => 
      `[${log.timestamp}] ${log.text}`
    ).join('\n');
    
    try {
      await navigator.clipboard.writeText(logText);
      showStatus('Log copied to clipboard!', 'success');
      
      // Visual feedback on button
      const originalText = copyLogBtn.textContent;
      copyLogBtn.textContent = '✓ Copied';
      copyLogBtn.style.background = 'rgba(92, 184, 92, 0.3)';
      
      setTimeout(() => {
        copyLogBtn.textContent = originalText;
        copyLogBtn.style.background = '';
      }, 2000);
    } catch (error) {
      showStatus('Failed to copy log', 'error');
    }
  });

  // Save Steam ID
  saveSteamIdBtn.addEventListener('click', async () => {
    const steamId = steamIdInput.value.trim();
    if (steamId) {
      await chrome.storage.local.set({ steamId });
      showStatus('Steam ID saved!', 'success');
      if (loggingToggle.checked) {
        addLog('Steam ID saved', 'success');
      }
    } else {
      showStatus('Please enter a valid Steam ID', 'error');
      if (loggingToggle.checked) {
        addLog('Error: No Steam ID provided', 'error');
      }
    }
  });

  // Cancel button
  cancelBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'cancelAnalysis' });
    if (loggingToggle.checked) {
      addLog('Analysis cancelled by user', 'warning');
    }
    showStatus('Analysis cancelled', 'warning');
    
    // Hide cancel, show analyze
    cancelBtn.style.display = 'none';
    analyzeBtn.style.display = 'block';
  });

  // Analyze button click
  analyzeBtn.addEventListener('click', async () => {
    const steamId = steamIdInput.value.trim();
    
    if (!steamId) {
      // Clear any old state from storage
      await chrome.storage.local.set({ 
        analysisError: null,
        analysisProgress: null  
      });
      showStatus('Please enter your Steam ID first', 'error');
      if (loggingToggle.checked) {
        addLog('Error: No Steam ID provided', 'error');
      }
      return;
    }
  
    // Get current slider values 
    const minOverlap = parseInt(overlapSlider.value);
    const minSimilarity = parseInt(similaritySlider.value);
    const maxProfiles = parseInt(maxProfilesSlider.value);
  
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url || !tab.url.includes('store.steampowered.com/app/')) {
      // Clear any old state from storage
      await chrome.storage.local.set({ 
        analysisError: null,
        analysisProgress: null  
      });
      showStatus('Please open a Steam game page first', 'error');
      if (loggingToggle.checked) {
        addLog('Error: Not on a Steam game page', 'error');
      }
      return;
    }
  
    // Extract app ID from URL
    const appIdMatch = tab.url.match(/\/app\/(\d+)/);
    if (!appIdMatch) {
      // Clear any old state from storage
      await chrome.storage.local.set({ 
        analysisError: null,
        analysisProgress: null  
      });
      showStatus('Could not find game ID from page URL', 'error');
      if (loggingToggle.checked) {
        addLog('Error: Could not extract game ID from URL', 'error');
      }
      return;
    }
  
    const appId = appIdMatch[1];
  
    // Clear previous results and logs (but keep slider values)
    resultsDisplay.classList.remove('active');
    resultsDisplay.innerHTML = '';
    logWindow.innerHTML = '';
    await chrome.storage.local.set({ 
      analysisLogs: [], 
      analysisResult: null,
      analysisError: null,
      analysisProgress: null  
    });
  
    // Show cancel button, hide analyze button
    analyzeBtn.style.display = 'none';
    cancelBtn.style.display = 'block';
  
    if (loggingToggle.checked) {
      addLog(`Starting analysis for game ${appId}`, 'info');
      addLog(`Parameters: overlap=${minOverlap}, similarity=${minSimilarity}%, maxProfiles=${maxProfiles}`, 'info');
      addLog('You can close this window - analysis continues in background', 'info');
    }
    showStatus('Analysis started in background...', 'progress');
  
    // Start analysis in background
    chrome.runtime.sendMessage({
      action: 'startAnalysis',
      data: {
        appId,
        steamId,
        minOverlap,
        minSimilarity,
        maxProfiles
      }
    });
  });

  async function checkAnalysisState() {
    const state = await chrome.storage.local.get([
      'analysisRunning', 
      'analysisProgress', 
      'analysisLogs', 
      'analysisResult',
      'analysisError'
    ]);
  
    // Update logs if logging is enabled
    if (loggingToggle.checked && state.analysisLogs && state.analysisLogs.length > 0) {
      const currentLogCount = logWindow.children.length;
      if (currentLogCount !== state.analysisLogs.length) {
        // New logs available
        logWindow.innerHTML = '';
        state.analysisLogs.forEach(log => {
          const entry = document.createElement('div');
          entry.className = `log-entry ${log.type}`;
          entry.innerHTML = `<span class="log-timestamp">[${log.timestamp}]</span>${log.text}`;
          logWindow.appendChild(entry);
        });
        logWindow.scrollTop = logWindow.scrollHeight;
      }
    }
  
    // Update UI based on analysis state
    if (state.analysisRunning) {
      analyzeBtn.style.display = 'none';
      cancelBtn.style.display = 'block';
      if (state.analysisProgress) {
        showStatus(state.analysisProgress, 'progress');
      }
    } else {
      analyzeBtn.style.display = 'block';
      cancelBtn.style.display = 'none';
  
      // Show completed result if available
      if (state.analysisResult) {
        displayResults(state.analysisResult);
        // Don't show status if results are displayed
        if (!resultsDisplay.classList.contains('active')) {
          showStatus('Analysis complete!', 'success');
        }
      }
  
      // Show error if present (cancellation won't have an error)
      if (state.analysisError) {
        showStatus(`Error: ${state.analysisError}`, 'error');
      }
      
      // Handle cancelled state (no error, no result)
      if (state.analysisProgress === 'Cancelled' && !state.analysisResult && !state.analysisError) {
        showStatus('Analysis was cancelled', 'warning');
      }
    }
  }

  function showStatus(text, type = 'progress') {
    statusDisplay.classList.add('active');
    statusDisplay.innerHTML = `<span class="${type}">${text}</span>`;
    
    // Don't auto-hide if results are already displayed
    if (type === 'success' && resultsDisplay.classList.contains('active')) {
      return;
    }
    
    // Only auto-hide success messages, not errors or warnings
    if (type === 'success') {
      setTimeout(() => {
        statusDisplay.classList.remove('active');
      }, 3000);
    }
  }

  async function addLog(text, type = 'info') {
    if (!loggingToggle.checked) return; // Don't log if disabled
    
    const timestamp = new Date().toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
    
    // Add to storage
    const { analysisLogs = [] } = await chrome.storage.local.get('analysisLogs');
    analysisLogs.push({ timestamp, text, type });
    await chrome.storage.local.set({ analysisLogs });
  }

  function displayResults(data) {
    const { gameName, score, totalReviewers, matchingReviewers, avgOverlap, minOverlap, minSimilarity } = data;

    resultsDisplay.innerHTML = `
      <div class="result-card">
        <div class="result-score">${score}%</div>
        <div class="result-details">
          <p><strong>Positive Rating</strong> from reviewers with similar taste</p>
          <p style="margin-top: 10px;">
            <strong>${matchingReviewers}</strong> matching reviewers found<br>
            (out of ${totalReviewers} total reviewers analyzed)
          </p>
          <p style="margin-top: 10px;">
            <strong>Average overlap:</strong> ${avgOverlap.toFixed(1)} games<br>
            <strong>Min overlap:</strong> ${minOverlap} games<br>
            <strong>Min similarity:</strong> ${minSimilarity}%
          </p>
        </div>
      </div>
    `;

    resultsDisplay.classList.add('active');
  }
});

// Clean up interval when popup closes
window.addEventListener('unload', () => {
  if (updateInterval) {
    clearInterval(updateInterval);
  }
});