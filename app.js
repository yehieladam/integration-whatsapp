'use strict'
require('dotenv').config()
const WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || 'v17.0'
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN

const VF_API_KEY = process.env.VF_API_KEY
const VF_VERSION_ID = process.env.VF_VERSION_ID || 'development'
const VF_PROJECT_ID = process.env.VF_PROJECT_ID || null
const VF_DM_URL = process.env.VF_DM_URL || 'https://general-runtime.voiceflow.com'
const VF_TRANSCRIPT_ICON = 'https://s3.amazonaws.com/com.voiceflow.studio/share/200x200/200x200.png'
const DMconfig = { tts: false, stripSSML: true }

const PICOVOICE_API_KEY = process.env.PICOVOICE_API_KEY || null

const fs = require('fs')
let session = null
let noreplyTimeout = null

// טעינת מודול Leopard לעיבוד אודיו אם קיים מפתח
let Leopard, LeopardActivationLimitReached
if (PICOVOICE_API_KEY) {
  try {
    ({ Leopard, LeopardActivationLimitReached } = require('@picovoice/leopard-node'))
  } catch (error) {
    console.error("❌ לא ניתן לטעון את מודול Leopard:", error)
  }
}

const express = require('express'),
  body_parser = require('body-parser'),
  axios = require('axios').default,
  app = express().use(body_parser.json())

app.listen(process.env.PORT || 3000, () => console.log('webhook is listening'))

// בדיקת סטטוס בסיסית
app.get('/', (req, res) => {
  res.json({
    success: true,
    info: 'WhatsApp API Combined | V⦿iceflow | 2023',
    status: 'healthy',
    error: null,
  })
})

// ניהול הפוסט שמגיע מ־webhook
app.post('/webhook', async (req, res) => {
  let body = req.body
  if (body.object) {
    const entry = body.entry && body.entry[0]
    const changes = entry && entry.changes && entry.changes[0]
    const value = changes && changes.value
    const messages = value && value.messages
    if (messages && messages.length > 0) {
      let phone_number_id = value.metadata.phone_number_id
      let user_id = messages[0].from
      let user_name = (value.contacts && value.contacts[0] && value.contacts[0].profile && value.contacts[0].profile.name) || 'Unknown'
      
      // טיפול בהודעות טקסט
      if (messages[0].text) {
        await interact(user_id, {
          type: 'text',
          payload: messages[0].text.body,
        }, phone_number_id, user_name)
      } 
      // טיפול בהודעות אודיו עם Picovoice (אם מוגדר)
      else if (messages[0].audio) {
        if (messages[0].audio.voice === true && PICOVOICE_API_KEY && Leopard) {
          try {
            let mediaURLResponse = await axios({
              method: 'GET',
              url: `https://graph.facebook.com/${WHATSAPP_VERSION}/${messages[0].audio.id}`,
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + WHATSAPP_TOKEN,
              },
            })
            const mediaURL = mediaURLResponse.data.url
            const rndFileName = 'audio_' + Math.random().toString(36).substring(7) + '.ogg'
            axios({
              method: 'get',
              url: mediaURL,
              headers: {
                Authorization: 'Bearer ' + WHATSAPP_TOKEN,
              },
              responseType: 'stream',
            }).then(function (response) {
              let engineInstance = new Leopard(PICOVOICE_API_KEY)
              const wstream = fs.createWriteStream(rndFileName)
              response.data.pipe(wstream)
              wstream.on('finish', async () => {
                console.log('Analysing Audio file')
                const { transcript } = engineInstance.processFile(rndFileName)
                engineInstance.release()
                fs.unlinkSync(rndFileName)
                if (transcript && transcript !== '') {
                  console.log('User audio transcript:', transcript)
                  await interact(user_id, {
                    type: 'text',
                    payload: transcript,
                  }, phone_number_id, user_name)
                }
              })
            })
          } catch (error) {
            console.error("❌ Error processing audio:", error)
          }
        }
      } 
      // טיפול בהודעות אינטראקטיביות (כפתורים / רשימות)
      else if (messages[0].interactive) {
        const interactive = messages[0].interactive
        console.log("📌 Interactive Message Received:", interactive)
        // טיפול בכפתור (button_reply)
        if (interactive.button_reply) {
          if (interactive.button_reply.id && interactive.button_reply.id.includes('path-')) {
            await interact(user_id, {
              type: interactive.button_reply.id,
              payload: { label: interactive.button_reply.title },
            }, phone_number_id, user_name)
          } else {
            await interact(user_id, {
              type: 'intent',
              payload: {
                query: interactive.button_reply.title,
                intent: { name: interactive.button_reply.id },
                entities: [],
              },
            }, phone_number_id, user_name)
          }
        } 
        // טיפול ברשימת בחירה (list_reply)
        else if (interactive.list_reply) {
          if (interactive.list_reply.id && interactive.list_reply.id.includes('path-')) {
            await interact(user_id, {
              type: interactive.list_reply.id,
              payload: { label: interactive.list_reply.title },
            }, phone_number_id, user_name)
          } else {
            await interact(user_id, {
              type: 'intent',
              payload: {
                query: interactive.list_reply.title,
                intent: { name: interactive.list_reply.id },
                entities: [],
              },
            }, phone_number_id, user_name)
          }
        }
      }
    }
    res.status(200).json({ message: 'ok' })
  } else {
    res.status(400).json({ message: 'error | unexpected body' })
  }
})

// Endpoint לאימות ה־webhook
app.get('/webhook', (req, res) => {
  let mode = req.query['hub.mode']
  let token = req.query['hub.verify_token']
  let challenge = req.query['hub.challenge']
  if (mode && token) {
    if ((mode === 'subscribe' && token === process.env.VERIFY_TOKEN) || token === 'voiceflow') {
      console.log('WEBHOOK_VERIFIED')
      res.status(200).send(challenge)
    } else {
      res.sendStatus(403)
    }
  }
})

// פונקציית אינטראקציה עם Voiceflow – משלבת עדכון session וניהול המשתמש
async function interact(user_id, request, phone_number_id, user_name) {
  try {
    // במידה והמשתמש שולח "סיים שיחה" – מתבצע איפוס session
    if (typeof request.payload === 'string' && request.payload.toLowerCase() === "סיים שיחה") {
      console.log("🔄 Resetting session for", user_id);
      await axios({
        method: 'PATCH',
        url: `${VF_DM_URL}/state/user/${encodeURI(user_id)}/variables`,
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

    // אתחול session אם אין עדיין
    if (!session) {
      session = `${VF_VERSION_ID}.${rndID()}`
    }
    // עדכון פרטי המשתמש ב־Voiceflow
    await axios({
      method: 'PATCH',
      url: `${VF_DM_URL}/state/user/${encodeURI(user_id)}/variables`,
      headers: {
        Authorization: VF_API_KEY,
        'Content-Type': 'application/json',
      },
      data: {
        user_id: user_id,
        user_name: user_name,
      },
    });

    let response = await axios({
      method: 'POST',
      url: `${VF_DM_URL}/state/user/${encodeURI(user_id)}/interact`,
      headers: {
        Authorization: VF_API_KEY,
        'Content-Type': 'application/json',
        versionID: VF_VERSION_ID,
        sessionID: session,
      },
      data: {
        action: request,
        config: {
          sessionID: (typeof request.payload === 'string' && request.payload.toLowerCase() === "סיים שיחה")
            ? `${user_id}-${Date.now()}`
            : user_id,
          restart: (typeof request.payload === 'string' && request.payload.toLowerCase() === "סיים שיחה")
        }
      },
    });
    console.log("📌 Response from Voiceflow:", JSON.stringify(response.data, null, 2));

    if (!response.data || response.data.length === 0) {
      console.error("❌ No response received from Voiceflow");
      return;
    }

    // בדיקה אם אחד מההודעות מהסרו את השיחה, ואז שמירת תמליל (Transcript)
    const isEnding = response.data.some(msg => msg.type === 'end');
    if (isEnding) {
      console.log('Conversation ending. Saving transcript...');
      saveTranscript(user_name);
      session = null;
    }

    // שליחת ההודעות למשתמש – משתמשים בפונקציה מהקוד הראשון כדי להבטיח שהטקסט יועבר במלואו
    await sendMessage(response.data, phone_number_id, user_id);
  } catch (error) {
    console.error("❌ Error in interact function:", error);
  }
}

// פונקציה לשיגור הודעות WhatsApp
async function sendMessage(messages, phone_number_id, from) {
  try {
    for (let j = 0; j < messages.length; j++) {
      let data;
      let ignore = false;

      if (messages[j].type === 'text' && messages[j].payload && messages[j].payload.message) {
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
      } else if (messages[j].type === 'buttons' && messages[j].payload && messages[j].payload.buttons) {
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
                  title: button.name || button.title || "אפשרות",
                }
              }))
            }
          }
        };
      } else if (messages[j].type === 'choice' && messages[j].payload && messages[j].payload.buttons) {
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
                const buttonId = (button.request && button.request.payload && button.request.payload.label) || (button.title || `choice_${index}`);
                let buttonTitle = (button.request && button.request.payload && button.request.payload.label) || (button.name || button.title || `אפשרות ${index+1}`);
                return {
                  type: 'reply',
                  reply: {
                    id: buttonId,
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
      if (!ignore && data) {
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
          console.error("❌ Error sending WhatsApp message:", err.response && err.response.data ? err.response.data : err);
        }
      }
    }
  } catch (error) {
    console.error("❌ Error in sendMessage function:", error);
  }
}

// פונקציה ליצירת מזהה ייחודי ל־session
function rndID() {
  var randomNo = Math.floor(Math.random() * 1000 + 1);
  var timestamp = Date.now();
  var date = new Date();
  var weekday = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var day = weekday[date.getDay()];
  return randomNo + day + timestamp;
}

// שמירת transcript בסיום השיחה
function saveTranscript(username) {
  if (VF_PROJECT_ID) {
    if (!username) {
      username = 'Anonymous';
    }
    axios({
      method: 'put',
      url: 'https://api.voiceflow.com/v2/transcripts',
      data: {
        browser: 'WhatsApp',
        device: 'desktop',
        os: 'server',
        sessionID: session,
        unread: true,
        versionID: VF_VERSION_ID,
        projectID: VF_PROJECT_ID,
        user: {
          name: username,
          image: VF_TRANSCRIPT_ICON,
        },
      },
      headers: {
        Authorization: VF_API_KEY,
      },
    })
    .then(function (response) {
      console.log('Transcript Saved!');
    })
    .catch((err) => console.log(err));
  }
  session = `${VF_VERSION_ID}.${rndID()}`;
}
