const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { initDB } = require('../db');

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Get recent messages for a specific room (room ID is usually derived from sorted peer UIDs)
router.get('/:roomId', auth, async (req, res) => {
  try {
    const db = await initDB();
    const rows = await db.all(`
      SELECT m.*, u.name as sender_name 
      FROM messages m
      JOIN users u ON m.sender_uid = u.uid
      WHERE m.room_id = ?
      ORDER BY m.ts ASC
      LIMIT 100
    `, req.params.roomId);

    await db.run(`INSERT INTO activity(id,msg,type,ts) VALUES(?,?,?,?)`,
        uuidv4(), `Joined encrypted room ${req.params.roomId}`, 'chat', Date.now());

    res.json({ messages: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// For HTTP fallback message saving (WebSocket is primary)
router.post('/:roomId', auth, async (req, res) => {
  try {
    const db = await initDB();
    const { ciphertext, iv, to } = req.body;
    if (!ciphertext || !iv) return res.status(400).json({ error: 'Missing encrypted data' });

    const id = uuidv4();
    const ts = Date.now();

    await db.run(`INSERT INTO messages(id, room_id, sender_uid, ciphertext, iv, ts) VALUES(?,?,?,?,?,?)`,
      id, req.params.roomId, req.user.uid, ciphertext, iv, ts);

    // If HTTP post, also push via WS if online
    if (to && req.app.locals.wsClients.has(to)) {
      req.app.locals.wsClients.get(to).send(JSON.stringify({
        type: 'chat_message',
        from: req.user.uid,
        room_id: req.params.roomId,
        ciphertext,
        iv,
        id,
        ts
      }));
    }

    res.status(201).json({ success: true, id, ts });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
