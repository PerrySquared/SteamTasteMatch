// background.js - Main logic for fetching and analyzing review data

// Constants
const STEAM_API_REVIEW_URL = 'https://store.steampowered.com/appreviews/';
const STEAM_COMMUNITY_URL = 'https://steamcommunity.com';
const THUMBS_UP_IMG = 'https://community.akamai.steamstatic.com/public/shared/images/userreviews/icon_thumbsUp.png';
const THUMBS_DOWN_IMG = 'https://community.akamai.steamstatic.com/public/shared/images/userreviews/icon_thumbsDown.png';
const DELAY_BETWEEN_REQUESTS = 1000;

// Global state
let analysisInProgress = false;
let shouldCancel = false;
let loggingEnabled = true;

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startAnalysis') {
    if (!analysisInProgress) {
      startBackgroundAnalysis(message.data);
    }
    sendResponse({ started: true });
  } else if (message.action === 'cancelAnalysis') {
    shouldCancel = true;
    sendResponse({ cancelled: true });
  }
  return true;
});

// Start analysis in background
async function startBackgroundAnalysis(params) {
  analysisInProgress = true;
  shouldCancel = false;

  // Set initial state
  await chrome.storage.local.set({
    analysisRunning: true,
    analysisProgress: 'Starting analysis...',
    analysisResult: null,
    analysisError: null,
    analysisLogs: []
  });

  try {
    const result = await analyzeGame(params);
    
    if (shouldCancel) {
      await logProgress('Analysis cancelled', 'warning');
      await chrome.storage.local.set({
        analysisRunning: false,
        analysisProgress: 'Cancelled',
        analysisResult: null,
        analysisError: null  // Don't set error for cancellation
      });
      // No notification for cancellation
    } else {
      // Save result
      await chrome.storage.local.set({
        analysisRunning: false,
        analysisProgress: 'Complete',
        analysisResult: result.data,
        analysisError: null
      });

      // Show notification
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon128.png',
        title: 'Steam Analysis Complete!',
        message: `Score: ${result.data.score}% positive from ${result.data.matchingReviewers} matching reviewers`,
        priority: 2
      });

      await logProgress('Analysis complete! Notification sent.', 'success');
    }
  } catch (error) {
    // Only set error if it's not a cancellation
    if (error.message !== 'Cancelled') {
      await chrome.storage.local.set({
        analysisRunning: false,
        analysisProgress: 'Error',
        analysisError: error.message
      });

      await chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon128.png',
        title: 'Steam Analysis Failed',
        message: error.message,
        priority: 2
      });

      await logProgress(`Analysis failed: ${error.message}`, 'error');
    }
  }

  analysisInProgress = false;
  shouldCancel = false;
}

// Main analysis function
async function analyzeGame({ appId, steamId, minOverlap, minSimilarity, maxProfiles }) {
  try {
    // Step 1: Fetch user reviews
    await updateProgress('Fetching your review history...');
    await logProgress('Fetching your review history...', 'info');
    
    const userReviews = await fetchUserReviews(steamId);
    
    if (shouldCancel) throw new Error('Cancelled');
    
    if (userReviews.length === 0) {
      throw new Error('No reviews found for your profile. Make sure your profile is public.');
    }

    await logProgress(`Found ${userReviews.length} of your reviews`, 'success');
    
    // Step 2: Fetch game reviewers
    await updateProgress(`Found ${userReviews.length} reviews`);
    await logProgress(`Fetching game reviewers (limit: ${maxProfiles})...`, 'info');
    
    const gameReviewers = await fetchGameReviewers(appId, maxProfiles);
    
    if (shouldCancel) throw new Error('Cancelled');
    
    if (gameReviewers.length === 0) {
      throw new Error('No reviewers found for this game.');
    }

    await logProgress(`Found ${gameReviewers.length} reviewers to analyze`, 'success');
    await updateProgress(`Analyzing ${gameReviewers.length} profiles...`);
    await logProgress('Beginning profile analysis (this will take a while)...', 'info');
    
    // Step 3: Fetch all reviewer data
    const reviewerData = await fetchAllReviewerData(gameReviewers, maxProfiles);
    
    if (shouldCancel) throw new Error('Cancelled');
    
    // Step 4: Calculate score
    await logProgress('Comparing reviews and calculating final score...', 'info');
    await updateProgress('Calculating final score...');
    
    const results = calculateScore(userReviews, reviewerData, appId, minOverlap, minSimilarity);
    
    await logProgress(`Analysis complete! Found ${results.matchingReviewers} matching reviewers`, 'success');
    
    return {
      success: true,
      data: results
    };
  } catch (error) {
    console.error('Analysis error:', error);
    await logProgress(`Analysis failed: ${error.message}`, 'error');
    throw error;
  }
}

// Parse Steam ID from various input formats
function parseSteamId(input) {
  if (!input) return null;
  
  input = input.trim();
  
  // If it's a full URL, extract the ID/username
  if (input.includes('steamcommunity.com')) {
    const profileMatch = input.match(/steamcommunity\.com\/profiles\/(\d+)/);
    if (profileMatch) {
      return profileMatch[1];
    }
    
    const idMatch = input.match(/steamcommunity\.com\/id\/([^\/\s]+)/);
    if (idMatch) {
      return idMatch[1];
    }
    
    return null;
  }
  
  // Remove trailing slashes
  return input.replace(/\/+$/, '');
}

// Fetch user's own reviews
async function fetchUserReviews(steamId) {
  const cleanedId = parseSteamId(steamId);
  
  if (!cleanedId) {
    throw new Error('Invalid Steam ID format. Please enter either your steamID64 (numbers) or custom URL username.');
  }

  let baseUrl;
  if (/^\d+$/.test(cleanedId)) {
    baseUrl = `${STEAM_COMMUNITY_URL}/profiles/${cleanedId}/recommended/`;
  } else {
    baseUrl = `${STEAM_COMMUNITY_URL}/id/${cleanedId}/recommended/`;
  }

  const allReviews = await fetchAllReviewsFromProfile(baseUrl, 'Your profile');
  
  if (allReviews.length === 0) {
    throw new Error('Could not fetch your reviews. Make sure your Steam ID is correct and your profile is public.');
  }
  
  return allReviews;
}

// Fetch reviewers from a game
async function fetchGameReviewers(appId, maxProfiles) {
  const reviewers = [];
  let cursor = '*';
  let totalFetched = 0;
  let requestCount = 0;

  await logProgress(`Fetching reviewers from Steam API...`, 'info');

  while (totalFetched < maxProfiles && !shouldCancel) {
    requestCount++;
    const url = `${STEAM_API_REVIEW_URL}${appId}?json=1&filter=all&language=all&day_range=9223372036854775807&cursor=${cursor}&review_type=all&purchase_type=all&num_per_page=100`;
    
    await logProgress(`API request #${requestCount}: Fetching up to 100 reviews`, 'info');
    
    try {
      const response = await fetchWithRetry(url);
      const data = JSON.parse(response);

      if (!data.success) {
        await logProgress(`API returned success=false, stopping`, 'warning');
        break;
      }

      if (!data.reviews || data.reviews.length === 0) {
        await logProgress(`No more reviews available`, 'info');
        break;
      }

      await logProgress(`Received ${data.reviews.length} reviews from API`, 'success');

      for (const review of data.reviews) {
        reviewers.push({
          steamId: review.author.steamid,
          profileUrl: `${STEAM_COMMUNITY_URL}/profiles/${review.author.steamid}`,
          votedUp: review.voted_up
        });
      }

      totalFetched += data.reviews.length;
      await updateProgress(`Collected ${totalFetched} reviewers...`);
      await logProgress(`Total reviewers collected: ${totalFetched}/${maxProfiles}`, 'info');
      
      if (!data.cursor || data.reviews.length < 100 || totalFetched >= maxProfiles) {
        await logProgress(`Stopping: ${!data.cursor ? 'no more pages' : totalFetched >= maxProfiles ? 'reached limit' : 'last page'}`, 'info');
        break;
      }
      
      cursor = encodeURIComponent(data.cursor);
      await delay(500);
      
    } catch (error) {
      await logProgress(`Error fetching game reviews: ${error.message}`, 'error');
      break;
    }
  }

  const trimmed = reviewers.slice(0, maxProfiles);
  await logProgress(`Collected ${trimmed.length} reviewer profiles`, 'success');
  
  return trimmed;
}

// Fetch all reviews for all reviewers
async function fetchAllReviewerData(reviewers, maxProfiles) {
  const reviewerData = [];
  let processed = 0;
  let successCount = 0;
  let errorCount = 0;
  let privateProfileCount = 0;

  await logProgress(`Starting to fetch review data from ${reviewers.length} profiles`, 'info');

  for (const reviewer of reviewers) {
    if (shouldCancel) break;
    
    try {
      processed++;
      
      const progressPercent = Math.round((processed / reviewers.length) * 100);
      await updateProgress(`Analyzing profile ${processed}/${reviewers.length} (${progressPercent}%)...`);
      await logProgress(`[${processed}/${reviewers.length}] (${progressPercent}%) Fetching reviews for steamid ${reviewer.steamId}...`, 'info');
      
      const reviews = await fetchReviewerReviews(reviewer.steamId);
      
      if (reviews.length === 0) {
        await logProgress(`  └─ Profile appears to be private or has no reviews (skipping)`, 'warning');
        privateProfileCount++;
      } else {
        await logProgress(`  └─ Found ${reviews.length} reviews from this profile`, 'success');
        reviewerData.push({
          steamId: reviewer.steamId,
          reviews: reviews
        });
        successCount++;
      }
      
      if (processed % 10 === 0) {
        await logProgress(`Rate limiting: Pausing for ${DELAY_BETWEEN_REQUESTS}ms...`, 'info');
        await delay(DELAY_BETWEEN_REQUESTS);
      }
      
    } catch (error) {
      errorCount++;
      await logProgress(`  └─ Error fetching reviews for ${reviewer.steamId}: ${error.message}`, 'error');
    }
  }

  await logProgress(`Profile scanning complete!`, 'success');
  await logProgress(`  ├─ Successfully scanned: ${successCount}`, 'success');
  await logProgress(`  ├─ Private/empty profiles: ${privateProfileCount}`, 'warning');
  await logProgress(`  └─ Errors: ${errorCount}`, errorCount > 0 ? 'warning' : 'info');

  return reviewerData;
}

// Fetch reviews for a specific reviewer
async function fetchReviewerReviews(steamId) {
  try {
    const baseUrl = `${STEAM_COMMUNITY_URL}/profiles/${steamId}/recommended/`;
    return await fetchAllReviewsFromProfile(baseUrl, steamId);
  } catch (error) {
    try {
      const baseUrl = `${STEAM_COMMUNITY_URL}/id/${steamId}/recommended/`;
      return await fetchAllReviewsFromProfile(baseUrl, steamId);
    } catch (error2) {
      return [];
    }
  }
}

// Fetch all reviews from a profile with pagination
async function fetchAllReviewsFromProfile(baseUrl, profileLabel = 'Profile') {
  const allReviews = [];
  let page = 1;
  const maxPages = 50;
  
  while (page <= maxPages) {
    try {
      const url = page === 1 ? baseUrl : `${baseUrl}?p=${page}`;
      
      // Fetch with logging
      await logProgress(`  Fetching page ${page} from ${profileLabel}...`, 'info');
      const html = await fetchWithRetry(url, 3, false);
      const reviews = await parseReviewsFromHTML(html, false);
      
      await logProgress(`    └─ Found ${reviews.length} reviews on page ${page}`, 'success');
      
      if (reviews.length === 0) {
        break;
      }
      
      // Add reviews
      allReviews.push(...reviews);
      
      // Less than 10 is last page - stop
      if (reviews.length < 10) {
        break;
      }
      
      // Full page - try next page
      page++;
      await delay(200);
      
    } catch (error) {
      await logProgress(`  ERROR on page ${page}: ${error.message}`, 'error');
      break;
    }
  }
  
  await logProgress(`  TOTAL for ${profileLabel}: ${allReviews.length} reviews from ${page} page(s)`, 'success');
  return allReviews;
}

// Parse reviews from HTML
async function parseReviewsFromHTML(html, silent = false) {
  const reviews = [];
  
  try {
    const skipReasons = {
      noAppId: []
    };
    
    // Find all review vote images (thumbs up/down)
    const reviewImgPattern = /<img[^>]+src="([^"]*icon_thumbs(Up|Down)[^"]*)"/gi;
    const reviewImgMatches = [...html.matchAll(reviewImgPattern)];
    
    for (const imgMatch of reviewImgMatches) {
      try {
        const imgSrc = imgMatch[1];
        const thumbType = imgMatch[2]; // "Up" or "Down"
        const imgIndex = imgMatch.index;
        
        const isPositive = thumbType === 'Up';
        
        // Look backwards from the image to find the app link
        const searchStart = Math.max(0, imgIndex - 2000);
        const contextBefore = html.substring(searchStart, imgIndex);
        
        const appLinkPattern = /href="[^"]*\/app\/(\d+)/gi;
        const appLinks = [...contextBefore.matchAll(appLinkPattern)];
        
        if (appLinks.length === 0) {
          skipReasons.noAppId.push(`thumb${thumbType} at position ${imgIndex}`);
          continue;
        }
        
        const closestAppLink = appLinks[appLinks.length - 1];
        const appId = closestAppLink[1];
        
        // Avoid duplicates
        if (!reviews.find(r => r.appId === appId && r.isPositive === isPositive)) {
          reviews.push({ appId, isPositive });
        }
        
      } catch (error) {
        continue;
      }
    }
    
    // Log issues
    if (!silent && skipReasons.noAppId.length > 0) {
      await logProgress(`  ⚠ Skipped ${skipReasons.noAppId.length} entries (no app ID found)`, 'warning');
    }
    
  } catch (error) {
    if (!silent) {
      await logProgress(`Critical error in parseReviewsFromHTML: ${error.message}`, 'error');
    }
  }
  
  return reviews;
}

// Calculate the final score
function calculateScore(userReviews, reviewerData, targetAppId, minOverlap, minSimilarity) {
  const userReviewMap = new Map();
  for (const review of userReviews) {
    userReviewMap.set(review.appId, review.isPositive);
  }

  let matchingReviewers = 0;
  let positiveCount = 0;
  let totalOverlap = 0;

  for (const reviewer of reviewerData) {
    let overlapCount = 0;
    let agreementCount = 0;

    for (const review of reviewer.reviews) {
      if (userReviewMap.has(review.appId)) {
        overlapCount++;
        if (userReviewMap.get(review.appId) === review.isPositive) {
          agreementCount++;
        }
      }
    }

    if (overlapCount >= minOverlap) {
      const similarity = (agreementCount / overlapCount) * 100;
      
      if (similarity >= minSimilarity) {
        matchingReviewers++;
        totalOverlap += overlapCount;
        
        const targetReview = reviewer.reviews.find(r => r.appId === targetAppId);
        if (targetReview && targetReview.isPositive) {
          positiveCount++;
        }
      }
    }
  }

  const score = matchingReviewers > 0 ? Math.round((positiveCount / matchingReviewers) * 100) : 0;
  const avgOverlap = matchingReviewers > 0 ? totalOverlap / matchingReviewers : 0;

  return {
    score,
    totalReviewers: reviewerData.length,
    matchingReviewers,
    positiveCount,
    avgOverlap,
    minOverlap,
    minSimilarity
  };
}

// Utility functions
async function fetchWithRetry(url, retries = 3, silent = false) {
  for (let i = 0; i < retries; i++) {
    if (shouldCancel) throw new Error('Cancelled');
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Cache-Control': 'max-age=0'
        },
        credentials: 'omit',
        mode: 'cors'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const text = await response.text();
      // Success - no logging, let the caller handle it
      return text;
    } catch (error) {
      if (!silent && i === retries - 1) {
        await logProgress(`Fetch failed after ${retries} attempts: ${error.message}`, 'error');
      }
      if (i === retries - 1) throw error;
      await delay(1000 * (i + 1));
    }
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateProgress(text) {
  await chrome.storage.local.set({ analysisProgress: text });
}

async function logProgress(text, type = 'info') {
  if (!loggingEnabled) return; // Skip immediately if logging disabled
  
  const timestamp = new Date().toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });

  try {
    const { analysisLogs = [] } = await chrome.storage.local.get('analysisLogs');
    analysisLogs.push({ timestamp, text, type });
    await chrome.storage.local.set({ analysisLogs });
  } catch (error) {
    // Silently fail if storage operations fail
    console.error('Failed to log:', error);
  }
}

async function updateProgressPercent(percent) {
  await chrome.storage.local.set({ analysisProgressPercent: percent });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startAnalysis') {
    if (!analysisInProgress) {
      startBackgroundAnalysis(message.data);
    }
    sendResponse({ started: true });
  } else if (message.action === 'cancelAnalysis') {
    shouldCancel = true;
    // Immediately update storage to reflect cancelled state
    chrome.storage.local.set({
      analysisRunning: false,
      analysisProgress: 'Cancelled'
    });
    sendResponse({ cancelled: true });
  } else if (message.action === 'setLogging') {
    loggingEnabled = message.enabled;
    sendResponse({ success: true });
  }
  return true;
});