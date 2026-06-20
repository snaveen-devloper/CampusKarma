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

router.get('/', auth, async (req, res) => {
  try {
    const db = await initDB();
    const users = await db.all(`
      SELECT uid, name, school, cls, level, kp, teaching_score, rep_score, native_lang, subjects, color
      FROM users WHERE is_banned=0
    `);
    users.forEach(u => {
      try { u.subjects = JSON.parse(u.subjects); } catch { u.subjects = []; }
    });
    res.json({ users });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/leaderboard', auth, async (req, res) => {
  try {
    const db = await initDB();
    const users = await db.all(`
      SELECT uid, name, school, kp, level, color FROM users
      WHERE is_banned=0 ORDER BY kp DESC LIMIT 20
    `);
    res.json({ leaderboard: users });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/:uid', auth, async (req, res) => {
  try {
    const db = await initDB();
    const user = await db.get(`
      SELECT uid, name, email, school, cls, level, kp, xp, streak, teaching_score, rep_score, native_lang, subjects, ratings, color, joined_at
      FROM users WHERE uid=?
    `, req.params.uid);
    if (!user) return res.status(404).json({ error: 'User not found' });
    try { user.subjects = JSON.parse(user.subjects); } catch { user.subjects = []; }
    try { user.ratings = JSON.parse(user.ratings); } catch { user.ratings = []; }
    res.json({ user });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/me', auth, async (req, res) => {
  try {
    const db = await initDB();
    const { subjects, name, school, cls } = req.body;
    let updates = [];
    let vals = [];
    if (subjects) { updates.push('subjects=?'); vals.push(JSON.stringify(subjects)); }
    if (name) { updates.push('name=?'); vals.push(name); }
    if (school) { updates.push('school=?'); vals.push(school); }
    if (cls) { updates.push('cls=?'); vals.push(cls); }
    if (req.body.native_lang) { updates.push('native_lang=?'); vals.push(req.body.native_lang); }
    if (req.body.is_new !== undefined) { updates.push('is_new=?'); vals.push(req.body.is_new ? 1 : 0); }

    if (updates.length > 0) {
      vals.push(req.user.uid);
      await db.run(`UPDATE users SET ${updates.join(',')} WHERE uid=?`, ...vals);
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:uid/pubkey', auth, async (req, res) => {
  try {
    const db = await initDB();
    const { pub_key } = req.body;
    await db.run(`INSERT OR REPLACE INTO pub_keys(uid, peer_uid, pub_key) VALUES(?, ?, ?)`, req.user.uid, req.params.uid, pub_key);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/:uid/pubkey', auth, async (req, res) => {
  try {
    const db = await initDB();
    const row = await db.get(`SELECT pub_key FROM pub_keys WHERE uid=? AND peer_uid=?`, req.params.uid, req.user.uid);
    res.json({ pub_key: row ? row.pub_key : null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/me/transactions', auth, async (req, res) => {
  try {
    const db = await initDB();
    const txns = await db.all('SELECT * FROM transactions WHERE uid=? ORDER BY ts DESC LIMIT 50', req.user.uid);
    res.json({ transactions: txns });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/me/boosts', auth, async (req, res) => {
  try {
    const db = await initDB();
    const rows = await db.all('SELECT item_id FROM boosts WHERE uid=? AND active=1', req.user.uid);
    // Return as object { item_id: true } for easy lookup
    const boosts = {};
    rows.forEach(r => { boosts[r.item_id] = true; });
    res.json({ boosts });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/me/quests', auth, async (req, res) => {
  try {
    const db = await initDB();
    const today = new Date().toISOString().split('T')[0];
    let q = await db.get('SELECT date, progress FROM quests WHERE uid=?', req.user.uid);
    if (q && q.date === today) {
      res.json({ quests: { date: q.date, progress: JSON.parse(q.progress || '{}') } });
    } else {
      res.json({ quests: null }); // Let frontend build fresh quests
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/me/quests', auth, async (req, res) => {
  try {
    const db = await initDB();
    const { date, progress } = req.body;
    await db.run('INSERT OR REPLACE INTO quests(uid, date, progress) VALUES(?,?,?)', req.user.uid, date, JSON.stringify(progress));
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Legacy POST quests (keep for compatibility)
router.post('/me/quests', auth, async (req, res) => {
  try {
    const db = await initDB();
    const { date, progress } = req.body;
    const d = date || new Date().toISOString().split('T')[0];
    await db.run('INSERT OR REPLACE INTO quests(uid, date, progress) VALUES(?,?,?)', req.user.uid, d, JSON.stringify(progress || req.body));
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Endorse a peer (part of the trust network)
router.post('/:uid/endorse', auth, async (req, res) => {
  try {
    const db = await initDB();
    const fromUid = req.user.uid;
    const targetUid = req.params.uid;
    if (fromUid === targetUid) return res.status(400).json({ error: 'Cannot endorse yourself' });

    // Check if connection exists
    const conn = await db.get('SELECT * FROM requests WHERE (from_uid=? AND to_uid=? AND status="accepted") OR (from_uid=? AND to_uid=? AND status="accepted")', fromUid, targetUid, targetUid, fromUid);
    if (!conn) return res.status(403).json({ error: 'Must be connected to endorse' });

    await db.run('INSERT OR IGNORE INTO transactions(id,uid,icon,description,amount,type,ts) VALUES(?,?,?,?,?,?,?)',
      uuidv4(), targetUid, 'star', `Endorsement from ${req.user.name}`, 50, 'earn', Date.now()
    );
    
    // Recalculate Reputation Graph
    await recalculateReputation(db);
    
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function recalculateReputation(db) {
  // Simplified PageRank-inspired algorithm
  // Every user's rep_score = Base (1.0) + sum(Endorser_Rep / Endorser_Outbound)
  const users = await db.all('SELECT uid, rep_score FROM users');
  const endorsements = await db.all('SELECT from_uid, to_uid FROM requests WHERE status="accepted"');
  
  let scores = {};
  users.forEach(u => scores[u.uid] = 1.0);

  // Iterative calculation (3 passes for stability in MVP)
  for (let i = 0; i < 3; i++) {
    let newScores = {};
    users.forEach(u => newScores[u.uid] = 1.0);

    endorsements.forEach(e => {
      // Trust flows from endorser to endorsee
      // In this model, an 'accepted request' acts as a mutual endorsement link
      newScores[e.to_uid] += (scores[e.from_uid] * 0.15);
      newScores[e.from_uid] += (scores[e.to_uid] * 0.15);
    });

    scores = newScores;
  }

  for (const uid in scores) {
    await db.run('UPDATE users SET rep_score=? WHERE uid=?', scores[uid], uid);
  }
}

module.exports = router;
