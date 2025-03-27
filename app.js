'use strict'
require('dotenv').config()

// ====================== הגדרות ומשתני סביבה ======================
const WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || 'v17.0'
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN

const VF_API_KEY = process.env.VF_API_KEY
const VF_VERSION_ID = process.env.VF_VERSION_ID || 'development'
const VF_PROJECT_ID = process.env.VF_PROJECT_ID || null
const VF_DM_URL = process.env.VF_DM_URL || 'https://general-runtime.voiceflow.com'
const VF_TRANSCRIPT_ICON = 'https://s3.amazonaws.com/com.voiceflow.studio/share/200x200/200x200.png'

// הגדרת קונפיג ל־Voiceflow
const DMconfig = {
  tts: false,
  stripSSML: true,
}

// (אופציונלי) Picovoice לעיבוד דיבור -> טקסט
const PICOVOICE_API_KEY = process.env.PICOVOICE_API_KEY || null
let Leopard, LeopardActivationLimitReached
if (PICOVOICE_API_KEY) {
  try {
    ({ Leopard, LeopardActivationLimitReached } = require('@picovoice/leopard-node'))
  } catch (error) {
    console.error("❌ לא ניתן לטעון את מודול Leopard:", error)
  }
}

const fs = require('fs')
const express = require('express')
const body_parser = require('body-parser')
const axios = require('axios').default

const app = express().use(body_parser.json())

// session ישמור מזהה ייחודי לכל משתמש
let session = null
let noreplyTimeout = null

// ====================== שרת בסיסי ======================
app.listen(process.env.PORT || 3000, () => console.log('webhook is listening'))

// בדיקת סטטוס
app.get('/', (req, res) => {
  res.json({
    success: true,
    info: 'WhatsApp API Combined Flow | V⦿iceflow | 2023',
    status: 'healthy',
    error: null,
  })
})

// ====================== Webhook Verification ======================
app.get('/webhook', (req, res) => {
  let mode = req.query['hub.mode']
  let token = req.query['hub.verify_token']
  let challenge = req.query['hub.challenge']
  
  if (mode && token) {
    // בדיקה אם ה־token תואם את מה שהגדרת ב־.env
    if ((mode === 'subscribe' && token === process.env.VERIFY_TOKEN) || token === 'voiceflow') {
      console.log('WEBHOOK_VERIFIED')
      return res.status(200).send(challenge)
    } else {
      return res.sendStatus(403)
    }
  }
})

// ====================== קבלת הודעות נכנסות ======================
app.post('/webhook', async (req, res) => {
  const body = req.body
  if (body.object) {
    const entry = body.entry && body.entry[0]
    const changes = entry && entry.changes && entry.changes[0]
    const value = changes && changes.value
    const messages = value && value.messages

    // אם באמת יש הודעה ב־messages
    if (messages && messages.length > 0) {
      let phone_number_id = value.metadata.phone_number_id
      let user_id = messages[0].from
      let user_name = (value.contacts && value.contacts[0] && value.contacts[0].profile && value.contacts[0].profile.name) || 'Unknown'
      
      // הודעת טקסט פשוטה
      if (messages[0].text) {
        // בדיקה אם המשתמש כתב "סיים שיחה" (כמו בקוד 1)
        if (messages[0].text.body.toLowerCase() === 'סיים שיחה') {
          console.log("🔄 Resetting session for", user_id)
          // איפוס ה־session ב־Voiceflow
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
              sessionID: `${user_id}-${Date.now()}`,
            },
          })
        }
        // קוראים ל־interact שינהל את ה־FLOW
        await interact(
          user_id,
          {
            type: 'text',
            payload: messages[0].text.body,
          },
          phone_number_id,
          user_name
        )
      } 
      // הודעת אודיו (כולל voice אם מוגדר Leopard)
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
                console.log('Analyzing Audio file')
                const { transcript } = engineInstance.processFile(rndFileName)
                engineInstance.release()
                fs.unlinkSync(rndFileName)
                if (transcript && transcript !== '') {
                  console.log('User audio transcript:', transcript)
                  await interact(
                    user_id,
                    {
                      type: 'text',
                      payload: transcript,
                    },
                    phone_number_id,
                    user_name
                  )
                }
              })
            })
          } catch (error) {
            console.error("❌ Error processing audio:", error)
          }
        }
      } 
      // הודעה אינטראקטיבית (כפתור / רשימה)
      else if (messages[0].interactive) {
        const interactive = messages[0].interactive
        // טיפול בכפתור
        if (interactive.button_reply) {
          const buttonId = interactive.button_reply.id
          const buttonTitle = interactive.button_reply.title
          console.log("📌 Button Clicked:", buttonId, buttonTitle)
          // אם ה־ID מכיל path- => שולחים כ־type ישירות
          if (buttonId.includes('path-')) {
            await interact(
              user_id,
              {
                type: buttonId,
                payload: { label: buttonTitle },
              },
              phone_number_id,
              user_name
            )
          } else {
            // אחרת שולחים כ-intent
            await interact(
              user_id,
              {
                type: 'intent',
                payload: {
                  query: buttonTitle,
                  intent: { name: buttonId },
                  entities: [],
                },
              },
              phone_number_id,
              user_name
            )
          }
        }
        // טיפול ברשימה
        else if (interactive.list_reply) {
          const listId = interactive.list_reply.id
          const listTitle = interactive.list_reply.title
          console.log("📌 List Item Selected:", listId, listTitle)
          if (listId.includes('path-')) {
            await interact(
              user_id,
              {
                type: listId,
                payload: { label: listTitle },
              },
              phone_number_id,
              user_name
            )
          } else {
            await interact(
              user_id,
              {
                type: 'intent',
                payload: {
                  query: listTitle,
                  intent: { name: listId },
                  entities: [],
                },
              },
              phone_number_id,
              user_name
            )
          }
        }
      }
    }
    res.status(200).json({ message: 'ok' })
  } else {
    // body לא צפוי
    res.status(400).json({ message: 'error | unexpected body' })
  }
})

// ====================== הפונקציה המרכזית ל־FLOW מול Voiceflow ======================
async function interact(user_id, request, phone_number_id, user_name) {
  try {
    clearTimeout(noreplyTimeout)

    // אם עדיין אין session – ניצור חדש
    if (!session) {
      session = `${VF_VERSION_ID}.${rndID()}`
    }

    // עדכון משתני Voiceflow (משתמש, שם וכד')
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
    })

    // שולחים את האקשן ל־Voiceflow
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
        config: DMconfig,
      },
    })

    let messagesFromVF = response.data
    if (!messagesFromVF || messagesFromVF.length === 0) {
      console.error("❌ No response received from Voiceflow")
      return
    }

    // בדיקה אם השיחה הסתיימה
    let isEnding = messagesFromVF.some(({ type }) => type === 'end')
    if (isEnding) {
      console.log('isEnding -> Saving transcript and clearing session.')
      saveTranscript(user_name)
      // איפוס ה־session
      session = null
    }

    // בניית מערך הודעות שנשלחות ל־WhatsApp (לפי מבנה code 2)
    let messages = []
    for (let i = 0; i < messagesFromVF.length; i++) {
      const msg = messagesFromVF[i]

      // 1) טקסט (Text) – מגיע כ־payload.slate או payload.message
      if (msg.type === 'text') {
        let tmpspeech = extractSlateText(msg.payload)
        // אם ההודעה הבאה היא choice – נשים את הטקסט כ־body (כדי שבחירת הכפתורים לא תאבד)
        if (messagesFromVF[i + 1]?.type === 'choice') {
          messages.push({
            type: 'body',
            value: tmpspeech,
          })
        } else {
          messages.push({
            type: 'text',
            value: tmpspeech,
          })
        }
      }
      // 2) speak – יכול להיות טקסט או אודיו
      else if (msg.type === 'speak') {
        if (msg.payload.type === 'audio') {
          messages.push({
            type: 'audio',
            value: msg.payload.src,
          })
        } else {
          // אותו רעיון – אם הבא choice, נשלח כ־body
          if (messagesFromVF[i + 1]?.type === 'choice') {
            messages.push({
              type: 'body',
              value: msg.payload.message,
            })
          } else {
            messages.push({
              type: 'text',
              value: msg.payload.message,
            })
          }
        }
      }
      // 3) תמונה (visual)
      else if (msg.type === 'visual') {
        if (msg.payload?.image) {
          messages.push({
            type: 'image',
            value: msg.payload.image,
          })
        }
      }
      // 4) choice – כפתורים
      else if (msg.type === 'choice') {
        let buttons = []
        for (let b = 0; b < msg.payload.buttons.length; b++) {
          let button = msg.payload.buttons[b]
          let link = null

          // אם יש actions -> ייתכן שזה לינק
          if (
            button.request.payload.actions &&
            button.request.payload.actions.length > 0
          ) {
            link = button.request.payload.actions[0].payload.url
          }

          // אם יש לינק – נתעלם (או נטפל אחרת)
       if (link) {
  messages.push({
    type: 'text',
    value: `${button.request.payload.label}: ${link}`,
  })
  continue
}
     
          else if (button.request.type.includes('path-')) {
            // כפתור path
            buttons.push({
              type: 'reply',
              reply: {
                id: button.request.type, // path-xxx
                title: truncateString(button.request.payload.label),
              },
            })
          } else {
            // כפתור intent
            buttons.push({
              type: 'reply',
              reply: {
                id: button.request.payload.intent.name,
                title: truncateString(button.request.payload.label),
              },
            })
          }
        }
        // לא ניתן לשלוח יותר מ־3 כפתורים ב־WhatsApp
        if (buttons.length > 3) {
          buttons = buttons.slice(0, 3)
        }

        messages.push({
          type: 'buttons',
          buttons: buttons,
        })
      }
      // 5) no-reply
      else if (msg.type === 'no-reply' && !isEnding) {
        // מפעיל טיימאאוט לשליחת no-reply
        noreplyTimeout = setTimeout(function () {
          sendNoReply(user_id, request, phone_number_id, user_name)
        }, Number(msg.payload.timeout) * 1000)
      }
    }

    // שליחת המערך השלם ל־WhatsApp
    await sendMessage(messages, phone_number_id, user_id)
  } catch (error) {
    console.error("❌ Error in interact function:", error)
  }
}

// ====================== שליחת הודעות ל־WhatsApp (ע"פ code 2, עם שיפורים) ======================
async function sendMessage(messages, phone_number_id, from) {
  const timeoutPerKB = 10 // הגדרת השהייה (מילישניות) לכל KB במקרה של שליחת תמונה גדולה

  for (let j = 0; j < messages.length; j++) {
    let data
    let ignore = false

    switch (messages[j].type) {
      // תמונה
      case 'image':
        data = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: from,
          type: 'image',
          image: {
            link: messages[j].value,
          },
        }
        break

      // אודיו
      case 'audio':
        data = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: from,
          type: 'audio',
          audio: {
            link: messages[j].value,
          },
        }
        break

      // כפתורים
      case 'buttons':
        data = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: from,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: {
              // אם לפניו היה 'body' – נשתמש בו, אחרת טקסט ברירת מחדל
              text: messages[j - 1]?.type === 'body'
                ? messages[j - 1].value || 'בחר אופציה:'
                : 'בחר אופציה:',
            },
            action: {
              buttons: messages[j].buttons,
            },
          },
        }
        break

      // טקסט מלא
      case 'text':
        data = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: from,
          type: 'text',
          text: {
            preview_url: true,
            body: messages[j].value || '',
          },
        }
        break

      // טקסט לגוף לפני כפתורים
      case 'body':
        // לא שולחים כאן הודעה בנפרד, אלא משתמשים בזה ב"כפתורים" – כדי שתהיה כותרת
        // אם אתה רוצה בכל זאת לשלוח את ה־body כטקסט, בטל את ההערה:
        /*
        data = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: from,
          type: 'text',
          text: {
            preview_url: true,
            body: messages[j].value || '',
          },
        }
        */
        ignore = true
        break

      default:
        ignore = true
        console.error("❌ Unsupported message type:", messages[j])
        break
    }

    if (!ignore && data) {
      try {
        let resp = await axios({
          method: 'POST',
          url: `https://graph.facebook.com/${WHATSAPP_VERSION}/${phone_number_id}/messages`,
          data: data,
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + WHATSAPP_TOKEN,
          },
        })
        console.log("✅ WhatsApp API Response:", resp.data)

        // השהייה אם זו תמונה (כדי למנוע rate-limit)
        if (messages[j].type === 'image') {
          try {
            const responseHead = await axios.head(messages[j].value)
            if (responseHead.headers['content-length']) {
              const imageSizeKB = parseInt(responseHead.headers['content-length']) / 1024
              const timeout = imageSizeKB * timeoutPerKB
              await new Promise((resolve) => setTimeout(resolve, timeout))
            }
          } catch (error) {
            console.error('Failed to fetch image size:', error)
            await new Promise((resolve) => setTimeout(resolve, 5000))
          }
        }
      } catch (err) {
        console.error("❌ Error sending WhatsApp message:", err?.response?.data || err)
      }
    }
  }
}

// ====================== no-reply במידה והמשתמש לא הגיב ======================
async function sendNoReply(user_id, request, phone_number_id, user_name) {
  clearTimeout(noreplyTimeout)
  console.log('No reply -> sending no-reply to Voiceflow')
  await interact(
    user_id,
    {
      type: 'no-reply',
    },
    phone_number_id,
    user_name
  )
}

// ====================== עזר: הפקת טקסט מ־payload.slate (קוד 2) ======================
function extractSlateText(payload) {
  // אם יש payload.message קלאסי – נשתמש בו (למניעת undefined)
  if (payload?.message) {
    return payload.message
  }
  // אחרת ננסה לפענח slate
  let output = ''
  if (payload?.slate?.content) {
    for (let j = 0; j < payload.slate.content.length; j++) {
      const row = payload.slate.content[j]
      if (row.children) {
        for (let k = 0; k < row.children.length; k++) {
          const child = row.children[k]
          if (!child) continue
          // אם זה לינק
          if (child.type === 'link' && child.url) {
            output += child.url
          }
          // מודגש
          else if (child.text && child.fontWeight) {
            output += `*${child.text}*`
          }
          // נטוי
          else if (child.text && child.italic) {
            output += `_${child.text}_`
          }
          // קו חוצה
          else if (child.text && child.strikeThrough) {
            output += `~${child.text}~`
          }
          // קו תחתון (וואטסאפ לא תומך, אז נוריד)
          else if (child.text && child.underline) {
            output += child.text
          }
          // טקסט רגיל
          else if (child.text) {
            output += child.text
          }
        }
      }
      output += '\n'
    }
  }
  return output.trim()
}

// ====================== עזר: יצירת מזהה ייחודי ל־session ======================
function rndID() {
  var randomNo = Math.floor(Math.random() * 1000 + 1)
  var timestamp = Date.now()
  var date = new Date()
  var weekday = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  var day = weekday[date.getDay()]
  return randomNo + day + timestamp
}

// ====================== עזר: קיצוץ מחרוזת לכפתור ======================
function truncateString(str, maxLength = 20) {
  if (str && typeof str === 'string') {
    if (str.length > maxLength) {
      return str.substring(0, maxLength - 1) + '…'
    }
    return str
  }
  return ''
}

// ====================== שמירת Transcript בסיום השיחה ======================
function saveTranscript(username) {
  if (VF_PROJECT_ID) {
    if (!username) {
      username = 'Anonymous'
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
      .then(function () {
        console.log('Transcript Saved!')
      })
      .catch((err) => console.log(err))
  }
  // איפוס session חדש (אם תרצה להתחיל שיחה חדשה אחר כך)
  session = `${VF_VERSION_ID}.${rndID()}`
}
