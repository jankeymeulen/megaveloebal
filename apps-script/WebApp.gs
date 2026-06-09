/**
 * WebApp.gs - JSON API endpoint for the Megaveloebal web frontend.
 * Serves read-only game statistics to keep the frontend snappy.
 */

/**
 * Handles GET requests to the Web App URL.
 * Returns a consolidated JSON payload containing players, games, and bets.
 */
function doGet(e) {
  var data = {};
  
  try {
    data.players = getPlayers();
    data.games = getGames();
    data.bets = getBets();
    data.success = true;
  } catch (err) {
    data.success = false;
    data.error = err.toString();
  }
  
  var payload = JSON.stringify(data);
  return ContentService.createTextOutput(payload)
                       .setMimeType(ContentService.MimeType.JSON);
}
