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

router.get('/', auth, async (req, res) => {
  try {
    const db = await initDB();
    const requests = await db.all(`
      SELECT r.*, 
        u1.name as from_name, u1.school as from_school, u1.level as from_level, u1.color as from_color,
        u2.name as to_name, u2.school as to_school, u2.level as to_level, u2.color as to_color
      FROM requests r
      JOIN users u1 ON r.from_uid = u1.uid
      JOIN users u2 ON r.to_uid = u2.uid
      WHERE r.from_uid = ? OR r.to_uid = ?
      ORDER BY r.ts DESC
    `, req.user.uid, req.user.uid);
    res.json({ requests });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const db = await initDB();
    const { to_uid, subject, note } = req.body;
    if (to_uid === req.user.uid) return res.status(400).json({ error: 'Cannot request yourself' });
    
    const existing = await db.get(`SELECT id FROM requests WHERE from_uid=? AND to_uid=? AND status='pending'`, req.user.uid, to_uid);
    if (existing) return res.status(400).json({ error: 'Request already pending' });

    const id = 'req_' + uuidv4().replace(/-/g, '').substring(0, 10);
    await db.run(`INSERT INTO requests(id,from_uid,to_uid,subject,note,ts) VALUES(?,?,?,?,?,?)`,
      id, req.user.uid, to_uid, subject, note || '', Date.now());

    // Notify
    if (req.app.locals.wsClients.has(to_uid)) {
      req.app.locals.wsClients.get(to_uid).send(JSON.stringify({ type: 'new_request' }));
    }

    res.status(201).json({ success: true, id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', auth, async (req, res) => {
  try {
    const db = await initDB();
    const { action } = req.body; // accept, decline, cancel
    const row = await db.get('SELECT * FROM requests WHERE id=?', req.params.id);
    if (!row) return res.status(404).json({ error: 'Request not found' });

    if (action === 'cancel') {
      if (row.from_uid !== req.user.uid) return res.status(403).json({ error: 'Not yours' });
      await db.run(`UPDATE requests SET status='cancelled' WHERE id=?`, req.params.id);
      return res.json({ success: true });
    }

    if (row.to_uid !== req.user.uid) return res.status(403).json({ error: 'Not your request to ' + action });
    
    if (action === 'accept') {
      await db.run(`UPDATE requests SET status='accepted' WHERE id=?`, req.params.id);
      // Give XP for connecting
      await db.run(`UPDATE users SET xp=xp+20 WHERE uid IN (?,?)`, row.from_uid, row.to_uid);
      await db.run(`INSERT INTO activity(id,msg,type,ts) VALUES(?,?,?,?)`,
        uuidv4(), `${row.subject} connection accepted!`, 'connect', Date.now());
      // Inform
      if (req.app.locals.wsClients.has(row.from_uid)) {
        req.app.locals.wsClients.get(row.from_uid).send(JSON.stringify({ type: 'new_request' }));
      }
    } else if (action === 'decline') {
      await db.run(`UPDATE requests SET status='declined' WHERE id=?`, req.params.id);
    }
    
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
