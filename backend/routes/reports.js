'use strict';
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { initDB } = require('../db');
const { v4: uuidv4 } = require('uuid');

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

router.post('/', auth, async (req, res) => {
  try {
    const { target_uid, reason, detail } = req.body;
    if (!target_uid || !reason) return res.status(400).json({ error: 'Target and reason required' });

    const db = await initDB();
    await db.run(
      'INSERT INTO reports (id, from_uid, target_uid, reason, detail, ts) VALUES (?, ?, ?, ?, ?, ?)',
      uuidv4(), req.user.uid, target_uid, reason, detail || '', Date.now()
    );

    // If target gets too many reports, flag them
    const count = await db.get('SELECT COUNT(*) as c FROM reports WHERE target_uid = ?', target_uid);
    if (count.c >= 3) {
      await db.run('UPDATE users SET strikes = strikes + 1 WHERE uid = ?', target_uid);
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
