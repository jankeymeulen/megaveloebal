require('dotenv').config();
const express = require('express');
const { Client, LocalAuth, Poll, MessageMedia } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;
const apiToken = process.env.WHATSAPP_API_TOKEN;

if (!apiToken) {
  console.warn("WARNING: WHATSAPP_API_TOKEN is not defined in environment variables. Server will run without authentication!");
}

app.use(express.json());

// Auth middleware
const authenticate = (req, res, next) => {
  if (!apiToken) {
    return next();
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid authorization header' });
  }
  const token = authHeader.substring(7);
  if (token !== apiToken) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
  next();
};

let qrCodeData = null;
let clientStatus = 'DISCONNECTED'; // DISCONNECTED, WAITING_FOR_QR, CONNECTED

const puppeteerOptions = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu'
  ]
};

if (process.env.PUPPETEER_EXECUTABLE_PATH) {
  puppeteerOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './.wwebjs_auth'
  }),
  puppeteer: puppeteerOptions
});

client.on('qr', (qr) => {
  console.log('QR RECEIVED. Scan the QR code below:');
  qrcodeTerminal.generate(qr, { small: true });
  qrCodeData = qr;
  clientStatus = 'WAITING_FOR_QR';
});

client.on('ready', () => {
  console.log('WhatsApp Client is ready!');
  qrCodeData = null;
  clientStatus = 'CONNECTED';
});

client.on('authenticated', () => {
  console.log('WhatsApp Client is authenticated.');
});

client.on('auth_failure', (msg) => {
  console.error('AUTHENTICATION FAILURE:', msg);
  clientStatus = 'DISCONNECTED';
});

client.on('disconnected', (reason) => {
  console.log('Client was logged out. Reason:', reason);
  clientStatus = 'DISCONNECTED';
  qrCodeData = null;
  // Attempt re-init
  client.initialize();
});

// Start client
client.initialize().catch(err => {
  console.error("Failed to initialize WhatsApp client:", err);
});

// Endpoints

// Public endpoints (no auth needed for ease of pairing)
app.get('/status', (req, res) => {
  res.json({ status: clientStatus, hasQr: !!qrCodeData });
});

app.get('/qr', (req, res) => {
  if (clientStatus === 'CONNECTED') {
    return res.send('<h3>WhatsApp is already connected!</h3>');
  }
  if (!qrCodeData) {
    return res.send('<h3>Waiting for QR code... Please refresh in a moment.</h3>');
  }
  
  // Return a simple HTML page with QR code
  res.send(`
    <html>
      <head>
        <title>WhatsApp pairing</title>
        <script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"></script>
        <style>
          body { font-family: sans-serif; text-align: center; padding: 50px; background-color: #f7f9fa; color: #333; }
          #qrcode { margin: 30px auto; padding: 20px; background: white; display: inline-block; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .status { font-weight: bold; color: #075e54; }
        </style>
      </head>
      <body>
        <h2>Scan this QR code with your WhatsApp Link Device option</h2>
        <div id="qrcode"></div>
        <p>Status: <span class="status">${clientStatus}</span></p>
        <script>
          var qr = qrcode(4, 'L');
          qr.addData('${qrCodeData}');
          qr.make();
          document.getElementById('qrcode').innerHTML = qr.createImgTag(8);
        </script>
        <p>Refreshing status every 5 seconds...</p>
        <script>
          setInterval(() => {
            fetch('/status')
              .then(res => res.json())
              .then(data => {
                if (data.status === 'CONNECTED') {
                  window.location.reload();
                }
              });
          }, 5000);
        </script>
      </body>
    </html>
  `);
});

// Secured endpoints
app.post('/chats', authenticate, async (req, res) => {
  try {
    if (clientStatus !== 'CONNECTED') {
      return res.status(503).json({ error: 'WhatsApp client is not connected' });
    }
    const chats = await client.getChats();
    // Return recent 30 chats with their IDs and names
    const chatList = chats.slice(0, 50).map(chat => ({
      id: chat.id._serialized,
      name: chat.name,
      isGroup: chat.isGroup
    }));
    res.json({ chats: chatList });
  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/send-message', authenticate, async (req, res) => {
  const { chatId, text } = req.body;
  if (!chatId || !text) {
    return res.status(400).json({ error: 'Missing chatId or text' });
  }
  try {
    if (clientStatus !== 'CONNECTED') {
      return res.status(503).json({ error: 'WhatsApp client is not connected' });
    }
    const msg = await client.sendMessage(chatId, text);
    if (!msg || !msg.id || !msg.id._serialized) {
      console.warn("WARNING: client.sendMessage succeeded but returned an undefined or invalid message object. Generating fallback messageId.");
      const fallbackId = `fallback_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      return res.json({ messageId: fallbackId });
    }
    res.json({ messageId: msg.id._serialized });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/send-poll', authenticate, async (req, res) => {
  const { chatId, title, options } = req.body;
  if (!chatId || !title || !options || !Array.isArray(options)) {
    return res.status(400).json({ error: 'Missing or invalid chatId, title, or options' });
  }
  try {
    if (clientStatus !== 'CONNECTED') {
      return res.status(503).json({ error: 'WhatsApp client is not connected' });
    }
    // allowMultipleAnswers default is false (single answer)
    const poll = new Poll(title, options, { allowMultipleAnswers: false });
    const msg = await client.sendMessage(chatId, poll);
    if (!msg || !msg.id || !msg.id._serialized) {
      console.warn("WARNING: client.sendMessage for poll succeeded but returned an undefined or invalid message object. Generating fallback messageId.");
      const fallbackId = `fallback_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      return res.json({ messageId: fallbackId });
    }
    res.json({ messageId: msg.id._serialized });
  } catch (error) {
    console.error('Error sending poll:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/find-poll-id', authenticate, async (req, res) => {
  const { chatId, title, limit = 100 } = req.body;
  if (!chatId || !title) {
    return res.status(400).json({ error: 'Missing chatId or title' });
  }
  try {
    if (clientStatus !== 'CONNECTED') {
      return res.status(503).json({ error: 'WhatsApp client is not connected' });
    }
    // Fetch raw messages directly from the browser context to bypass getChatById
    const messages = await client.pupPage.evaluate((chatId, limit) => {
      const chat = window.Store.Chat.get(chatId);
      if (!chat) return null;
      const msgs = chat.msgs.getModelsArray() || [];
      return msgs.slice(-limit).map(m => ({
        id: m.id ? m.id._serialized : null,
        type: m.type,
        body: m.body,
        pollName: m.pollName,
        _data: {
          type: m.type,
          pollName: m.pollName
        }
      }));
    }, chatId, parseInt(limit, 10) || 100);

    if (!messages) {
      return res.status(404).json({ error: `Chat not found for JID: ${chatId}` });
    }

    let foundMsg = null;
    // Search from most recent to oldest
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const isPoll = msg.type === 'poll_creation' || msg.type === 'poll' || !!msg.pollName || (msg._data && (!!msg._data.pollName || msg._data.type === 'poll_creation'));
      if (isPoll) {
        const pollName = msg.pollName || (msg._data && msg._data.pollName) || msg.body || '';
        if (pollName.toLowerCase().includes(title.toLowerCase())) {
          foundMsg = msg;
          break;
        }
      }
    }
    
    if (foundMsg) {
      console.log(`Found poll message ID for "${title}": ${foundMsg.id}`);
      res.json({ success: true, messageId: foundMsg.id });
    } else {
      console.log(`Poll message for "${title}" not found in the last ${limit} messages.`);
      res.status(404).json({ error: `Poll message not found for title: ${title}` });
    }
  } catch (error) {
    console.error('Error finding poll ID:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/get-poll-votes', authenticate, async (req, res) => {
  const { chatId, messageId } = req.body;
  if (!chatId || !messageId) {
    return res.status(400).json({ error: 'Missing chatId or messageId' });
  }
  try {
    if (clientStatus !== 'CONNECTED') {
      return res.status(503).json({ error: 'WhatsApp client is not connected' });
    }
    // Fetch raw votes from browser context directly to bypass getMessageById
    const rawVotes = await client.pupPage.evaluate(async (messageId) => {
      const msg = window.Store.Msg.get(messageId);
      if (!msg) return null;
      const votes = await msg.getPollVotes();
      if (!votes) return [];
      return votes.map(v => ({
        voter: v.voter ? (typeof v.voter === 'object' ? v.voter._serialized : v.voter) : null,
        selectedOptions: v.selectedOptions ? v.selectedOptions.map(o => ({ name: o.name })) : []
      }));
    }, messageId);

    if (!rawVotes) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    // Format votes by resolving voter LID/JID to standard phone number JID
    const formattedVotes = await Promise.all(rawVotes
      .filter(v => v.selectedOptions && v.selectedOptions.length > 0)
      .map(async (v) => {
        const voterId = v.voter;
        try {
          const contact = await client.getContactById(voterId);
          return {
            voter: contact.id._serialized, // Resolves to standard phone@c.us JID
            selectedOptionName: v.selectedOptions[0].name
          };
        } catch (contactErr) {
          console.warn('Failed to resolve contact JID for ' + voterId + ':', contactErr.message);
          return {
            voter: voterId,
            selectedOptionName: v.selectedOptions[0].name
          };
        }
      })
    );
      
    res.json({ votes: formattedVotes });
  } catch (error) {
    console.error('Error getting poll votes:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/group-participants', authenticate, async (req, res) => {
  const { chatId } = req.body;
  if (!chatId) {
    return res.status(400).json({ error: 'Missing chatId' });
  }
  try {
    if (clientStatus !== 'CONNECTED') {
      return res.status(503).json({ error: 'WhatsApp client is not connected' });
    }
    // Fetch participants directly from browser context to bypass getChatById
    const participantIds = await client.pupPage.evaluate((chatId) => {
      const chat = window.Store.Chat.get(chatId);
      if (!chat) return null;
      if (!chat.isGroup) return [];
      const participants = chat.groupMetadata && chat.groupMetadata.participants 
        ? chat.groupMetadata.participants.getModelsArray() 
        : [];
      return participants.map(p => p.id ? p.id._serialized : p.id);
    }, chatId);

    if (participantIds === null) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    if (participantIds.length === 0) {
      return res.status(400).json({ error: 'Chat is not a group or has no participants' });
    }
    
    const list = await Promise.all(participantIds.map(async (jid) => {
      try {
        const contact = await client.getContactById(jid);
        return {
          name: contact.pushname || contact.name || jid.split('@')[0],
          whatsappId: contact.id._serialized
        };
      } catch (err) {
        return {
          name: jid.split('@')[0],
          whatsappId: jid
        };
      }
    }));
    
    res.json({ participants: list });
  } catch (error) {
    console.error('Error fetching group participants:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/delete-message', authenticate, async (req, res) => {
  const { chatId, messageId } = req.body;
  if (!chatId || !messageId) {
    return res.status(400).json({ error: 'Missing chatId or messageId' });
  }
  
  try {
    if (clientStatus !== 'CONNECTED') {
      return res.status(503).json({ error: 'WhatsApp client is not connected' });
    }
    
    // Execute deletion directly in the browser context to bypass getMessageById
    const deleteResult = await client.pupPage.evaluate(async (messageId) => {
      const msg = window.Store.Msg.get(messageId);
      if (!msg) return null;
      if (msg.type === 'revoked') return 'already_revoked';
      
      try {
        await msg.delete(true);
        return 'deleted';
      } catch (e) {
        await msg.delete(false);
        return 'deleted_local';
      }
    }, messageId);

    if (!deleteResult) {
      console.log(`Message not found (likely already deleted).`);
      return res.json({ success: true });
    }

    console.log(`Delete command completed with status: ${deleteResult} for message ${messageId}.`);
    res.json({ success: true });
    
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/generate-image', authenticate, async (req, res) => {
  const { prompt, groupid } = req.body;
  if (!prompt || !groupid) {
    return res.status(400).json({ error: 'Missing prompt or groupid' });
  }
  
  const provider = (process.env.IMAGE_PROVIDER || 'xai').toLowerCase();
  
  try {
    if (clientStatus !== 'CONNECTED') {
      return res.status(503).json({ error: 'WhatsApp client is not connected' });
    }

    if (typeof fetch !== 'function') {
      throw new Error('Native fetch is not available. Please upgrade to Node.js 18 or later.');
    }
    
    const maxAttempts = 3;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        let imageUrl = '';
        console.log(`Attempt ${attempt} of ${maxAttempts} to generate and send image...`);
        
        if (provider === 'runware') {
          const apiKey = process.env.IMAGE_API_KEY || process.env.RUNWARE_API_KEY;
          if (!apiKey) {
            return res.status(500).json({ error: 'Runware API Key is not configured (set IMAGE_API_KEY or RUNWARE_API_KEY)' });
          }
          
          const model = process.env.IMAGE_MODEL || process.env.RUNWARE_MODEL || 'xai:grok-imagine@image-quality';
          const taskUUID = crypto.randomUUID();
          
          console.log(`Generating image via Runware for prompt: "${prompt}" using model "${model}" (safety check disabled)...`);
          const response = await fetch('https://api.runware.ai/v1', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify([
              {
                taskType: 'imageInference',
                model: model,
                positivePrompt: prompt,
                width: 1024,
                height: 1024,
                deliveryMethod: 'sync',
                taskUUID: taskUUID,
                checkNSFW: false
              }
            ])
          });
          
          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Runware API error (${response.status}): ${errText}`);
          }
          
          const result = await response.json();
          
          // If the response is an object with errors, or has an error array
          if (result.errors) {
            throw new Error(`Runware API returned errors: ${JSON.stringify(result.errors)}`);
          }
          
          let taskResult = null;
          if (Array.isArray(result) && result.length > 0) {
            taskResult = result[0];
          } else if (result.data && Array.isArray(result.data) && result.data.length > 0) {
            taskResult = result.data[0];
          }
          
          if (!taskResult) {
            throw new Error(`Runware API returned invalid response format: ${JSON.stringify(result)}`);
          }
          
          if (taskResult.error) {
            throw new Error(`Runware task error: ${taskResult.error}`);
          }
          
          if (taskResult.imageURL) {
            imageUrl = taskResult.imageURL;
          } else if (taskResult.images && taskResult.images.length > 0 && taskResult.images[0].imageURL) {
            imageUrl = taskResult.images[0].imageURL;
          } else {
            throw new Error(`Runware API did not return any image URL. Response: ${JSON.stringify(result)}`);
          }
          
        } else if (provider === 'xai') {
          const apiKey = process.env.IMAGE_API_KEY || process.env.XAI_API_KEY;
          if (!apiKey) {
            return res.status(500).json({ error: 'xAI API Key is not configured (set IMAGE_API_KEY or XAI_API_KEY)' });
          }
          
          const model = process.env.IMAGE_MODEL || process.env.XAI_MODEL || 'grok-imagine-image-quality';
          
          console.log(`Generating image via xAI for prompt: "${prompt}" using model "${model}"...`);
          const response = await fetch('https://api.x.ai/v1/images/generations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: model,
              prompt: prompt
            })
          });
          
          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`xAI API error (${response.status}): ${errText}`);
          }
          
          const result = await response.json();
          if (!result.data || result.data.length === 0 || !result.data[0].url) {
            throw new Error('xAI API did not return any image URL');
          }
          
          imageUrl = result.data[0].url;
        } else {
          return res.status(400).json({ error: `Unsupported image provider: ${provider}` });
        }
        
        console.log(`Image generated. Downloading from: ${imageUrl}`);
        
        // Download and serialize image using MessageMedia
        const media = await MessageMedia.fromUrl(imageUrl);
        
        console.log(`Sending image to JID: ${groupid}`);
        const msg = await client.sendMessage(groupid, media);
        
        const messageId = msg && msg.id && msg.id._serialized ? msg.id._serialized : `fallback_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        if (!msg || !msg.id || !msg.id._serialized) {
          console.warn("WARNING: client.sendMessage for media succeeded but returned an undefined or invalid message object. Generating fallback messageId.");
        }
        return res.json({ success: true, messageId: messageId });
      } catch (err) {
        console.error(`Attempt ${attempt} failed:`, err.message);
        lastError = err;
        if (attempt < maxAttempts) {
          // Wait 2 seconds before retrying
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
    
    throw new Error(`All ${maxAttempts} attempts to generate and send the image failed. Last error: ${lastError.message}`);
  } catch (error) {
    console.error('Error generating or sending image:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Graceful shutdown handler
const shutdown = async () => {
  console.log('Shutdown signal received. Closing WhatsApp client...');
  try {
    await client.destroy();
    console.log('WhatsApp client destroyed.');
  } catch (err) {
    console.error('Error destroying client:', err);
  }
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
