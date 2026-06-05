require('dotenv').config();
const express = require('express');
const { Client, LocalAuth, Poll } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');

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
    const msg = await client.getMessageById(messageId);
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }
    // Try to delete for everyone (revoking)
    try {
      await msg.delete(true);
    } catch (deleteErr) {
      console.warn('Delete for everyone failed, attempting local deletion (delete for me):', deleteErr.message);
      // Fallback: delete only for me (necessary in self-chats)
      await msg.delete(false);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting message:', error);
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
