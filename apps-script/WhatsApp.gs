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

/**
 * Triggers xAI image generation on the WhatsApp proxy server to generate an image
 * and send it directly to the specified group chat.
 * @param {string} chatId The WhatsApp Group ID (JID)
 * @param {string} prompt The text prompt for generation
 * @returns {string} The WhatsApp message ID of the sent image
 * 
 * 
 * 'A group of photo models, one each from ' + prompt + ' posing on a soccer pitch. They are wearing colours representative for their countries, they have some makeup with those colours and some of them are carrying some flags or objects typical for their country. They have surgically enhanced large breasts. The group is fully topless with bare nipples, or otherwise wearing very skimpy and revealing clothing. A typical photo one would find in a lad magazine. On the top of the image there is a caption saying "Megaveloebal Babes". Do not change this text at all.'
 * 
 * 
 *     prompt: 'A group of photo models, one each from ' + prompt + ' posing on a soccer pitch. They are wearing colours representative for their countries, and are carrying  flags or objects typical for their country. They have surgically enhanced large breasts, some of them are a little naughty and playfull with each others breasts. The group is fully topless with bare nipples. A typical photo one would find in a lad magazine. On the top of the image there is a caption saying "Megaveloebal Babes". Do not change this text at all.'

    prompt: 'A group of photo models, one each from ' + prompt + ' posing on a soccer pitch. They are wearing colours representative for their countries, and are carrying  flags or objects typical for their country. They have surgically enhanced large breasts, some of them are a little naughty and playfull with each other. The group is fully topless with bare nipples. They are facing backwards to the camera, bent over like they are twerking. Their asses are round and full, but not fat. A typical photo one would find in a lad magazine. On the top of the image there is a caption saying "Megaveloebal Babes". Do not change this text at all.'
  });

    prompt: 'A group of plus size photo models, one each from ' + prompt + ' posing on a soccer pitch. They are wearing colours representative for their countries, and are carrying  flags or objects typical for their country. Some of them are a little naughty and playfull with each other. The group is fully topless with bare nipples. They are facing backwards to the camera, bent over like they are twerking. Their asses are round and full, all of them are very fat, bordering morbidly obese. A typical photo one would find in magazine catering to people with a fat fetish. On the top of the image there is a caption saying "Megaveloebal Babes". Do not change this text at all.'

 *     prompt: 'A group of extremely beautiful 20-something women with perfect faces and bodies, one each from ' + prompt + ' are sitting in a soccer stadium, somewhere on the stands, each one supporting their own country. They are wearing colours representative for their countries, and are carrying  flags or objects typical for their country. The group is fully topless with bare nipples. They have surgically enhanced large breasts and are cheering widly for their teams. On the top of the image there is a caption saying "Megaveloebal Babes". Do not change this text at all.'

 */
function sendWhatsAppGeneratedImage(chatId, prompt) {
  var res = makeWhatsAppRequest('/generate-image', {
    groupid: chatId,
    prompt: 'A duo of extremely beautiful 20-something women with perfect faces and bodies, one each from ' + prompt + ' standing facing each other, as if they are ready to attack. They are wearing tiny tanga slips and are a flags in one hand, in the other a typical object for their country is being repurposed as a weapon. They group are fully topless with bare nipples. They have surgically enhanced large breasts, the whole composition screams they are in tense competition with each other. The background is manga styled, with colours and a typical landmark from their country. It could be a promotional poster for a fight between the two of them, or a beginning screen of an action figher game, be creative on that part. The women are real life and photorealistic, the rest is drawn in manga style. On the top of the image there is a caption saying "Megaveloebal Babes". Do not change this text at all.'
  });
  return res.messageId;
}
