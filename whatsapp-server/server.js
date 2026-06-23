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
  args: ['--no-sandbox', '--disable-setuid-sandbox']
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
    res.json({ messageId: msg.id._serialized });
  } catch (error) {
    console.error('Error sending poll:', error);
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
    const msg = await client.getMessageById(messageId);
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    const votes = await msg.getPollVotes();
    
    // Format votes by resolving voter LID/JID to standard phone number JID
    const formattedVotes = await Promise.all(votes
      .filter(v => v.selectedOptions && v.selectedOptions.length > 0)
      .map(async (v) => {
        const voterId = typeof v.voter === 'object' ? v.voter._serialized : v.voter;
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
    const chat = await client.getChatById(chatId);
    if (!chat.isGroup) {
      return res.status(400).json({ error: 'Chat is not a group' });
    }
    
    const participants = chat.participants || [];
    const list = await Promise.all(participants.map(async (p) => {
      try {
        const contact = await client.getContactById(p.id._serialized);
        return {
          name: contact.pushname || contact.name || p.id.user,
          whatsappId: contact.id._serialized
        };
      } catch (err) {
        return {
          name: p.id.user,
          whatsappId: p.id._serialized
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
    
    const maxAttempts = 3;
    let deletedSuccessfully = false;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`Attempt ${attempt} of ${maxAttempts} to delete message ${messageId}...`);
        
        let msg = null;
        try {
          msg = await client.getMessageById(messageId);
        } catch (fetchErr) {
          console.log(`Message not found or fetch failed (likely already deleted): ${fetchErr.message}`);
          deletedSuccessfully = true;
          break;
        }
        
        if (!msg) {
          console.log(`Message not found (likely already deleted).`);
          deletedSuccessfully = true;
          break;
        }
        
        if (msg.type === 'revoked') {
          console.log(`Message is already revoked (deleted for everyone).`);
          deletedSuccessfully = true;
          break;
        }
        
        // Try to delete for everyone (revoking)
        try {
          await msg.delete(true);
          console.log(`Sent delete command (delete for everyone) for message ${messageId}.`);
        } catch (deleteErr) {
          console.warn('Delete for everyone failed, attempting local deletion (delete for me):', deleteErr.message);
          // Fallback: delete only for me (necessary in self-chats)
          await msg.delete(false);
          deletedSuccessfully = true;
          break;
        }
        
        // Wait 1.5 seconds for the revocation state to propagate and sync
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Retrieve message again to verify revocation status
        let checkMsg = null;
        try {
          checkMsg = await client.getMessageById(messageId);
        } catch (checkErr) {
          console.log(`Fetch after deletion failed, message is likely deleted: ${checkErr.message}`);
          deletedSuccessfully = true;
          break;
        }
        
        if (!checkMsg || checkMsg.type === 'revoked') {
          console.log(`Verification confirmed: message ${messageId} is deleted.`);
          deletedSuccessfully = true;
          break;
        }
        
        console.warn(`Message ${messageId} still exists (type: ${checkMsg.type}). Retrying...`);
        
      } catch (err) {
        console.error(`Deletion attempt ${attempt} failed with error:`, err);
        lastError = err;
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
    
    if (deletedSuccessfully) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: `Failed to delete message after ${maxAttempts} attempts. Last error: ${lastError ? lastError.message : 'Unknown'}` });
    }
    
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
        
        return res.json({ success: true, messageId: msg.id._serialized });
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
