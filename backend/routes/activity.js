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

router.get('/', async (req, res) => {
  try {
    const db = await initDB();
    const acts = await db.all('SELECT * FROM activity ORDER BY ts DESC LIMIT 20');
    res.json({ activity: acts });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const db = await initDB();
    const { msg, type } = req.body;
    await db.run('INSERT INTO activity(id,msg,type,ts) VALUES(?,?,?,?)',
      uuidv4(), msg, type || 'info', Date.now());
    res.status(201).json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
