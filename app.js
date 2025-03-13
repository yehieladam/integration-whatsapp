'use strict'
require('dotenv').config()
const WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || 'v17.0'
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'voiceflow'

const VF_API_KEY = process.env.VF_API_KEY
const VF_VERSION_ID = process.env.VF_VERSION_ID || 'development'
const VF_PROJECT_ID = process.env.VF_PROJECT_ID || null

const fs = require('fs')
const express = require('express'),
  body_parser = require('body-parser'),
  axios = require('axios').default,
  app = express().use(body_parser.json())

// הגדרת timeout לכל בקשות axios
axios.defaults.timeout = 15000;

// מעקב אחר בקשות פעילות
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 10;
const requestQueue = [];

// בדיקת משתני סביבה חיוניים
function checkRequiredEnvVars() {
  const required = ['WHATSAPP_TOKEN', 'VF_API_KEY'];
  const missing = required.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('Please set these variables in your .env file or environment');
    process.exit(1);
  }
}

// טיפול בשגיאות לא מטופלות
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // השרת ימשיך לרוץ למרות השגיאה
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // השרת ימשיך לרוץ למרות השגיאה
});

// הפעלת השרת
app.listen(process.env.PORT || 3000, () => {
  console.log('WhatsApp-Voiceflow webhook is listening on port', process.env.PORT || 3000);
  checkRequiredEnvVars();
});

// נתיב הבית - בדיקת בריאות
app.get('/', (req, res) => {
  res.json({
    success: true,
    info: 'WhatsApp API v1.2.0 | V⦿iceflow | 2023',
    status: 'healthy',
    error: null,
  })
})

// נתיב webhook לקבלת הודעות
app.post('/webhook', async (req, res) => {
  // החזרת תשובה מיידית למניעת timeout
  res.status(200).json({ message: 'ok' });
  
  try {
    let body = req.body;
    
    if (!body.object) {
      console.error('❌ Invalid webhook request: missing object property');
      return;
    }
    
    const changes = body?.entry?.[0]?.changes?.[0];
    const value = changes?.value;
    const isNotInteractive = value?.messages?.length || null;
    
    if (!isNotInteractive) {
      console.log('📌 Ignoring non-message webhook event');
      return;
    }
    
    const phone_number_id = value?.metadata?.phone_number_id;
    const message = value?.messages?.[0];
    const user_id = message?.from;
    const user_name = value?.contacts?.[0]?.profile?.name || 'Unknown';
    
    if (!phone_number_id || !user_id || !message) {
      console.error('❌ Missing required message properties');
      return;
    }
    
    console.log("📌 User ID (Phone Number):", user_id);
    console.log("📌 User Name:", user_name);
    
    if (message.text) {
      // הוספה לתור הבקשות
      addToRequestQueue({
        type: 'text',
        payload: message.text.body,
        user_id,
        phone_number_id,
        user_name
      });
    } else if (message.image || message.audio || message.video) {
      // טיפול בסוגי הודעות נוספים
      const mediaType = message.image ? 'image' : message.audio ? 'audio' : 'video';
      console.log(`📌 Received ${mediaType} message, sending text-only response`);
      
      addToRequestQueue({
        type: 'media',
        payload: `Received ${mediaType}`,
        user_id,
        phone_number_id,
        user_name
      });
    }
    
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
  }
})

// נתיב אימות webhook
app.get('/webhook', (req, res) => {
  let mode = req.query['hub.mode']
  let token = req.query['hub.verify_token']
  let challenge = req.query['hub.challenge']

  if (mode && token) {
    if ((mode === 'subscribe' && token === VERIFY_TOKEN)) {
      console.log('WEBHOOK_VERIFIED')
      res.status(200).send(challenge)
    } else {
      console.error('❌ Failed webhook verification');
      res.sendStatus(403)
    }
  } else {
    console.error('❌ Invalid verification request');
    res.sendStatus(400)
  }
})

// ניהול תור בקשות
function addToRequestQueue(requestData) {
  requestQueue.push(requestData);
  processQueue();
}

async function processQueue() {
  if (requestQueue.length === 0 || activeRequests >= MAX_CONCURRENT_REQUESTS) {
    return;
  }
  
  const { type, payload, user_id, phone_number_id, user_name } = requestQueue.shift();
  activeRequests++;
  
  try {
    if (type === 'text') {
      await interact(user_id, { type: 'text', payload }, phone_number_id, user_name);
    } else if (type === 'media') {
      // שליחת תשובה להודעות מדיה
      const mediaResponse = [{
        type: 'text',
        payload: {
          message: "קיבלתי את המדיה ששלחת. אני יכול לענות רק על הודעות טקסט כרגע."
        }
      }];
      await sendMessage(mediaResponse, phone_number_id, user_id);
    }
  } catch (error) {
    console.error('❌ Error processing queued request:', error);
  } finally {
    activeRequests--;
    // המשך עיבוד התור
    setTimeout(processQueue, 100);
  }
}

// פונקציית אינטראקציה עם Voiceflow
async function interact(user_id, request, phone_number_id, user_name) {
  try {
    console.log("🔄 Sending interaction to Voiceflow", user_name, user_id);
    
    // וידוא שה-user_id בטוח לשימוש בכתובת URL
    const safeUserId = encodeURIComponent(user_id);
    
    let retries = 3;
    let delay = 1000;
    let response;
    
    while (retries > 0) {
      try {
        response = await axios({
          method: 'POST',
          url: `https://general-runtime.voiceflow.com/state/user/${safeUserId}/interact`,
          headers: {
            Authorization: VF_API_KEY,
            'Content-Type': 'application/json',
            versionID: VF_VERSION_ID,
            ...(VF_PROJECT_ID ? { projectID: VF_PROJECT_ID } : {})
          },
          data: {
            action: request,
            config: {
              tts: false,
              stripSSML: true,
              stopAll: true,
              excludeTypes: ['block', 'debug', 'flow', 'paths']
            }
          },
          timeout: 15000 // 15 שניות timeout
        });
        
        // בדיקת תקינות התשובה
        if (!response.data) {
          throw new Error("Empty response from Voiceflow");
        }
        
        break; // יציאה מהלולאה אם הבקשה הצליחה
        
      } catch (err) {
        retries--;
        if (retries === 0) {
          console.error("❌ Failed to interact with Voiceflow after multiple attempts:", err.response?.data || err.message);
          
          // שליחת הודעת שגיאה למשתמש
          const errorMessage = [{
            type: 'text',
            payload: {
              message: "מצטער, אני נתקל בבעיה טכנית כרגע. אנא נסה שוב מאוחר יותר."
            }
          }];
          
          await sendMessage(errorMessage, phone_number_id, user_id);
          return;
        } else {
          console.warn(`⚠️ Error interacting with Voiceflow. Retrying in ${delay/1000} seconds...`, err.response?.data || err.message);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2;
        }
      }
    }
    
    // בדיקה שיש תשובה עם תוכן תקין
    if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
      console.warn("⚠️ Invalid or empty response structure from Voiceflow");
      const fallbackMessage = [{
        type: 'text',
        payload: {
          message: "אני לא מצליח לעבד את הבקשה כרגע. אנא נסה שוב או נסח את הבקשה בצורה אחרת."
        }
      }];
      
      await sendMessage(fallbackMessage, phone_number_id, user_id);
      return;
    }
    
    console.log("📌 Response from Voiceflow:", JSON.stringify(response.data, null, 2));
    
    // שליחת ההודעות למשתמש
    await sendMessage(response.data, phone_number_id, user_id);
    
  } catch (error) {
    console.error("❌ General error in interact function:", error);
    
    // שליחת הודעת שגיאה כללית למשתמש
    try {
      const systemErrorMessage = [{
        type: 'text',
        payload: {
          message: "אירעה שגיאה בעיבוד הבקשה שלך. צוות התמיכה שלנו עובד על זה."
        }
      }];
      
      await sendMessage(systemErrorMessage, phone_number_id, user_id);
    } catch (sendError) {
      console.error("❌ Failed to send error message to user:", sendError);
    }
  }
}

// פונקציית שליחת הודעות ל-WhatsApp
async function sendMessage(messages, phone_number_id, from) {
  try {
    if (!Array.isArray(messages)) {
      console.error("❌ Invalid messages format, expected array:", messages);
      return;
    }
    
    for (let j = 0; j < messages.length; j++) {
      let data;
      let ignore = false;
      const message = messages[j];
      
      // טיפול בסוגי הודעות שונים
      if (message.type === 'text' && message.payload?.message) {
        data = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: from,
          type: 'text',
          text: {
            preview_url: true,
            body: message.payload.message,
          },
        };
      } else if (message.type === 'image' && message.payload?.url) {
        data = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: from,
          type: 'image',
          image: {
            link: message.payload.url
          }
        };
      } else if (message.type === 'choice' && Array.isArray(message.payload?.buttons)) {
        // המרת אפשרויות בחירה לטקסט רגיל
        const buttonOptions = message.payload.buttons
          .map((btn, index) => `${index + 1}. ${btn.name}`)
          .join('\n');
          
        data = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: from,
          type: 'text',
          text: {
            preview_url: false,
            body: `${message.payload.message || 'בחר אפשרות:'}\n\n${buttonOptions}`
          }
        };
      } else if (message.type === 'end') {
        // מתעלמים מהודעות סיום - אלו הודעות פנימיות של Voiceflow שלא צריך לשלוח למשתמש
        console.log("📌 Ignoring 'end' message from Voiceflow");
        ignore = true;
      } else if (!message.type || !message.payload) {
        // מתעלמים מהודעות ללא סוג או תוכן
        console.warn("⚠️ Message missing type or payload, ignoring:", JSON.stringify(message));
        ignore = true;
      } else {
        // מתעלמים מסוגי הודעות לא נתמכים
        console.warn(`⚠️ Unsupported message type: ${message.type}, ignoring`);
        ignore = true;
      }

      // שליחת ההודעה אם היא לא התעלמות
      if (!ignore && data) {
        try {
          // שליחת ההודעה באמצעות WhatsApp API
          console.log(`📤 Sending ${message.type} message to ${from}`);
          
          const response = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/${WHATSAPP_VERSION}/${phone_number_id}/messages`,
            headers: {
              'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
              'Content-Type': 'application/json'
            },
            data: data,
            timeout: 10000 // 10 שניות timeout
          });
          
          // בדיקת הצלחה
