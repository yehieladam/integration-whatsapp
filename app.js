'use strict'
require('dotenv').config()

// הגדרת משתני סביבה ללא כפילויות
const WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || 'v17.0';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VF_API_KEY = process.env.VF_API_KEY;
const VF_VERSION_ID = process.env.VF_VERSION_ID || 'development';
const VF_PROJECT_ID = process.env.VF_PROJECT_ID || null;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'voiceflow';

const fs = require('fs');
const express = require('express'),
  body_parser = require('body-parser'),
  axios = require('axios').default,
  app = express().use(body_parser.json());

app.listen(process.env.PORT || 3000, () => console.log('✅ Webhook is listening'));

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
  if (!body.object) {
    console.error("❌ Invalid Webhook payload");
    return res.status(400).json({ message: 'error | unexpected body' });
  }
  
  try {
    const entry = body.entry?.[0]?.changes?.[0]?.value;
    if (!entry || !entry.messages) {
      console.warn("⚠️ No messages found in the webhook payload");
      return res.status(200).send('No messages');
    }

    const phoneNumberId = entry.metadata?.phone_number_id;
    const userId = entry.messages?.[0]?.from;
    const userName = entry.contacts?.[0]?.profile?.name || 'Unknown';
    const messageType = entry.messages?.[0]?.type;

    console.log(`📩 New message from ${userName} (${userId}):`, entry.messages?.[0]);
    if (!userId || !phoneNumberId) {
      console.error("❌ Missing userId or phoneNumberId");
      return res.status(400).send("Missing userId or phoneNumberId");
    }

    let request;
    if (messageType === 'text') {
      request = { type: 'text', payload: entry.messages[0].text.body || "" };
    } else if (messageType === 'interactive') {
      const interactive = entry.messages[0].interactive;
      console.log("📌 Interactive Message Received:", interactive);
      
      let buttonId = interactive?.button_reply?.id || interactive?.list_reply?.id || "";
      let buttonTitle = interactive?.button_reply?.title || interactive?.list_reply?.title || "";
      
      if (buttonId && buttonTitle) {
        console.log("📌 Button Clicked:", buttonTitle);
        if (buttonId.startsWith('path-')) {
          request = { type: 'path', payload: { path: buttonId.replace('path-', '') } };
        } else {
          request = { type: 'intent', payload: { query: buttonTitle, intent: { name: buttonId }, entities: [] } };
        }
      } else {
        console.error("❌ Error: Button ID or Title is missing");
      }
    }
    
    if (request) {
      console.log("🔄 Sending request to Voiceflow:", request);
      const response = await interact(userId, request, phoneNumberId, userName);
      if (response && response.length > 0) {
        console.log("📨 Sending response to WhatsApp");
        await sendMessage(response, phoneNumberId, userId);
      } else {
        console.warn("⚠️ Voiceflow returned an empty response - sending fallback message");
        await sendMessage([{ type: 'text', payload: { message: 'מצטערים, אבל לא התקבלה תשובה מהמערכת. אנא נסה שוב.' } }], phoneNumberId, userId);
      }
    } else {
      console.warn("⚠️ No valid request generated from message");
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.sendStatus(500);
  }
});
