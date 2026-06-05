/**
 * FootballData.gs - Client for calling the Football-Data.org API to get matches and scores.
 */

var FOOTBALL_DATA_BASE_URL = 'https://api.football-data.org/v4';

/**
 * Helper to make authenticated requests to Football-Data.org
 */
function makeFootballDataRequest(endpoint) {
  var apiKey = getConfig('FOOTBALL_DATA_API_KEY');
  if (!apiKey) {
    throw new Error('FOOTBALL_DATA_API_KEY is not configured in the Config sheet.');
  }

  var url = FOOTBALL_DATA_BASE_URL + endpoint;
  var options = {
    method: 'get',
    headers: {
      'X-Auth-Token': apiKey
    },
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var statusCode = response.getResponseCode();
  var content = response.getContentText();

  if (statusCode !== 200) {
    throw new Error('Football-Data API error (' + statusCode + '): ' + content);
  }

  return JSON.parse(content);
}

/**
 * Fetches all matches of the World Cup (WC competition).
 * @returns {Array<Object>} List of match objects from the API.
 */
function fetchAllWorldCupMatches() {
  var data = makeFootballDataRequest('/competitions/WC/matches');
  return data.matches || [];
}

/**
 * Fetches matches playing today (based on Europe/Brussels timezone).
 */
function fetchTodayMatches() {
  var allMatches = fetchAllWorldCupMatches();
  var todayStr = Utilities.formatDate(new Date(), "Europe/Brussels", "yyyy-MM-dd");
  
  return allMatches.filter(function(match) {
    var matchDateStr = Utilities.formatDate(new Date(match.utcDate), "Europe/Brussels", "yyyy-MM-dd");
    return matchDateStr === todayStr;
  });
}

/**
 * Fetches the current state of matches with specific IDs.
 * Uses a single batch fetch of all matches to prevent hitting API rate limits.
 * @param {Array<string>} matchIds Array of match IDs to check.
 */
function fetchMatchStates(matchIds) {
  if (!matchIds || matchIds.length === 0) return [];
  
  var allMatches = fetchAllWorldCupMatches();
  var idSet = {};
  matchIds.forEach(function(id) {
    idSet[id.toString()] = true;
  });

  return allMatches.filter(function(match) {
    return idSet.hasOwnProperty(match.id.toString());
  });
}
