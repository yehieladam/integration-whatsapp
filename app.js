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
  require('dotenv').config()
  const WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || 'v17.0'
  const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN
  
  const VF_API_KEY = process.env.VF_API_KEY
  const VF_VERSION_ID = process.env.VF_VERSION_ID || 'development'
  const VF_PROJECT_ID = process.env.VF_PROJECT_ID || null
  
  const fs = require('fs')
  const express = require('express'),
    body_parser = require('body-parser'),
    axios = require('axios').default,
    app = express().use(body_parser.json())
  
  app.listen(process.env.PORT || 3000, () => console.log('webhook is listening'))
  
  app.get('/', (req, res) => {
    res.json({
      success: true,
      info: 'WhatsApp API v1.1.2 | V⦿iceflow | 2023',
      status: 'healthy',
      error: null,
    })
  })
  
  app.post('/webhook', async (req, res) => {
    let body = req.body
    if (req.body.object) {
      const isNotInteractive = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.length || null
      if (isNotInteractive) {
        let phone_number_id = req.body.entry[0].changes[0].value.metadata.phone_number_id
        let user_id = req.body.entry[0].changes[0].value.messages[0].from 
        let user_name = req.body.entry[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name || 'Unknown'
  
        console.log("📌 User ID (Phone Number):", user_id);
        console.log("📌 User Name:", user_name);
  
        // טיפול בהודעות טקסט
        if (req.body.entry[0].changes[0].value.messages[0].text) {
          await interact(user_id, {
            type: 'text',
            payload: req.body.entry[0].changes[0].value.messages[0].text.body,
          }, phone_number_id, user_name)
        } 
        // טיפול בלחיצות על כפתורים - זה החלק החסר
        // טיפול בלחיצות על כפתורים
        else if (req.body.entry[0].changes[0].value.messages[0].interactive) {
          const interactive = req.body.entry[0].changes[0].value.messages[0].interactive;
          console.log("📌 Interactive Message Received:", interactive);
  
          let buttonPayload;
          let buttonAction = "button";
          
          if (interactive.type === 'button_reply') {
            buttonPayload = interactive.button_reply.id;
            buttonPayload = interactive.button_reply.title; // שינוי: השתמש בטקסט של הכפתור במקום ב-ID
          } else if (interactive.type === 'list_reply') {
            buttonPayload = interactive.list_reply.id;
            buttonPayload = interactive.list_reply.title; // שינוי: השתמש בטקסט של הכפתור במקום ב-ID
          }
  
          if (buttonPayload) {
            console.log("📌 Button Clicked:", buttonPayload);
            // שליחת לחיצת הכפתור כהודעת טקסט רגילה לפי המלצת Voiceflow
            await interact(user_id, {
              type: 'button',
              type: 'text',
              payload: buttonPayload,
            }, phone_number_id, user_name);
          }
        }
      }
      res.status(200).json({ message: 'ok' })
    } else {
      res.status(400).json({ message: 'error | unexpected body' })
    }
  })
  
  app.get('/webhook', (req, res) => {
    let mode = req.query['hub.mode']
    let token = req.query['hub.verify_token']
    let challenge = req.query['hub.challenge']
  
    if (mode && token) {
      if ((mode === 'subscribe' && token === process.env.VERIFY_TOKEN) || 'voiceflow') {
        console.log('WEBHOOK_VERIFIED')
        res.status(200).send(challenge)
      } else {
        res.sendStatus(403)
      }
    }
  })
  
  async function interact(user_id, request, phone_number_id, user_name) {
    try {
      console.log("🔄 Sending interaction to Voiceflow", user_name, user_id)
      console.log("🔄 Request:", JSON.stringify(request));
  
      if (request.payload?.toLowerCase() === "סיים שיחה") {
        console.log("🔄 Resetting session for", user_id);
        await axios({
          method: 'PATCH',
          url: `https://general-runtime.voiceflow.com/state/user/${encodeURI(user_id)}/variables`,
          headers: {
            Authorization: VF_API_KEY,
            'Content-Type': 'application/json',
          },
          data: {
            user_id: user_id,
            restart: true,
            sessionID: `${user_id}-${Date.now()}`
          },
        });
      }
  
      let response = await axios({
        method: 'POST',
        url: `https://general-runtime.voiceflow.com/state/user/${encodeURI(user_id)}/interact`,
        headers: {
          Authorization: VF_API_KEY,
          'Content-Type': 'application/json',
          versionID: VF_VERSION_ID,
        },
        data: {
          action: request,
          config: {
            sessionID: request.payload?.toLowerCase() === "סיים שיחה" ? `${user_id}-${Date.now()}` : user_id,
            restart: request.payload?.toLowerCase() === "סיים שיחה"
          }
        },
      })
      console.log("📌 Response from Voiceflow:", JSON.stringify(response.data, null, 2));
  
      if (!response.data || response.data.length === 0) {
        console.error("❌ No response received from Voiceflow");
        return;
      }
  
      await sendMessage(response.data, phone_number_id, user_id);
    } catch (error) {
      console.error("❌ Error in interact function:", error);
    }
  }
  
  async function sendMessage(messages, phone_number_id, from) {
    try {
      for (let j = 0; j < messages.length; j++) {
        let data;
        let ignore = null;
  
        if (messages[j].type === 'text' && messages[j].payload?.message) {
          data = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: from,
            type: 'text',
            text: {
              preview_url: true,
              body: messages[j].payload.message,
            },
          };
        } 
        // טיפול בהודעות מסוג buttons - החלק הזה היה ריק
        // טיפול בהודעות מסוג buttons
        else if (messages[j].type === 'buttons' && messages[j].payload?.buttons) {
          data = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: from,
            type: 'interactive',
            interactive: {
              type: 'button',
              body: {
                text: messages[j].payload.message || "בחר אופציה:",
              },
              action: {
                buttons: messages[j].payload.buttons.map((button, index) => ({
                  type: 'reply',
                  reply: {
                    id: button.id || `button_${index}`,
                    id: button.name || button.title || `button_${index}`,
                    title: button.name || button.title || "אפשרות",
                  }
                }))
              }
            }
          };
        } 
        // תיקון הטיפול בהודעות מסוג choice - הסרת כפילויות והוספת id ייחודי
        // טיפול בהודעות מסוג choice
        else if (messages[j].type === 'choice' && messages[j].payload?.buttons) {
          data = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: from,
            type: 'interactive',
            interactive: {
              type: 'button',
              body: {
                text: messages[j].payload.message || "בחר אופציה:",
              },
              action: {
                buttons: messages[j].payload.buttons.map((button, index) => {
                  // שימוש ב-id ייחודי לכל כפתור
                  const buttonId = button.request?.payload?.label || button.title || `choice_${index}`;
                  // שינוי: שימוש בתכונת ה-payload.label או text של הכפתור
                  let buttonTitle = "";
                  
                  // ניסיון להשיג את הטקסט של הכפתור מכל מקום אפשרי
                  if (button.request?.payload?.label) {
                    buttonTitle = button.request.payload.label;
                  } else if (button.name) {
                    buttonTitle = button.name;
                  } else if (button.title) {
                    buttonTitle = button.title;
                  } else {
                    buttonTitle = `אפשרות ${index + 1}`;
                  }
                  
                  return {
                    type: 'reply',
                    reply: {
                      id: buttonId,
                      title: button.request?.payload?.label || button.title || "אפשרות",
                      id: buttonTitle,
                      title: buttonTitle,
                    }
                  };
                })
              }
            }
          };
        } else {
          ignore = true;
          console.error("❌ Unsupported message type or missing payload:", messages[j]);
        }
        if (!ignore) {
          console.log("📩 Sending WhatsApp message to:", from);
          console.log("📩 Message Data:", JSON.stringify(data, null, 2));
  
          try {
            let response = await axios({
              method: 'POST',
              url: `https://graph.facebook.com/${WHATSAPP_VERSION}/${phone_number_id}/messages`,
              data: data,
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + WHATSAPP_TOKEN,
              },
            });
            console.log("✅ WhatsApp API Response:", response.data);
          } catch (err) {
            console.error("❌ Error sending WhatsApp message:", err.response?.data || err);
          }
        }
      }
    } catch (error) {
      console.error("❌ Error in sendMessage function:", error);
    }
  }
