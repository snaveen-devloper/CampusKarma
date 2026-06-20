const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { initDB } = require('../db');

router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, school, cls } = req.body;
    if (!name || !email || !password || !school || !cls) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const db = await initDB();
    const existing = await db.get('SELECT uid FROM users WHERE email = ?', email);
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const { v4: uuidv4 } = require('uuid');
    const uid = 'u_' + uuidv4().replace(/-/g, '').substring(0, 12);
    const hash = await bcrypt.hash(password, 10);

    await db.run(`
      INSERT INTO users (uid, name, email, password_hash, school, cls, joined_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, uid, name, email, hash, school, cls, Date.now());

    const token = jwt.sign({ uid }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const user = await db.get('SELECT uid, name, email, school, cls, kp, xp, streak, level, is_new FROM users WHERE uid = ?', uid);
    res.status(201).json({ token, user });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const db = await initDB();
    const user = await db.get('SELECT * FROM users WHERE email = ?', email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    if (user.is_banned) return res.status(403).json({ error: 'Account suspended' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ uid: user.uid }, process.env.JWT_SECRET, { expiresIn: '7d' });
    
    // Parse JSON fields
    try { user.subjects = JSON.parse(user.subjects); } catch { user.subjects = []; }
    try { user.ratings = JSON.parse(user.ratings); } catch { user.ratings = []; }
    delete user.password_hash;

    res.json({ token, user });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing token' });
    }
    const token = authHeader.split(' ')[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    
    const db = await initDB();
    const user = await db.get('SELECT * FROM users WHERE uid = ?', payload.uid);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    // Check streak
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    const yesterday = yest.toISOString().split('T')[0];
    
    let newStreak = user.streak;
    let newIsNew = user.is_new;

    if (user.last_active !== today) {
      if (user.last_active === yesterday) newStreak++;
      else newStreak = 1;

      // Check shield boost
      const shield = await db.get("SELECT active FROM boosts WHERE uid=? AND item_id='shield' AND active=1", user.uid);
      if (!shield && user.last_active !== yesterday && user.last_active) {
         newStreak = 1;
      } else if (shield && user.last_active !== yesterday && user.last_active) {
         // Shield protected it, consume shield
         await db.run("UPDATE boosts SET active=0 WHERE uid=? AND item_id='shield'", user.uid);
      }
      
      await db.run('UPDATE users SET streak = ?, last_active = ?, is_new = 0 WHERE uid = ?', newStreak, today, user.uid);
      user.streak = newStreak;
      user.last_active = today;
      newIsNew = 0;
    }

    try { user.subjects = JSON.parse(user.subjects); } catch { user.subjects = []; }
    try { user.ratings = JSON.parse(user.ratings); } catch { user.ratings = []; }
    delete user.password_hash;
    user.is_new = newIsNew;

    res.json({ user });
  } catch (error) {
    console.error('Me error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
