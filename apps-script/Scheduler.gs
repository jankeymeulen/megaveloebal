/**
 * Scheduler.gs - Main entry points for daily triggers, batch jobs, and timezone calculations.
 */

/**
 * Runs in the morning (08:00 Brussels time).
 * Fetches today's matches, posts WhatsApp polls, and writes them to the Games sheet.
 */
function morningJob(dateStr) {
  var chatId = getConfig('WHATSAPP_GROUP_ID');
  if (!chatId) {
    Logger.log('Error: WHATSAPP_GROUP_ID is not configured.');
    return;
  }

  var targetDateStr = dateStr || Utilities.formatDate(new Date(), "Europe/Brussels", "yyyy-MM-dd");
  Logger.log('Starting morningJob for date ' + targetDateStr + '...');
  
  var window = getMatchWindowForDate(targetDateStr);
  Logger.log('Match window: ' + window.start.toString() + ' to ' + window.end.toString());

  var todayMatches = [];
  try {
    var allMatches = fetchAllWorldCupMatches();
    todayMatches = allMatches.filter(function(match) {
      var matchDate = new Date(match.utcDate);
      return matchDate >= window.start && matchDate < window.end;
    });
  } catch (e) {
    Logger.log('Error fetching matches for date ' + targetDateStr + ': ' + e.toString());
    sendWhatsAppMessage(chatId, '⚠️ Error fetching matches from Football-Data.org API. Standby!');
    return;
  }

  if (todayMatches.length === 0) {
    Logger.log('No matches scheduled in window for: ' + targetDateStr);
    return;
  }

  var gamesToSave = [];
  
  // Sort matches by time
  todayMatches.sort(function(a, b) {
    return new Date(a.utcDate) - new Date(b.utcDate);
  });

  // Post intro message
  var introText = "⚽ *MEGAVELOEBAL: WEDSTRIJDEN VANDAAG* ⚽\n\n" +
                  "Goeiemorgen! Wedstrijden van " + targetDateStr + ". " +
                  "Deadline is om *17:00*, " +
                  "inzet is *" + betCost + "* miljoen.".
                  "Faites votre jeu!!";
  sendWhatsAppMessage(chatId, introText);

  // Send a poll for each match
  todayMatches.forEach(function(match) {
    var homeTeam = match.homeTeam.name;
    var awayTeam = match.awayTeam.name;
    var stage = match.stage;
    var betCost = getBetCost(stage);
    
    // Poll options: Group stage allows "Draw", knockout rounds do not (predict progress)
    var options = [homeTeam, awayTeam];
    if (stage === 'GROUP_STAGE') {
      options.push('Draw');
    }

    var pollTitle = homeTeam + " - " + awayTeam;
    
    var pollMessageId = '';
    try {
      pollMessageId = sendWhatsAppPoll(chatId, pollTitle, options);
    } catch (e) {
      Logger.log('Failed to send poll for ' + pollTitle + ': ' + e.toString());
      // Try resending once after a brief pause
      Utilities.sleep(2000);
      try {
        pollMessageId = sendWhatsAppPoll(chatId, pollTitle, options);
      } catch (retryErr) {
        Logger.log('Retry failed: ' + retryErr.toString());
      }
    }

    gamesToSave.push({
      id: match.id.toString(),
      dateTime: match.utcDate,
      stage: stage,
      homeTeam: homeTeam,
      awayTeam: awayTeam,
      status: match.status,
      scoreHome: null,
      scoreAway: null,
      result: '',
      betCost: betCost,
      pollMessageId: pollMessageId,
      settled: false
    });
  });

  // Save games in database
  saveGames(gamesToSave);
  Logger.log('morningJob finished. Registered ' + gamesToSave.length + ' games for ' + targetDateStr + '.');
}

/**
 * Runs at the deadline (16:00 Brussels time).
 * Collects votes, records bets, deletes the polls, and posts a bet summary.
 */
function deadlineJob(dateStr) {
  var chatId = getConfig('WHATSAPP_GROUP_ID');
  if (!chatId) {
    Logger.log('Error: WHATSAPP_GROUP_ID is not configured.');
    return;
  }

  var targetDateStr = dateStr || Utilities.formatDate(new Date(), "Europe/Brussels", "yyyy-MM-dd");
  Logger.log('Starting deadlineJob for date ' + targetDateStr + '...');
  
  var window = getMatchWindowForDate(targetDateStr);
  Logger.log('Closing window: ' + window.start.toString() + ' to ' + window.end.toString());

  var games = getGames();
  var players = getPlayers();
  
  // Find active games that have polls and are not yet settled, filtering by date window
  var activeGames = games.filter(function(g) {
    if (!g.pollMessageId || g.settled) return false;
    
    var gameDate = new Date(g.dateTime);
    return gameDate >= window.start && gameDate < window.end;
  });

  if (activeGames.length === 0) {
    Logger.log('No active game polls to close in window for ' + targetDateStr + '.');
    return;
  }

  var betsToSave = [];
  var summaryText = "📋 *VOTES CLOSED: BET SUMMARY* 📋\n\n";

  activeGames.forEach(function(game) {
    var pollVotes = [];
    try {
      pollVotes = fetchPollVotes(chatId, game.pollMessageId);
    } catch (e) {
      Logger.log('Error fetching votes for game ' + game.id + ': ' + e.toString());
      sendWhatsAppMessage(chatId, '⚠️ Error retrieving poll votes for ' + game.homeTeam + ' vs ' + game.awayTeam + '. Settle manually if needed.');
      return;
    }

    // Map votes to player names
    var playerVotesMap = {};
    pollVotes.forEach(function(vote) {
      // Find player by WhatsApp ID JID (e.g. "12345@c.us")
      var matchedPlayer = players.find(function(p) {
        return p.whatsappId.replace(/\s+/g, '') === vote.voter.replace(/\s+/g, '');
      });
      if (matchedPlayer) {
        playerVotesMap[matchedPlayer.name] = vote.selectedOptionName;
      }
    });

    // Record bets for all players
    var homeVotes = [];
    var awayVotes = [];
    var drawVotes = [];
    var noVotes = [];

    players.forEach(function(p) {
      var option = playerVotesMap[p.name];
      var betOption = 'NO_VOTE';

      if (option) {
        // Map option text back to DB value: HOME_WIN, AWAY_WIN, DRAW
        if (option === game.homeTeam) {
          betOption = 'HOME_WIN';
          homeVotes.push(p.displayName);
        } else if (option === game.awayTeam) {
          betOption = 'AWAY_WIN';
          awayVotes.push(p.displayName);
        } else if (option === 'Draw') {
          betOption = 'DRAW';
          drawVotes.push(p.displayName);
        } else {
          // Fallback if formatting differed
          betOption = 'NO_VOTE';
          noVotes.push(p.displayName);
        }
      } else {
        noVotes.push(p.displayName);
      }

      betsToSave.push({
        gameId: game.id,
        playerName: p.name,
        whatsappId: p.whatsappId,
        betOption: betOption,
        coinsBet: game.betCost,
        winnings: 0,
        result: '',
        settled: false
      });
    });

    // Clean up WhatsApp by deleting the poll
    try {
      deleteWhatsAppMessage(chatId, game.pollMessageId);
    } catch (e) {
      Logger.log('Failed to delete poll message ' + game.pollMessageId + ': ' + e.toString());
    }

    // Build this game's summary block
    summaryText += "*" + game.homeTeam + " - " + game.awayTeam + "*\n" +
                   "• " + game.homeTeam + ": " + (homeVotes.length > 0 ? homeVotes.join(', ') : "_None_") + "\n" +
                   "• " + game.awayTeam + ": " + (awayVotes.length > 0 ? awayVotes.join(', ') : "_None_") + "\n";
    if (game.stage === 'GROUP_STAGE') {
      summaryText += "• Draw: " + (drawVotes.length > 0 ? drawVotes.join(', ') : "_None_") + "\n";
    }
    summaryText += "• Blanco: " + 
                   (noVotes.length > 0 ? noVotes.join(', ') : "_None_") + "\n\n";

    // Clear pollMessageId in games list so it doesn't trigger again
    game.pollMessageId = '';
  });

  // Save games and bets to spreadsheet
  saveGames(activeGames);
  recordBetsBatch(betsToSave);

  // Send summary to WhatsApp
  sendWhatsAppMessage(chatId, summaryText);
  Logger.log('deadlineJob finished. Logged bets for ' + targetDateStr + '.');
}

/**
 * settlementJob()
 * Checks for finished matches on the Football-Data API, updates scores,
 * distributes winnings, and updates standings in the group chat.
 */
function settlementJob() {
  var chatId = getConfig('WHATSAPP_GROUP_ID');
  if (!chatId) {
    Logger.log('Error: WHATSAPP_GROUP_ID is not configured.');
    return;
  }

  Logger.log('Starting settlementJob...');
  var games = getGames();
  
  // Find unsettled games
  var unsettledGames = games.filter(function(g) {
    return !g.settled;
  });

  if (unsettledGames.length === 0) {
    Logger.log('No unsettled games found in database.');
    return;
  }

  var matchIds = unsettledGames.map(function(g) { return g.id; });
  var updatedMatches = [];
  try {
    updatedMatches = fetchMatchStates(matchIds);
  } catch (e) {
    Logger.log('Error fetching match states: ' + e.toString());
    return;
  }

  var players = getPlayers();
  var bets = getBets();
  var gamesToUpdate = [];

  updatedMatches.forEach(function(match) {
    var localGame = unsettledGames.find(function(g) {
      return g.id === match.id.toString();
    });

    if (!localGame) return;

    // Check if match is finished
    if (match.status === 'FINISHED') {
      Logger.log('Settling match ' + localGame.homeTeam + ' vs ' + localGame.awayTeam);
      
      var scoreHome = match.score.fullTime.home;
      var scoreAway = match.score.fullTime.away;
      var result = '';

      // Determine result based on score winner
      if (match.score.winner === 'HOME_TEAM') {
        result = 'HOME_WIN';
      } else if (match.score.winner === 'AWAY_TEAM') {
        result = 'AWAY_WIN';
      } else if (match.score.winner === 'DRAW') {
        result = 'DRAW';
      } else {
        // Fallback using actual numbers if winner not specified
        if (scoreHome > scoreAway) result = 'HOME_WIN';
        else if (scoreHome < scoreAway) result = 'AWAY_WIN';
        else result = 'DRAW';
      }

      // 1. Calculate pool updates
      var settlement = calculateMatchSettlement(players, bets, localGame.id, localGame.stage, result);
      
      // Update local players array in memory for subsequent matches processed in the same run
      players.forEach(function(p) {
        if (settlement.balanceUpdates.hasOwnProperty(p.name)) {
          p.balance = settlement.balanceUpdates[p.name];
        }
      });

      // 2. Commit to database
      updatePlayerBalances(settlement.balanceUpdates);
      recordBetsBatch(settlement.betsUpdates);

      // 3. Mark game as settled
      localGame.status = 'FINISHED';
      localGame.scoreHome = scoreHome;
      localGame.scoreAway = scoreAway;
      localGame.result = result;
      localGame.settled = true;
      gamesToUpdate.push(localGame);

      // 4. Create and send announcement
      var winnersList = settlement.betsUpdates.filter(function(b) { return b.result === 'WIN'; }).map(function(b) {
        var p = players.find(function(pl) { return pl.name === b.playerName; });
        return p ? p.displayName : b.playerName;
      });
      var losersList = settlement.betsUpdates.filter(function(b) { return b.result === 'LOSE'; }).map(function(b) {
        var p = players.find(function(pl) { return pl.name === b.playerName; });
        return p ? p.displayName : b.playerName;
      });
      var noVotersList = settlement.betsUpdates.filter(function(b) { return b.result === 'NO_VOTE'; }).map(function(b) {
        var p = players.find(function(pl) { return pl.name === b.playerName; });
        return p ? p.displayName : b.playerName;
      });

      var betCost = getBetCost(localGame.stage);
      var totalLosingPool = losersList.length * betCost;
      var winDiffStr = winnersList.length > 0 ? ' (+' + (totalLosingPool / winnersList.length).toFixed(1) + ' coins)' : '';

      var resultMessage = "⚽ *GAME FINISHED: RESULT* ⚽\n\n" +
                          "*" + localGame.homeTeam + "* " + scoreHome + " - " + scoreAway + " *" + localGame.awayTeam + "*\n\n" +
                          "✅ Winners" + winDiffStr + ": " + (winnersList.length > 0 ? winnersList.join(', ') : "_None_") + "\n" +
                          "❌ Losers (-" + betCost + "): " + (losersList.length > 0 ? losersList.join(', ') : "_None_") + "\n" +
                          "📭 Did not vote (-" + betCost + "): " + (noVotersList.length > 0 ? noVotersList.join(', ') : "_None_") + "\n\n" +
                          generateStandingsText(players);

      sendWhatsAppMessage(chatId, resultMessage);
    }
  });

  if (gamesToUpdate.length > 0) {
    saveGames(gamesToUpdate);
    Logger.log('Settled ' + gamesToUpdate.length + ' games.');
  } else {
    Logger.log('No new games completed in this run.');
  }
}

/**
 * Configures the Google Apps Script project triggers programmatically.
 * Clears old triggers and schedules morningJob (09:00) and deadlineJob (17:00).
 */
function setupDailyTriggers() {
  // Clear any existing triggers
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    ScriptApp.deleteTrigger(trigger);
  });

  // 1. Create a daily recurring trigger that runs early in the morning (e.g. 5:00 - 6:00 AM)
  // This trigger's job is to schedule the *exact* one-time execution timestamps for 09:00 and 17:00.
  ScriptApp.newTrigger('scheduleExactTriggersForToday')
    .timeBased()
    .everyDays(1)
    .atHour(5)
    .create();

  // 2. Create a recurring trigger for the settlement check (e.g. every 15 minutes)
  ScriptApp.newTrigger('settlementJob')
    .timeBased()
    .everyMinutes(15)
    .create();

  // Run the scheduler immediately to set up today's exact jobs
  scheduleExactTriggersForToday();
}

/**
 * Calculates exact millisecond dates for 09:00 and 17:00 Brussels time
 * and schedules one-time triggers for them.
 */
function scheduleExactTriggersForToday() {
  // Clear any existing one-time triggers for morningJob or deadlineJob
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    var fn = trigger.getHandlerFunction();
    if (fn === 'morningJob' || fn === 'deadlineJob') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  var timezone = "Europe/Brussels";
  var now = new Date();
  
  // Calculate today at 09:00:00 Brussels
  var morningStr = Utilities.formatDate(now, timezone, "yyyy-MM-dd'T'09:00:00");
  var morningDate = parseDateString(morningStr);
  if (morningDate.getTime() < now.getTime()) {
    // If it has passed already today, schedule for tomorrow
    morningDate.setDate(morningDate.getDate() + 1);
  }
  
  // Calculate today at 17:00:00 Brussels
  var deadlineStr = Utilities.formatDate(now, timezone, "yyyy-MM-dd'T'17:00:00");
  var deadlineDate = parseDateString(deadlineStr);
  if (deadlineDate.getTime() < now.getTime()) {
    deadlineDate.setDate(deadlineDate.getDate() + 1);
  }

  // Create exact one-shot triggers
  ScriptApp.newTrigger('morningJob').timeBased().at(morningDate).create();
  ScriptApp.newTrigger('deadlineJob').timeBased().at(deadlineDate).create();
  
  Logger.log('Scheduled morningJob at: ' + morningDate.toString());
  Logger.log('Scheduled deadlineJob at: ' + deadlineDate.toString());
}

/**
 * Helper to parse a local ISO-like date string under the Script's timezone
 */
function parseDateString(str) {
  // Format: "YYYY-MM-DDTHH:MM:SS"
  var parts = str.split('T');
  var dateParts = parts[0].split('-');
  var timeParts = parts[1].split(':');
  
  return new Date(
    Number(dateParts[0]),
    Number(dateParts[1]) - 1, // month is 0-indexed
    Number(dateParts[2]),
    Number(timeParts[0]),
    Number(timeParts[1]),
    Number(timeParts[2])
  );
}

/**
 * Calculates the betting match window for a given date.
 * Matches must start after Day X 17:00 Brussels and before Day X+1 09:00 Brussels.
 * @param {string} targetDateStr Date string "YYYY-MM-DD" (Europe/Brussels)
 * @returns {Object} { start: Date, end: Date }
 */
function getMatchWindowForDate(targetDateStr) {
  var parts = targetDateStr.split('-');
  var year = Number(parts[0]);
  var month = Number(parts[1]) - 1;
  var day = Number(parts[2]);
  
  // Start: Day X at 17:00:00 Brussels time
  var windowStart = new Date(year, month, day, 17, 0, 0);
  
  // End: Day X+1 at 09:00:00 Brussels time
  var nextDay = new Date(year, month, day, 17, 0, 0);
  nextDay.setDate(nextDay.getDate() + 1);
  var windowEnd = new Date(nextDay.getFullYear(), nextDay.getMonth(), nextDay.getDate(), 9, 0, 0);
  
  return {
    start: windowStart,
    end: windowEnd
  };
}
