'use strict'
require('dotenv').config()
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

// הגדרות משתנים מהסביבה
const WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || 'v17.0';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VF_API_KEY = process.env.VF_API_KEY;
const VF_VERSION_ID = process.env.VF_VERSION_ID || 'development';
const VF_PROJECT_ID = process.env.VF_PROJECT_ID || null;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'voiceflow';

const app = express();
app.use(bodyParser.json());

// האזנה לשרת
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Webhook is listening on port ${PORT}`));

// בדיקת סטטוס
app.get('/', (req, res) => {
  res.json({
    success: true,
    info: 'WhatsApp API | Voiceflow Integration',
    status: 'healthy'
  });
});

// אימות הווב-הוק של ווטסאפ
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    console.log('✅ WEBHOOK_VERIFIED');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// טיפול בהודעות נכנסות מווטסאפ
app.post('/webhook', async (req, res) => {
  console.log("🔍 Incoming webhook payload:", JSON.stringify(req.body, null, 2));
  
  const body = req.body;
  if (!body.object) return res.status(400).json({ message: 'error | unexpected body' });
  
  try {
    const entry = body.entry?.[0]?.changes?.[0]?.value;
    if (!entry || !entry.messages) return res.status(200).send('No messages');

    const phoneNumberId = entry.metadata.phone_number_id;
    const userId = entry.messages[0].from;
    const userName = entry.contacts?.[0]?.profile?.name || 'Unknown';
    const messageType = entry.messages[0].type;
    console.log(`📩 New message from ${userName} (${userId}):`, entry.messages[0]);

    let request;
    if (messageType === 'text') {
      request = { type: 'text', payload: entry.messages[0].text.body };
    } else if (messageType === 'interactive') {
      const interactive = entry.messages[0].interactive;
      console.log("📌 Interactive Message Received:", interactive);
      
      let buttonId;
      let buttonTitle;
      
      if (interactive.type === 'button_reply') {
        buttonId = interactive.button_reply.id;
        buttonTitle = interactive.button_reply.title;
      } else if (interactive.type === 'list_reply') {
        buttonId = interactive.list_reply.id;
        buttonTitle = interactive.list_reply.title;
      }
      
      if (buttonId) {
        console.log("📌 Button Clicked:", buttonTitle);
        request = buttonId.startsWith('path-')
          ? { type: 'path', payload: { path: buttonId.replace('path-', '') } }
          : { type: 'intent', payload: { query: buttonTitle, intent: { name: buttonId }, entities: [] } };
      }
    }
    
    if (request) {
      console.log("🔄 Sending request to Voiceflow:", request);
      await interact(userId, request, phoneNumberId, userName);
    } else {
      console.log("⚠️ No valid request generated from message");
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.sendStatus(500);
  }
});

// שליחת הודעה ל-Voiceflow
async function interact(userId, request, phoneNumberId, userName) {
  try {
    console.log(`🔄 Sending interaction to Voiceflow for ${userName} (${userId})`, request);
    const response = await axios.post(
      `https://general-runtime.voiceflow.com/state/user/${encodeURIComponent(userId)}/interact`,
      { request: request },
      { headers: { Authorization: VF_API_KEY, 'Content-Type': 'application/json', versionID: VF_VERSION_ID, projectID: VF_PROJECT_ID } }
    );
    console.log("📌 Response from Voiceflow:", JSON.stringify(response.data, null, 2));

    if (response.data?.length) await sendMessage(response.data, phoneNumberId, userId);
  } catch (error) {
    console.error('❌ Error in interact function:', error.response?.data || error.message);
  }
}

// שליחת הודעה חזרה ל-WhatsApp
async function sendMessage(messages, phoneNumberId, userId) {
  for (let message of messages) {
    console.log("📤 Sending message to WhatsApp:", message);
    let textMessage = message.payload?.message || '⚠️ הודעה ריקה מהבוט';
    const data = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: userId,
      type: 'text',
      text: { preview_url: true, body: textMessage }
    };
    try {
      await axios.post(
        `https://graph.facebook.com/${WHATSAPP_VERSION}/${phoneNumberId}/messages`,
        data,
        { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
      );
    } catch (error) {
      console.error('❌ Error sending message:', error.response?.data || error.message);
    }
  }
}
