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
      
      if (req.body.entry[0].changes[0].value.messages[0].text) {
        await interact(user_id, {
          type: 'text',
          payload: req.body.entry[0].changes[0].value.messages[0].text.body,
        }, phone_number_id, user_name)
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
  console.log("🔄 Sending interaction to Voiceflow", user_name, user_id)
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
    },
  })
  console.log("📌 Response from Voiceflow:", response.data);
}
