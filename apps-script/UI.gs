/**
 * UI.gs - Implements the Custom Google Sheets menu for manual testing and controls.
 */

/**
 * Triggered automatically when the spreadsheet is opened.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('⚽ WC Betting Game')
    .addItem('Run morning poll setup (08:00)', 'menuMorningJob')
    .addItem('Run deadline close & collect (16:00)', 'menuDeadlineJob')
    .addItem('Run settlement check (scores)', 'menuSettlementJob')
    .addSeparator()
    .addItem('Fetch matches for custom date...', 'menuMorningJobCustomDate')
    .addItem('Close polls for custom date...', 'menuDeadlineJobCustomDate')
    .addSeparator()
    .addItem('Initialize daily triggers', 'menuSetupTriggers')
    .addSeparator()
    .addItem('List WhatsApp JIDs / Chat IDs', 'menuListChats')
    .addItem('Send test poll to specific JID', 'menuSendTestPoll')
    .addItem('Send test message to specific JID', 'menuSendTestMessage')
    .addItem('Run interactive end-to-end test', 'menuRunInteractiveTest')
    .addToUi();
}

function menuMorningJob() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert('Run Morning Polls', 'Are you sure you want to fetch today\'s matches and post the polls to the group chat now?', ui.ButtonSet.YES_NO);
  if (response === ui.Button.YES) {
    ui.showModalDialog(HtmlService.createHtmlOutput('Running morning job... Please wait.'), 'Working');
    try {
      morningJob();
      ui.alert('Success', 'Morning job executed successfully. Check the WhatsApp Group!', ui.ButtonSet.OK);
    } catch (e) {
      ui.alert('Error', 'Execution failed: ' + e.toString(), ui.ButtonSet.OK);
    }
  }
}

function menuDeadlineJob() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert('Run Deadline Collection', 'Are you sure you want to close the active polls, download votes, record bets, and post the summary to WhatsApp now?', ui.ButtonSet.YES_NO);
  if (response === ui.Button.YES) {
    try {
      deadlineJob();
      ui.alert('Success', 'Deadline job executed successfully.', ui.ButtonSet.OK);
    } catch (e) {
      ui.alert('Error', 'Execution failed: ' + e.toString(), ui.ButtonSet.OK);
    }
  }
}

function menuSettlementJob() {
  var ui = SpreadsheetApp.getUi();
  try {
    settlementJob();
    ui.alert('Finished', 'Settlement check complete. Check the Logs or WhatsApp for settled matches.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Error', 'Execution failed: ' + e.toString(), ui.ButtonSet.OK);
  }
}

function menuSetupTriggers() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert('Initialize triggers', 'Are you sure you want to set up the automated Apps Script triggers for morning, deadline, and settlement? This will clear any existing project triggers.', ui.ButtonSet.YES_NO);
  if (response === ui.Button.YES) {
    try {
      setupDailyTriggers();
      ui.alert('Success', 'Triggers initialized. System will run morning job at 09:00 Brussels time and deadline job at 17:00 Brussels time daily.', ui.ButtonSet.OK);
    } catch (e) {
      ui.alert('Error', 'Execution failed: ' + e.toString(), ui.ButtonSet.OK);
    }
  }
}

/**
 * Fetches all chats from the Node.js server and lists them in a modal dialog.
 */
function menuListChats() {
  var ui = SpreadsheetApp.getUi();
  try {
    var res = makeWhatsAppRequest('/chats', {});
    if (!res.chats || res.chats.length === 0) {
      ui.alert('No chats found. Make sure your WhatsApp client is fully connected and ready.');
      return;
    }
    
    var html = '<div style="font-family: Arial, sans-serif; padding: 15px; background-color: #fafafa;">';
    html += '<h2 style="color: #075e54; margin-top:0;">Recent WhatsApp Chats</h2>';
    html += '<p style="color: #666; font-size: 13px;">Copy the exact JID of your betting group or target contact and paste it into the <b>Config</b> sheet (key: <code>WHATSAPP_GROUP_ID</code>).</p>';
    html += '<div style="max-height: 280px; overflow-y: auto; border: 1px solid #ddd; background: white; border-radius:4px;">';
    html += '<table border="0" cellpadding="8" cellspacing="0" style="width: 100%; border-collapse: collapse; font-size:13px;">';
    html += '<thead><tr style="background-color: #f2f2f2; border-bottom: 2px solid #ddd; text-align:left;"><th>Chat Name</th><th>JID (Chat ID)</th><th>Type</th></tr></thead><tbody>';
    
    res.chats.forEach(function(chat, idx) {
      var bg = idx % 2 === 0 ? '#ffffff' : '#f9f9f9';
      html += '<tr style="background-color: ' + bg + '; border-bottom: 1px solid #eee;">';
      html += '<td style="font-weight:bold;">' + chat.name + '</td>';
      html += '<td><code style="background: #f1f1f1; padding: 2px 5px; border-radius: 3px; font-family: monospace;">' + chat.id + '</code></td>';
      html += '<td style="color:#777;">' + (chat.isGroup ? 'Group 👥' : 'Private 👤') + '</td>';
      html += '</tr>';
    });
    
    html += '</tbody></table></div></div>';
    
    var userInterface = HtmlService.createHtmlOutput(html)
        .setWidth(600)
        .setHeight(400);
    ui.showModelessDialog(userInterface, 'WhatsApp Chat JIDs');
  } catch (e) {
    ui.alert('Error', 'Failed to retrieve chats: ' + e.toString(), ui.ButtonSet.OK);
  }
}

/**
 * Prompts user to send a test poll to a custom JID.
 */
function menuSendTestPoll() {
  var ui = SpreadsheetApp.getUi();
  
  // Try to pre-fill with config JID
  var defaultJid = getConfig('WHATSAPP_GROUP_ID') || '';
  
  var jidPrompt = ui.prompt('Send Test Poll', 'Enter WhatsApp JID (e.g. 1203630248382@g.us):', ui.ButtonSet.OK_CANCEL);
  if (jidPrompt.getSelectedButton() !== ui.Button.OK) return;
  var targetJid = jidPrompt.getResponseText().trim();
  if (!targetJid) {
    ui.alert('JID cannot be empty.');
    return;
  }
  
  var titlePrompt = ui.prompt('Send Test Poll', 'Enter Poll Title:', ui.ButtonSet.OK_CANCEL);
  if (titlePrompt.getSelectedButton() !== ui.Button.OK) return;
  var pollTitle = titlePrompt.getResponseText().trim();
  
  var optionsPrompt = ui.prompt('Send Test Poll', 'Enter Poll Options (comma separated, e.g. Brazil, Croatia, Draw):', ui.ButtonSet.OK_CANCEL);
  if (optionsPrompt.getSelectedButton() !== ui.Button.OK) return;
  var rawOptions = optionsPrompt.getResponseText();
  var pollOptions = rawOptions.split(',').map(function(opt) { return opt.trim(); }).filter(Boolean);
  
  if (pollOptions.length < 2) {
    ui.alert('You must provide at least 2 options.');
    return;
  }
  
  try {
    var msgId = sendWhatsAppPoll(targetJid, pollTitle, pollOptions);
    ui.alert('Success', 'Test poll sent successfully. Message ID:\n' + msgId, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Error', 'Failed to send poll: ' + e.toString(), ui.ButtonSet.OK);
  }
}

/**
 * Prompts user to send a test text message.
 */
function menuSendTestMessage() {
  var ui = SpreadsheetApp.getUi();
  
  var jidPrompt = ui.prompt('Send Test Message', 'Enter WhatsApp JID (e.g. 1234567890@c.us):', ui.ButtonSet.OK_CANCEL);
  if (jidPrompt.getSelectedButton() !== ui.Button.OK) return;
  var targetJid = jidPrompt.getResponseText().trim();
  if (!targetJid) return;
  
  var msgPrompt = ui.prompt('Send Test Message', 'Enter Text Message:', ui.ButtonSet.OK_CANCEL);
  if (msgPrompt.getSelectedButton() !== ui.Button.OK) return;
  var messageText = msgPrompt.getResponseText();
  
  try {
    var msgId = sendWhatsAppMessage(targetJid, messageText);
    ui.alert('Success', 'Test message sent. Message ID:\n' + msgId, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Error', 'Failed to send message: ' + e.toString(), ui.ButtonSet.OK);
  }
}

/**
 * Runs an interactive, blocking end-to-end test to verify poll sending, vote retrieval,
 * poll deletion, and summary dispatch using existing codepaths.
 */
function menuRunInteractiveTest() {
  var ui = SpreadsheetApp.getUi();
  var defaultJid = getConfig('WHATSAPP_GROUP_ID') || '';
  
  var jidPrompt = ui.prompt('Interactive E2E Test', 'Enter WhatsApp JID for testing (e.g. 1203630248382@g.us):', ui.ButtonSet.OK_CANCEL);
  if (jidPrompt.getSelectedButton() !== ui.Button.OK) return;
  var targetJid = jidPrompt.getResponseText().trim();
  if (!targetJid) {
    ui.alert('Error', 'JID cannot be empty.', ui.ButtonSet.OK);
    return;
  }
  
  try {
    // 1. Send test poll using standard codepath
    var pollTitle = "🧪 E2E Test Poll: Pizza vs Burgers";
    var options = ["Pizza 🍕", "Burgers 🍔"];
    var pollMessageId = sendWhatsAppPoll(targetJid, pollTitle, options);
    
    // Show a blocking alert that pauses Apps Script execution until user votes on phone
    var instructionResponse = ui.alert(
      'Test Poll Sent!', 
      'A test poll has been sent to the chat.\n\n' +
      '1. Open your WhatsApp and vote on the poll.\n' +
      '2. Once you have voted, return here and click YES to pull the votes, delete the poll, and send a summary.\n\n' +
      'Do you want to continue and collect votes?', 
      ui.ButtonSet.YES_NO
    );
    
    if (instructionResponse === ui.Button.YES) {
      // 2. Fetch votes using standard codepath
      var votes = fetchPollVotes(targetJid, pollMessageId);
      
      // 3. Delete poll using standard codepath
      deleteWhatsAppMessage(targetJid, pollMessageId);
      
      // 4. Send summary using standard codepath
      var summaryText = "🧪 *E2E TEST RESULT: SUMMARY* 🧪\n\n" +
                        "The test poll has been closed and deleted.\n\n" +
                        "Here are the votes collected:\n";
      
      if (votes.length === 0) {
        summaryText += "_No votes were cast!_";
      } else {
        votes.forEach(function(v) {
          summaryText += "• *" + v.voter + "* voted for *" + v.selectedOptionName + "*\n";
        });
      }
      
      sendWhatsAppMessage(targetJid, summaryText);
      ui.alert('Test Finished', 'Votes were collected, the poll was deleted, and the summary was posted in WhatsApp!', ui.ButtonSet.OK);
    } else {
      // User canceled, still delete the poll to clean up
      deleteWhatsAppMessage(targetJid, pollMessageId);
      ui.alert('Test Canceled', 'Test canceled. The poll was deleted to clean up.', ui.ButtonSet.OK);
    }
  } catch (e) {
    ui.alert('Test Error', 'An error occurred during testing: ' + e.toString(), ui.ButtonSet.OK);
  }
}

/**
 * Prompts for a date and runs morning poll setup for that custom date.
 */
function menuMorningJobCustomDate() {
  var ui = SpreadsheetApp.getUi();
  var prompt = ui.prompt('Custom Date Poll Setup', 'Enter date in YYYY-MM-DD format (e.g. 2026-06-12):', ui.ButtonSet.OK_CANCEL);
  if (prompt.getSelectedButton() !== ui.Button.OK) return;
  var dateStr = prompt.getResponseText().trim();
  
  var regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) {
    ui.alert('Invalid Format', 'Please enter the date in YYYY-MM-DD format.', ui.ButtonSet.OK);
    return;
  }
  
  ui.showModalDialog(HtmlService.createHtmlOutput('Fetching matches and sending polls for ' + dateStr + '... Please wait.'), 'Working');
  try {
    morningJob(dateStr);
    ui.alert('Success', 'Morning job for ' + dateStr + ' executed successfully.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Error', 'Execution failed: ' + e.toString(), ui.ButtonSet.OK);
  }
}

/**
 * Prompts for a date and runs deadline vote collection for that custom date.
 */
function menuDeadlineJobCustomDate() {
  var ui = SpreadsheetApp.getUi();
  var prompt = ui.prompt('Custom Date Poll Collection', 'Enter date in YYYY-MM-DD format (e.g. 2026-06-12):', ui.ButtonSet.OK_CANCEL);
  if (prompt.getSelectedButton() !== ui.Button.OK) return;
  var dateStr = prompt.getResponseText().trim();
  
  var regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) {
    ui.alert('Invalid Format', 'Please enter the date in YYYY-MM-DD format.', ui.ButtonSet.OK);
    return;
  }
  
  ui.showModalDialog(HtmlService.createHtmlOutput('Collecting votes and closing polls for ' + dateStr + '... Please wait.'), 'Working');
  try {
    deadlineJob(dateStr);
    ui.alert('Success', 'Deadline job for ' + dateStr + ' executed successfully.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Error', 'Execution failed: ' + e.toString(), ui.ButtonSet.OK);
  }
}
