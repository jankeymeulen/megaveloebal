/**
 * Sheets.gs - CRUD utilities for interacting with the Players, Games, and Bets sheets.
 */

var PLAYERS_SHEET_NAME = 'Players';
var GAMES_SHEET_NAME = 'Games';
var BETS_SHEET_NAME = 'Bets';

/**
 * Gets a sheet by name. Creates it with standard headers if it doesn't exist.
 */
function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    for (var i = 0; i < headers.length; i++) {
      sheet.setColumnWidth(i + 1, 150);
    }
  }
  return sheet;
}

/**
 * Retrieves all players from the Players sheet.
 * Columns: Player Name | WhatsApp ID | Coins Balance
 */
function getPlayers() {
  var sheet = getOrCreateSheet(PLAYERS_SHEET_NAME, ['Player Name', 'WhatsApp ID', 'Coins Balance', 'Nickname']);
  var data = sheet.getDataRange().getValues();
  var players = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) {
      var name = data[i][0].toString().trim();
      var whatsappId = data[i][1].toString().trim();
      var balance = Number(data[i][2]) || 0;
      var nickname = data[i][3] ? data[i][3].toString().trim() : '';
      
      players.push({
        name: name,
        whatsappId: whatsappId,
        balance: balance,
        nickname: nickname,
        displayName: nickname || name, // Fallback to name if nickname is blank
        rowIndex: i + 1 // 1-indexed row number in sheet
      });
    }
  }
  return players;
}

/**
 * Updates player balances in the sheet.
 * @param {Object} balanceUpdates Map of { playerName: absoluteNewBalance }
 */
function updatePlayerBalances(balanceUpdates) {
  var sheet = getOrCreateSheet(PLAYERS_SHEET_NAME, ['Player Name', 'WhatsApp ID', 'Coins Balance', 'Nickname']);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var name = data[i][0].toString().trim();
    if (name && balanceUpdates.hasOwnProperty(name)) {
      sheet.getRange(i + 1, 3).setValue(balanceUpdates[name]);
    }
  }
}

/**
 * Retrieves all games.
 * Columns: Game ID | Date Time (UTC) | Stage | Home Team | Away Team | Status | Score Home | Score Away | Result | Bet Cost | Poll Message ID | Settled
 */
function getGames() {
  var sheet = getOrCreateSheet(GAMES_SHEET_NAME, [
    'Game ID', 'Date Time (UTC)', 'Stage', 'Home Team', 'Away Team', 
    'Status', 'Score Home', 'Score Away', 'Result', 'Bet Cost', 'Poll Message ID', 'Settled'
  ]);
  var data = sheet.getDataRange().getValues();
  var games = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) {
      games.push({
        id: data[i][0].toString().trim(),
        dateTime: data[i][1],
        stage: data[i][2].toString().trim(),
        homeTeam: data[i][3].toString().trim(),
        awayTeam: data[i][4].toString().trim(),
        status: data[i][5].toString().trim(),
        scoreHome: data[i][6] === '' ? null : Number(data[i][6]),
        scoreAway: data[i][7] === '' ? null : Number(data[i][7]),
        result: data[i][8].toString().trim(),
        betCost: Number(data[i][9]) || 1,
        pollMessageId: data[i][10].toString().trim(),
        settled: data[i][11] === true || data[i][11].toString().toUpperCase() === 'TRUE',
        rowIndex: i + 1
      });
    }
  }
  return games;
}

/**
 * Saves a list of games (inserts new ones or updates matching ones by Game ID).
 */
function saveGames(gamesList) {
  var sheet = getOrCreateSheet(GAMES_SHEET_NAME, [
    'Game ID', 'Date Time (UTC)', 'Stage', 'Home Team', 'Away Team', 
    'Status', 'Score Home', 'Score Away', 'Result', 'Bet Cost', 'Poll Message ID', 'Settled'
  ]);
  var existingGames = getGames();
  var gameMap = {};
  existingGames.forEach(function(g) {
    gameMap[g.id] = g.rowIndex;
  });

  gamesList.forEach(function(g) {
    var rowValues = [
      g.id,
      g.dateTime,
      g.stage,
      g.homeTeam,
      g.awayTeam,
      g.status,
      g.scoreHome === null ? '' : g.scoreHome,
      g.scoreAway === null ? '' : g.scoreAway,
      g.result || '',
      g.betCost,
      g.pollMessageId || '',
      g.settled === true
    ];
    
    if (gameMap.hasOwnProperty(g.id)) {
      var rowIndex = gameMap[g.id];
      sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      sheet.appendRow(rowValues);
    }
  });
}

/**
 * Updates the poll message ID of a specific game.
 */
function updateGamePollId(gameId, pollMessageId) {
  var sheet = getOrCreateSheet(GAMES_SHEET_NAME, [
    'Game ID', 'Date Time (UTC)', 'Stage', 'Home Team', 'Away Team', 
    'Status', 'Score Home', 'Score Away', 'Result', 'Bet Cost', 'Poll Message ID', 'Settled'
  ]);
  var games = getGames();
  for (var i = 0; i < games.length; i++) {
    if (games[i].id === gameId) {
      sheet.getRange(games[i].rowIndex, 11).setValue(pollMessageId);
      break;
    }
  }
}

/**
 * Gets all bets stored in the sheet.
 * Columns: Game ID | Player Name | WhatsApp ID | Bet Option | Coins Bet | Winnings | Result | Settled
 */
function getBets() {
  var sheet = getOrCreateSheet(BETS_SHEET_NAME, [
    'Game ID', 'Player Name', 'WhatsApp ID', 'Bet Option', 'Coins Bet', 'Winnings', 'Result', 'Settled'
  ]);
  var data = sheet.getDataRange().getValues();
  var bets = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) {
      bets.push({
        gameId: data[i][0].toString().trim(),
        playerName: data[i][1].toString().trim(),
        whatsappId: data[i][2].toString().trim(),
        betOption: data[i][3].toString().trim(),
        coinsBet: Number(data[i][4]) || 0,
        winnings: Number(data[i][5]) || 0,
        result: data[i][6].toString().trim(),
        settled: data[i][7] === true || data[i][7].toString().toUpperCase() === 'TRUE',
        rowIndex: i + 1
      });
    }
  }
  return bets;
}

/**
 * Records bets in the Bets sheet in batch. Overwrites if a bet for (gameId, playerName) already exists.
 */
function recordBetsBatch(betsList) {
  var sheet = getOrCreateSheet(BETS_SHEET_NAME, [
    'Game ID', 'Player Name', 'WhatsApp ID', 'Bet Option', 'Coins Bet', 'Winnings', 'Result', 'Settled'
  ]);
  var existingBets = getBets();
  var betMap = {};
  existingBets.forEach(function(b) {
    var key = b.gameId + '_' + b.playerName;
    betMap[key] = b.rowIndex;
  });

  betsList.forEach(function(b) {
    var rowValues = [
      b.gameId,
      b.playerName,
      b.whatsappId,
      b.betOption,
      b.coinsBet,
      b.winnings || 0,
      b.result || '',
      b.settled === true
    ];
    
    var key = b.gameId + '_' + b.playerName;
    if (betMap.hasOwnProperty(key)) {
      var rowIndex = betMap[key];
      sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      sheet.appendRow(rowValues);
    }
  });
}
