'use strict'
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
      // טיפול בלחיצות על כפתורים
      else if (req.body.entry[0].changes[0].value.messages[0].interactive) {
        const interactive = req.body.entry[0].changes[0].value.messages[0].interactive;
        console.log("📌 Interactive Message Received:", interactive);
        
        let buttonPayload;
        
        if (interactive.type === 'button_reply') {
          buttonPayload = interactive.button_reply.title;
        } else if (interactive.type === 'list_reply') {
          buttonPayload = interactive.list_reply.title;
        }
        
        if (buttonPayload) {
          console.log("📌 Button Clicked:", buttonPayload);
          await interact(user_id, {
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

    // תהליך שליחת הודעות חדש שמטפל ברקורסיביות ב"קפיצות" בפלו
    await processAndSendMessages(response.data, phone_number_id, user_id);
  } catch (error) {
    console.error("❌ Error in interact function:", error);
  }
}

// פונקציה חדשה לטיפול בתגובות מVoiceflow כולל קפיצות בפלו
async function processAndSendMessages(messages, phone_number_id, user_id) {
  try {
    const messagesToSend = [];
    const pathsToFollow = [];
    
    // הפרדה בין הודעות רגילות לפקודות מסוג "path"
    for (const message of messages) {
      if (message.type === 'path') {
        pathsToFollow.push(message);
      } else {
        messagesToSend.push(message);
      }
    }
    
    // שליחת הודעות רגילות
    if (messagesToSend.length > 0) {
      await sendMessage(messagesToSend, phone_number_id, user_id);
    }
    
    // טיפול בפקודות מסוג "path" - המשך הפלו
    for (const pathMessage of pathsToFollow) {
      if (pathMessage.payload?.path === 'jump') {
        console.log("🔄 Following path 'jump' in the flow");
        await followPath(user_id, pathMessage.payload.path, phone_number_id);
      } else if (pathMessage.payload?.path) {
        console.log(`🔄 Following path '${pathMessage.payload.path}' in the flow`);
        await followPath(user_id, pathMessage.payload.path, phone_number_id);
      }
    }
  } catch (error) {
    console.error("❌ Error in processAndSendMessages:", error);
  }
}

// פונקציה חדשה למעקב אחרי קפיצות בפלו
async function followPath(user_id, path, phone_number_id) {
  try {
    // שליחת בקשה לצעד הנוכחי בפלו
    const response = await axios({
      method: 'POST',
      url: `https://general-runtime.voiceflow.com/state/user/${encodeURI(user_id)}/interact`,
      headers: {
        Authorization: VF_API_KEY,
        'Content-Type': 'application/json',
        versionID: VF_VERSION_ID,
      },
      data: {
        action: {
          type: 'path',
          payload: {
            path: path
          }
        }
      },
    });
    
    console.log(`📌 Response from Voiceflow after following path '${path}':`, JSON.stringify(response.data, null, 2));
    
    if (response.data && response.data.length > 0) {
      // קריאה רקורסיבית לטיפול בהודעות הבאות
      await processAndSendMessages(response.data, phone_number_id, user_id);
    }
  } catch (error) {
    console.error(`❌ Error following path '${path}':`, error);
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
                  id: button.name || button.title || `button_${index}`,
                  title: button.name || button.title || "אפשרות",
                }
              }))
            }
          }
        };
      } 
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
                let buttonTitle = "";
                
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
        console.log(`ℹ️ Ignoring unsupported message type: ${messages[j].type}`);
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
