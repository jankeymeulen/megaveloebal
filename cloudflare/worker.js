const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxzxFK_ZVFF2-TQkm4FKfJQxp2X4Mte-p2dr3cbpco5d910iRRQjLnP1RE3DTuTEoo/exec";

// 1. Listen for background cron triggers (scheduled events)
addEventListener("scheduled", event => {
  event.waitUntil(updateCacheFromGoogle());
});

// 2. Listen for HTTP requests from players
addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

// Helper to fetch the latest data from Google Sheets and save it to KV
async function updateCacheFromGoogle() {
  console.log("Cron trigger: Fetching fresh data from Google Sheets...");
  try {
    const response = await fetch(APPS_SCRIPT_URL, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    
    // Store in global KV namespace (using KV_MEGAVELOEBAL binding)
    await KV_MEGAVELOEBAL.put("cached_game_data", JSON.stringify(data));
    console.log("KV cache updated successfully.");
  } catch (err) {
    console.error("Failed to update cache from Google:", err);
  }
}

// Helper to serve requests instantly from KV
async function handleRequest(request) {
  try {
    // Get data from KV namespace
    let cachedData = await KV_MEGAVELOEBAL.get("cached_game_data");
    
    // Fallback: If KV is empty (e.g. first run before cron triggers), fetch from Google on-demand
    if (!cachedData) {
      console.log("KV cache empty. Fetching on demand...");
      const googleResponse = await fetch(APPS_SCRIPT_URL, { redirect: 'follow' });
      if (!googleResponse.ok) {
        throw new Error(`Google Apps Script returned status: ${googleResponse.status}`);
      }
      const data = await googleResponse.json();
      cachedData = JSON.stringify(data);
      
      // Save to KV in background so next request is instant
      await KV_MEGAVELOEBAL.put("cached_game_data", cachedData);
    }

    return new Response(cachedData, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache" // Prevent browser local caching to ensure players always read fresh KV cache
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
}
