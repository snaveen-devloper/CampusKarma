'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { initDB } = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));

// Serve frontend
app.use(express.static(path.join(__dirname, '..')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/users',    require('./routes/users'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/chat',     require('./routes/chat'));
app.use('/api/quiz',     require('./routes/quiz'));
app.use('/api/ai',       require('./routes/ai'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/store',    require('./routes/store'));
app.use('/api/notes',    require('./routes/notes'));
app.use('/api/reports',  require('./routes/reports'));

// ── WebSocket ─────────────────────────────────────────────────────────────────
// Map: uid → ws connection
const clients = new Map();

wss.on('connection', (ws) => {
  let authedUid = null;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'auth': {
        // Validate JWT
        try {
          const jwt = require('jsonwebtoken');
          const payload = jwt.verify(msg.token, process.env.JWT_SECRET);
          authedUid = payload.uid;
          clients.set(authedUid, ws);
          ws.send(JSON.stringify({ type: 'auth_ok', uid: authedUid }));
        } catch {
          ws.send(JSON.stringify({ type: 'auth_fail' }));
        }
        break;
      }

      case 'chat_message': {
        // msg: { type, to, room_id, ciphertext, iv, id }
        if (!authedUid) return;
        // Persist to DB
        const db = await initDB();
        const { v4: uuidv4 } = require('uuid');
        await db.run(`INSERT INTO messages(id,room_id,sender_uid,ciphertext,iv,ts)
                    VALUES(?,?,?,?,?,?)`,
          msg.id || uuidv4(), msg.room_id, authedUid,
          msg.ciphertext, msg.iv, Date.now()
        );
        // Forward to recipient
        const recipWs = clients.get(msg.to);
        if (recipWs && recipWs.readyState === WebSocket.OPEN) {
          recipWs.send(JSON.stringify({
            type: 'chat_message',
            from: authedUid,
            room_id: msg.room_id,
            ciphertext: msg.ciphertext,
            iv: msg.iv,
            id: msg.id,
            ts: Date.now()
          }));
        }
        break;
      }

      case 'quiz_push': {
        // Teacher pushes a quiz question to student
        if (!authedUid) return;
        const recipWs = clients.get(msg.to);
        if (recipWs && recipWs.readyState === WebSocket.OPEN) {
          recipWs.send(JSON.stringify({
            type: 'quiz_push',
            from: authedUid,
            session_id: msg.session_id,
            question_id: msg.question_id,
            question: msg.question,
            options: msg.options,
            time_limit: msg.time_limit || 30
          }));
        }
        break;
      }

      case 'quiz_answer': {
        // Student sends answer back; server evaluates and notifies teacher
        if (!authedUid) return;
        const db = await initDB();
        const { v4: uuidv4 } = require('uuid');
        const qrow = await db.get('SELECT * FROM quiz_questions WHERE id=?', msg.question_id);
        if (!qrow) return;
        const is_correct = msg.answer_index === qrow.correct_index ? 1 : 0;
        await db.run(`INSERT OR REPLACE INTO quiz_answers(id,question_id,student_uid,answer_index,is_correct,answered_at)
                    VALUES(?,?,?,?,?,?)`,
          uuidv4(), msg.question_id, authedUid, msg.answer_index, is_correct, Date.now()
        );
        // Award XP to student on correct
        if (is_correct) {
          await db.run('UPDATE users SET xp=xp+10 WHERE uid=?', authedUid);
          await db.run('UPDATE users SET kp=kp+5 WHERE uid=?', msg.teacher_uid);
        }
        // Send result to student
        ws.send(JSON.stringify({
          type: 'quiz_result',
          question_id: msg.question_id,
          is_correct: !!is_correct,
          correct_index: qrow.correct_index
        }));
        // Notify teacher
        const teacherWs = clients.get(msg.teacher_uid);
        if (teacherWs && teacherWs.readyState === WebSocket.OPEN) {
          teacherWs.send(JSON.stringify({
            type: 'student_answered',
            student_uid: authedUid,
            question_id: msg.question_id,
            is_correct: !!is_correct,
            answer_index: msg.answer_index,
            correct_index: qrow.correct_index
          }));
        }
        break;
      }

      case 'pub_key_share': {
        // Share ECDH public key with a peer for E2E chat setup
        if (!authedUid) return;
        const db = await initDB();
        await db.run(`INSERT OR REPLACE INTO pub_keys(uid,peer_uid,pub_key) VALUES(?,?,?)`,
          authedUid, msg.for_uid, msg.pub_key);
        // Forward to peer if online
        const peerWs = clients.get(msg.for_uid);
        if (peerWs && peerWs.readyState === WebSocket.OPEN) {
          peerWs.send(JSON.stringify({
            type: 'pub_key_received',
            from: authedUid,
            pub_key: msg.pub_key
          }));
        }
        break;
      }

      case 'live_transcript': {
        // Relay speech-to-text transcript from one peer to another
        if (!authedUid) return;
        const recipWs = clients.get(msg.to);
        if (recipWs && recipWs.readyState === WebSocket.OPEN) {
          recipWs.send(JSON.stringify({
            type: 'live_transcript',
            from: authedUid,
            text: msg.text,
            isFinal: msg.isFinal
          }));
        }
        break;
      }

      case 'session_event': {
        if (!authedUid) return;
        const recipWs = clients.get(msg.to);
        if (recipWs && recipWs.readyState === WebSocket.OPEN) {
          recipWs.send(JSON.stringify({ type: 'session_event', event: msg.event, data: msg.data }));
        }
        break;
      }

      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (authedUid) clients.delete(authedUid);
  });
});

// Export clients map for routes to use
app.locals.wsClients = clients;
app.locals.wss = wss;

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🎓 CampusKarma server running on http://localhost:${PORT}`);
    console.log(`🔌 WebSocket ready on ws://localhost:${PORT}`);
    console.log(`📦 Database: campuskarma.db (async sqlite initialized)\n`);
  });
}).catch(err => {
  console.error("Failed to initialize database", err);
  process.exit(1);
});
