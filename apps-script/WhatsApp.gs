/**
 * WhatsApp.gs - API wrapper for communicating with the Node.js WhatsApp proxy server.
 */

/**
 * Helper to make HTTP POST requests to the WhatsApp proxy server.
 */
function makeWhatsAppRequest(endpoint, payload) {
  var serverUrl = getConfig('WHATSAPP_SERVER_URL');
  var apiToken = getConfig('WHATSAPP_API_TOKEN');

  if (!serverUrl) {
    throw new Error('WHATSAPP_SERVER_URL is not configured in the Config sheet.');
  }

  // Ensure url does not end with /
  var baseUrl = serverUrl.toString().trim().replace(/\/$/, '');
  var url = baseUrl + endpoint;

  var headers = {};
  if (apiToken) {
    headers['Authorization'] = 'Bearer ' + apiToken;
  }

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response;
  var attempts = 4;
  var delays = [10000, 30000, 60000];
  for (var i = 0; i < attempts; i++) {
    try {
      response = UrlFetchApp.fetch(url, options);
      break; // Success, break loop
    } catch (e) {
      if (i === attempts - 1) {
        throw new Error('Failed to reach WhatsApp Server after ' + attempts + ' attempts: ' + e.toString());
      }
      var delayMs = delays[i];
      Logger.log('WhatsApp Server API attempt ' + (i + 1) + ' failed: ' + e.toString() + '. Retrying in ' + (delayMs / 1000) + ' seconds...');
      Utilities.sleep(delayMs);
    }
  }

  var statusCode = response.getResponseCode();
  var content = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error('WhatsApp Server API error (' + statusCode + '): ' + content);
  }

  return JSON.parse(content);
}

/**
 * Sends a single-choice poll to a WhatsApp chat.
 * @param {string} chatId The WhatsApp Group ID (JID)
 * @param {string} title The poll title
 * @param {Array<string>} options List of poll options
 * @returns {string} The created poll message ID
 */
function sendWhatsAppPoll(chatId, title, options) {
  var res = makeWhatsAppRequest('/send-poll', {
    chatId: chatId,
    title: title,
    options: options
  });
  return res.messageId;
}

/**
 * Retrieves the votes cast on a poll message.
 * @param {string} chatId The WhatsApp Group ID (JID)
 * @param {string} messageId The poll message ID
 * @returns {Array<Object>} List of votes: [{ voter: string, selectedOptionName: string }]
 */
function fetchPollVotes(chatId, messageId) {
  var res = makeWhatsAppRequest('/get-poll-votes', {
    chatId: chatId,
    messageId: messageId
  });
  return res.votes || [];
}

/**
 * Deletes a WhatsApp message for everyone.
 * @param {string} chatId The WhatsApp Group ID (JID)
 * @param {string} messageId The message ID to delete
 */
function deleteWhatsAppMessage(chatId, messageId) {
  makeWhatsAppRequest('/delete-message', {
    chatId: chatId,
    messageId: messageId
  });
}

/**
 * Sends a normal text message to a WhatsApp chat.
 * @param {string} chatId The WhatsApp Group ID (JID)
 * @param {string} text The text to send
 * @returns {string} The created message ID
 */
function sendWhatsAppMessage(chatId, text) {
  var res = makeWhatsAppRequest('/send-message', {
    chatId: chatId,
    text: text
  });
  return res.messageId;
}

/**
 * Fetches all participants from a group chat.
 * @param {string} chatId Group JID
 * @returns {Array<Object>} [{ name: string, whatsappId: string }]
 */
function fetchGroupParticipants(chatId) {
  var res = makeWhatsAppRequest('/group-participants', {
    chatId: chatId
  });
  return res.participants || [];
}
