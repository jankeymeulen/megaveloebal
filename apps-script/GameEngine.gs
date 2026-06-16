/**
 * GameEngine.gs - Core game logic including stage to cost mapping, settlement, and leaderboard generation.
 */

/**
 * Determines the cost of a bet for a given stage of the World Cup.
 */
function getBetCost(stage) {
  switch (stage) {
    case 'GROUP_STAGE':
      return 1;
    case 'LAST_16':
    case 'ROUND_OF_16':
      return 2;
    case 'QUARTER_FINALS':
      return 4;
    case 'SEMI_FINALS':
      return 8;
    case 'THIRD_PLACE':
      return 8;
    case 'FINAL':
      return 32;
    default:
      return 1;
  }
}

/**
 * Calculates the balance and bet updates for a completed match.
 * @param {Array<Object>} players List of players from getPlayers()
 * @param {Array<Object>} bets List of bets from getBets()
 * @param {string} gameId The ID of the match to settle
 * @param {string} stage The stage of the match
 * @param {string} result The result ('HOME_WIN', 'AWAY_WIN', 'DRAW')
 * @returns {Object} { balanceUpdates: {playerName: newBalance}, betsUpdates: [betsToSave] }
 */
function calculateMatchSettlement(players, bets, gameId, stage, result) {
  var betCost = getBetCost(stage);
  
  // Get all bets specifically recorded for this game (voted before deadline)
  var gameBets = bets.filter(function(b) {
    return b.gameId === gameId;
  });
  
  var activeVoters = gameBets.filter(function(b) {
    return b.betOption !== 'NO_VOTE';
  });

  // Winners and losers among active voters
  var winners = activeVoters.filter(function(b) {
    return b.betOption === result;
  });
  var losers = activeVoters.filter(function(b) {
    return b.betOption !== result;
  });

  // Calculate the pool of coins from players who voted incorrectly
  var totalLosingPool = losers.length * betCost;

  var balanceUpdates = {};
  var betsUpdates = [];

  // 1. Deduct the bet cost from EVERY player's balance first
  players.forEach(function(p) {
    balanceUpdates[p.name] = p.balance - betCost;
  });

  // 2. Distribute winnings if there are winners
  if (winners.length > 0) {
    var winningsPerWinner = totalLosingPool / winners.length;

    // Process winners: they get their bet back + their share of the losers' pool
    winners.forEach(function(w) {
      var payout = betCost + winningsPerWinner;
      balanceUpdates[w.playerName] += payout;
      
      betsUpdates.push({
        gameId: gameId,
        playerName: w.playerName,
        whatsappId: w.whatsappId,
        betOption: w.betOption,
        coinsBet: betCost,
        winnings: winningsPerWinner,
        result: 'WIN',
        settled: true
      });
    });

    // Process incorrect voters: they get 0 winnings and lose their bet
    losers.forEach(function(l) {
      betsUpdates.push({
        gameId: gameId,
        playerName: l.playerName,
        whatsappId: l.whatsappId,
        betOption: l.betOption,
        coinsBet: betCost,
        winnings: 0,
        result: 'LOSE',
        settled: true
      });
    });
  } else {
    // If no one predicted correctly, all active voters get 0 and lose their bet (burned)
    activeVoters.forEach(function(v) {
      betsUpdates.push({
        gameId: gameId,
        playerName: v.playerName,
        whatsappId: v.whatsappId,
        betOption: v.betOption,
        coinsBet: betCost,
        winnings: 0,
        result: 'LOSE',
        settled: true
      });
    });
  }

  // 3. Process non-voters (NO_VOTE)
  // Identify players in the game who did not place a bet before the deadline (or had NO_VOTE recorded)
  players.forEach(function(p) {
    var playerBet = gameBets.find(function(b) {
      return b.playerName.trim().toLowerCase() === p.name.trim().toLowerCase();
    });
    if (!playerBet || playerBet.betOption === 'NO_VOTE') {
      betsUpdates.push({
        gameId: gameId,
        playerName: p.name,
        whatsappId: p.whatsappId,
        betOption: 'NO_VOTE',
        coinsBet: betCost,
        winnings: 0,
        result: 'NO_VOTE',
        settled: true
      });
    }
  });

  return {
    balanceUpdates: balanceUpdates,
    betsUpdates: betsUpdates
  };
}

/**
 * Generates a formatted text leaderboard of current standings.
 * @param {Array<Object>} players List of players with balance
 * @returns {string} Formatted text for WhatsApp
 */
function generateStandingsText(players) {
  var sorted = players.slice().sort(function(a, b) {
    return b.balance - a.balance;
  });

  var text = "🏆 *STAND* 🏆\n\n";
  sorted.forEach(function(p, index) {
    var medal = "";
    if (index === 0) medal = "🥇 ";
    else if (index === 1) medal = "🥈 ";
    else if (index === 2) medal = "🥉 ";
    else medal = (index + 1) + ". ";

    var formattedBalance = p.balance % 1 === 0 ? p.balance.toFixed(0) : p.balance.toFixed(1);
    text += medal + "*" + p.displayName + "*: " + formattedBalance + " miljoen\n";
  });
  return text;
}
