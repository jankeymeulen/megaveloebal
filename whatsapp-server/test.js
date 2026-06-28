/**
 * test.js - Unit tests for the betting pool distribution logic.
 * Run with: npm test
 */

// Betting engine calculation function (mirrors GameEngine.gs)
function calculateWinnings(players, bets, gameId, stage, result) {
  // 1. Determine bet cost based on stage
  let betCost = 1;
  if (!stage) stage = 'GROUP_STAGE';
  switch (stage.trim().toUpperCase()) {
    case 'GROUP_STAGE':
      betCost = 1;
      break;
    case 'LAST_32':
    case 'ROUND_OF_32':
      betCost = 2;
      break;
    case 'LAST_16':
    case 'ROUND_OF_16':
      betCost = 4;
      break;
    case 'QUARTER_FINALS':
    case 'LAST_8':
    case 'ROUND_OF_8':
      betCost = 8;
      break;
    case 'SEMI_FINALS':
    case 'LAST_4':
    case 'ROUND_OF_4':
      betCost = 16;
      break;
    case 'THIRD_PLACE':
      betCost = 8;
      break;
    case 'FINAL':
    case 'FINALS':
      betCost = 32;
      break;
    default:
      betCost = 1;
  }

  // Find all bets for this game
  const gameBets = bets.filter(b => b.gameId === gameId);
  const activeVoters = gameBets.filter(b => b.betOption !== 'NO_VOTE');
  
  // Players who predicted correctly
  const winners = activeVoters.filter(b => b.betOption === result);
  // Players who predicted incorrectly
  const losers = activeVoters.filter(b => b.betOption !== result);

  // Total losing pool from incorrect active voters
  const totalLosingPool = losers.length * betCost;
  
  // Map to hold updates
  const balanceUpdates = {};
  
  // Deduct bet cost from EVERY player currently in the game
  players.forEach(p => {
    balanceUpdates[p.name] = -betCost;
  });

  // Calculate payouts
  const betsUpdates = [];

  if (winners.length > 0) {
    // Winnings per correct predictor
    const winningsPerWinner = totalLosingPool / winners.length;
    
    // Process winners
    winners.forEach(w => {
      // Winner gets their bet cost refunded + their share of the losing pool
      const payout = betCost + winningsPerWinner;
      // Net change for winner is payout - betCost = winningsPerWinner
      balanceUpdates[w.playerName] += payout;
      
      betsUpdates.push({
        playerName: w.playerName,
        gameId: gameId,
        coinsBet: betCost,
        winnings: winningsPerWinner,
        result: 'WIN',
        settled: true
      });
    });

    // Process incorrect voters
    losers.forEach(l => {
      // Net change for loser is just -betCost (already deducted)
      betsUpdates.push({
        playerName: l.playerName,
        gameId: gameId,
        coinsBet: betCost,
        winnings: 0,
        result: 'LOSE',
        settled: true
      });
    });
  } else {
    // If NO ONE predicted correctly, all active bets are burned
    activeVoters.forEach(v => {
      betsUpdates.push({
        playerName: v.playerName,
        gameId: gameId,
        coinsBet: betCost,
        winnings: 0,
        result: 'LOSE',
        settled: true
      });
    });
  }

  // Handle players who didn't vote (NO_VOTE)
  // Find players who did not have any bet recorded for this game
  players.forEach(p => {
    const hasBet = gameBets.some(b => b.playerName === p.name);
    if (!hasBet) {
      betsUpdates.push({
        playerName: p.name,
        gameId: gameId,
        coinsBet: betCost,
        winnings: 0,
        result: 'NO_VOTE',
        settled: true
      });
    }
  });

  // Apply updates to original player balances for assertions
  const updatedPlayers = players.map(p => {
    return {
      name: p.name,
      balance: p.balance + (balanceUpdates[p.name] || 0)
    };
  });

  return {
    updatedPlayers,
    betsUpdates
  };
}

// Assert helper
function assertEquals(actual, expected, testName) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`✅ PASS: ${testName}`);
  } else {
    console.error(`❌ FAIL: ${testName}`);
    console.error(`  Expected:`, expected);
    console.error(`  Actual:  `, actual);
    process.exit(1);
  }
}

// Running Tests
console.log('Running Betting Engine Unit Tests...\n');

// --- Test Scenario A: Group Stage, Standard Voters & Non-Voters ---
// Alice, Bob, Charlie, Dave, Eve starts with 125. Bet is 1.
// Alice (DRAW), Bob (HOME_WIN), Charlie (HOME_WIN), Dave (AWAY_WIN). Eve didn't vote.
// HOME_WIN wins.
// Expected Ending Balances:
// - Alice: 124 (loser, lost 1)
// - Bob: 126 (winner, got bet back + 1 coin winnings)
// - Charlie: 126 (winner, got bet back + 1 coin winnings)
// - Dave: 124 (loser, lost 1)
// - Eve: 124 (no vote, lost 1, burned)
const playersA = [
  { name: 'Alice', balance: 125 },
  { name: 'Bob', balance: 125 },
  { name: 'Charlie', balance: 125 },
  { name: 'Dave', balance: 125 },
  { name: 'Eve', balance: 125 }
];
const betsA = [
  { gameId: 'g1', playerName: 'Alice', betOption: 'DRAW' },
  { gameId: 'g1', playerName: 'Bob', betOption: 'HOME_WIN' },
  { gameId: 'g1', playerName: 'Charlie', betOption: 'HOME_WIN' },
  { gameId: 'g1', playerName: 'Dave', betOption: 'AWAY_WIN' }
  // Eve is missing (NO_VOTE)
];
const resultA = calculateWinnings(playersA, betsA, 'g1', 'GROUP_STAGE', 'HOME_WIN');
assertEquals(
  resultA.updatedPlayers.find(p => p.name === 'Alice').balance, 124, 'Scenario A - Alice Balance'
);
assertEquals(
  resultA.updatedPlayers.find(p => p.name === 'Bob').balance, 126, 'Scenario A - Bob Balance'
);
assertEquals(
  resultA.updatedPlayers.find(p => p.name === 'Charlie').balance, 126, 'Scenario A - Charlie Balance'
);
assertEquals(
  resultA.updatedPlayers.find(p => p.name === 'Dave').balance, 124, 'Scenario A - Dave Balance'
);
assertEquals(
  resultA.updatedPlayers.find(p => p.name === 'Eve').balance, 124, 'Scenario A - Eve Balance'
);
assertEquals(
  resultA.betsUpdates.find(b => b.playerName === 'Eve').result, 'NO_VOTE', 'Scenario A - Eve Bet Result'
);


// --- Test Scenario B: Round of 16 (Bet cost = 4) ---
// Alice (HOME_WIN), Bob (HOME_WIN), Charlie (AWAY_WIN). Dave/Eve didn't vote.
// HOME_WIN wins.
// Expected Ending Balances:
// - Alice: 127 (winner, got bet 4 back + 2 coin winnings. Net +2)
// - Bob: 127 (winner, got bet 4 back + 2 coin winnings. Net +2)
// - Charlie: 121 (loser, lost 4. Net -4)
// - Dave: 121 (no vote, lost 4, burned)
// - Eve: 121 (no vote, lost 4, burned)
const playersB = [
  { name: 'Alice', balance: 125 },
  { name: 'Bob', balance: 125 },
  { name: 'Charlie', balance: 125 },
  { name: 'Dave', balance: 125 },
  { name: 'Eve', balance: 125 }
];
const betsB = [
  { gameId: 'g2', playerName: 'Alice', betOption: 'HOME_WIN' },
  { gameId: 'g2', playerName: 'Bob', betOption: 'HOME_WIN' },
  { gameId: 'g2', playerName: 'Charlie', betOption: 'AWAY_WIN' }
  // Dave, Eve missing
];
const resultB = calculateWinnings(playersB, betsB, 'g2', 'ROUND_OF_16', 'HOME_WIN');
assertEquals(
  resultB.updatedPlayers.find(p => p.name === 'Alice').balance, 127, 'Scenario B - Alice Balance'
);
assertEquals(
  resultB.updatedPlayers.find(p => p.name === 'Charlie').balance, 121, 'Scenario B - Charlie Balance'
);
assertEquals(
  resultB.updatedPlayers.find(p => p.name === 'Dave').balance, 121, 'Scenario B - Dave Balance'
);


// --- Test Scenario C: No Winners (All active voters incorrect) ---
// Alice (HOME_WIN), Bob (AWAY_WIN), Charlie didn't vote.
// Result is DRAW.
// Expected Ending Balances:
// - Alice: 124 (loser, lost 1)
// - Bob: 124 (loser, lost 1)
// - Charlie: 124 (no vote, lost 1)
const playersC = [
  { name: 'Alice', balance: 125 },
  { name: 'Bob', balance: 125 },
  { name: 'Charlie', balance: 125 }
];
const betsC = [
  { gameId: 'g3', playerName: 'Alice', betOption: 'HOME_WIN' },
  { gameId: 'g3', playerName: 'Bob', betOption: 'AWAY_WIN' }
];
const resultC = calculateWinnings(playersC, betsC, 'g3', 'GROUP_STAGE', 'DRAW');
assertEquals(
  resultC.updatedPlayers.find(p => p.name === 'Alice').balance, 124, 'Scenario C - Alice Balance'
);
assertEquals(
  resultC.updatedPlayers.find(p => p.name === 'Bob').balance, 124, 'Scenario C - Bob Balance'
);
assertEquals(
  resultC.updatedPlayers.find(p => p.name === 'Charlie').balance, 124, 'Scenario C - Charlie Balance'
);


// --- Test Scenario D: Everyone Predicts Correctly ---
// Alice (HOME_WIN), Bob (HOME_WIN).
// Result is HOME_WIN.
// Expected Ending Balances:
// - Alice: 125 (winner, got bet 1 back. Net 0)
// - Bob: 125 (winner, got bet 1 back. Net 0)
const playersD = [
  { name: 'Alice', balance: 125 },
  { name: 'Bob', balance: 125 }
];
const betsD = [
  { gameId: 'g4', playerName: 'Alice', betOption: 'HOME_WIN' },
  { gameId: 'g4', playerName: 'Bob', betOption: 'HOME_WIN' }
];
const resultD = calculateWinnings(playersD, betsD, 'g4', 'GROUP_STAGE', 'HOME_WIN');
assertEquals(
  resultD.updatedPlayers.find(p => p.name === 'Alice').balance, 125, 'Scenario D - Alice Balance'
);
assertEquals(
  resultD.updatedPlayers.find(p => p.name === 'Bob').balance, 125, 'Scenario D - Bob Balance'
);

console.log('\nAll betting logic tests passed successfully!');
