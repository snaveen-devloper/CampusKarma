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

router.get('/items', auth, async (req, res) => {
  res.json({
    items: [
      { id: 'boost', name: 'Visibility Boost', desc: 'Top of Discover for 24h', kp: 100, color: '#10b981', icon: '⚡' },
      { id: 'shield', name: 'Streak Shield', desc: 'Protect streak for 1 day', kp: 150, color: '#6366f1', icon: '🛡' },
      { id: 'xp2x', name: 'XP Double', desc: '2× XP for 24 hours', kp: 200, color: '#f59e0b', icon: '📈' },
      { id: 'priority', name: 'Priority Match', desc: 'Requests seen first', kp: 250, color: '#06b6d4', icon: '🎯' }
    ]
  });
});

router.post('/buy', auth, async (req, res) => {
  try {
    const db = await initDB();
    const { item_id, item_name, kp } = req.body;
    if (!item_id || !kp) return res.status(400).json({ error: 'Missing logic' });

    const u = await db.get('SELECT kp FROM users WHERE uid=?', req.user.uid);
    if (u.kp < kp) return res.status(400).json({ error: 'Not enough KP' });

    await db.run('UPDATE users SET kp=kp-? WHERE uid=?', kp, req.user.uid);
    await db.run('INSERT OR REPLACE INTO boosts(uid,item_id,active,bought_at) VALUES(?,?,1,?)', req.user.uid, item_id, Date.now());
    
    await db.run("INSERT INTO transactions(id,uid,icon,description,amount,type,ts) VALUES(?,?,?,?,?,?,?)",
      uuidv4(), req.user.uid, '🛍', `Bought ${item_name}`, -kp, 'spend', Date.now());

    res.json({ success: true, kp_remaining: u.kp - kp });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/instant-kp', auth, async (req, res) => {
  // Demo feature
  try {
    const db = await initDB();
    await db.run('UPDATE users SET kp=kp+100 WHERE uid=?', req.user.uid);
    await db.run("INSERT INTO transactions(id,uid,icon,description,amount,type,ts) VALUES(?,?,?,?,?,?,?)",
      uuidv4(), req.user.uid, '⚡', `Instant KP Top-up`, 100, 'earn', Date.now());
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/report', auth, async (req, res) => {
  try {
    const db = await initDB();
    const { target_uid, reason, detail } = req.body;
    if (!target_uid) return res.status(400).json({ error: 'No target specified' });

    await db.run('INSERT INTO reports(id,from_uid,target_uid,reason,detail,ts) VALUES(?,?,?,?,?,?)',
      uuidv4(), req.user.uid, target_uid, reason, detail || '', Date.now());

    await db.run('UPDATE users SET strikes=strikes+1 WHERE uid=?', target_uid);
    // Simple auto-ban logic
    const t = await db.get('SELECT strikes FROM users WHERE uid=?', target_uid);
    if (t && t.strikes >= 3) {
      await db.run('UPDATE users SET is_banned=1 WHERE uid=?', target_uid);
    }
    
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
