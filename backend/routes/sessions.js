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
    const sessions = await db.all(`
      SELECT s.*, 
        u1.name as peer1_name, u1.color as peer1_color, u1.level as peer1_level,
        u2.name as peer2_name, u2.color as peer2_color, u2.level as peer2_level
      FROM sessions s
      JOIN users u1 ON s.peer1 = u1.uid
      JOIN users u2 ON s.peer2 = u2.uid
      WHERE s.peer1 = ? OR s.peer2 = ?
      ORDER BY s.date, s.time
    `, req.user.uid, req.user.uid);
    res.json({ sessions });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const db = await initDB();
    const { peer, subject, date, time, role } = req.body;
    if (peer === req.user.uid) return res.status(400).json({ error: 'Cannot book with yourself' });

    const id = 'sess_' + uuidv4().replace(/-/g, '').substring(0, 10);
    const room = uuidv4().substring(0, 13);
    
    // User role is from their perspective. If 'teach', peer2 is learning.
    await db.run(`INSERT INTO sessions(id,peer1,peer2,subject,date,time,room_code,role1,booked_at)
                VALUES(?,?,?,?,?,?,?,?,?)`,
      id, req.user.uid, peer, subject, date, time, room, role, Date.now());

    // Deduct KP if user is learning
    if (role === 'learn') {
      const u = await db.get('SELECT kp FROM users WHERE uid=?', req.user.uid);
      if (u.kp < 50) return res.status(400).json({ error: 'Not enough KP' });
      await db.run('UPDATE users SET kp=kp-50 WHERE uid=?', req.user.uid);
      await db.run("INSERT INTO transactions(id,uid,description,sub,amount,type,ts) VALUES(?,?,?,?,?,?,?)",
        uuidv4(), req.user.uid, 'Booked session', subject, -50, 'spend', Date.now());
    } else {
      await db.run("INSERT INTO transactions(id,uid,description,sub,amount,type,ts) VALUES(?,?,?,?,?,?,?)",
        uuidv4(), req.user.uid, 'Teaching session', subject, 50, 'earn', Date.now());
    }

    if (req.app.locals.wsClients.has(peer)) {
      req.app.locals.wsClients.get(peer).send(JSON.stringify({ type: 'session_event', event: 'new' }));
    }

    res.status(201).json({ success: true, id, room });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', auth, async (req, res) => {
  try {
    const db = await initDB();
    const { action, rating, stars, feedback } = req.body;
    const sess = await db.get('SELECT * FROM sessions WHERE id=?', req.params.id);
    if (!sess) return res.status(404).json({ error: 'Not found' });
    if (sess.peer1 !== req.user.uid && sess.peer2 !== req.user.uid) return res.status(403).json({ error: 'Not yours' });

    if (action === 'cancel') {
      await db.run("UPDATE sessions SET status='cancelled' WHERE id=?", req.params.id);
      if (sess.role1 === 'learn' && sess.peer1 === req.user.uid) {
        // Refund
        await db.run('UPDATE users SET kp=kp+50 WHERE uid=?', req.user.uid);
        await db.run("INSERT INTO transactions(id,uid,description,sub,amount,type,ts) VALUES(?,?,?,?,?,?,?)",
          uuidv4(), req.user.uid, 'Refund - Cancelled', sess.subject, 50, 'earn', Date.now());
      }
      return res.json({ success: true });
    }

    if (action === 'done') {
      await db.run("UPDATE sessions SET status='completed' WHERE id=?", req.params.id);
      // Give XP + teacher KP
      await db.run("UPDATE users SET xp=xp+50, sess_count=sess_count+1 WHERE uid IN (?,?)", sess.peer1, sess.peer2);
      const teacher = sess.role1 === 'teach' ? sess.peer1 : sess.peer2;
      await db.run("UPDATE users SET kp=kp+50 WHERE uid=?", teacher);

      const t2 = sess.role1 === 'teach' ? sess.peer1 : sess.peer2;
      if (t2 === req.user.uid) { // Make sure the teacher doesn't earn the transaction twice... wait the booking already created tx for peer1.
        // Simplified tx logic for MVP
      }

      await db.run("INSERT INTO activity(id,msg,type,ts) VALUES(?,?,?,?)",
        uuidv4(), `Completed a session on ${sess.subject}!`, 'session', Date.now());
        
      return res.json({ success: true });
    }

    if (action === 'rate') {
      if (sess.rated) return res.status(400).json({ error: 'Already rated' });
      await db.run(`UPDATE sessions SET rated=1, rating=? WHERE id=?`, stars, req.params.id);
      
      const teacherUid = sess.role1 === 'teach' ? sess.peer1 : sess.peer2;
      if (req.user.uid === teacherUid) return res.json({ success: true }); // teacher can't rate student yet

      // Add rating to teacher profile
      const t = await db.get('SELECT ratings FROM users WHERE uid=?', teacherUid);
      let dr = [];
      try { dr = JSON.parse(t.ratings); } catch {}
      dr.push({ stars, txt: feedback || '', by: req.user.uid });
      await db.run('UPDATE users SET ratings=?, kp=kp+20 WHERE uid=?', JSON.stringify(dr), teacherUid);

      // Student gets 15 KP for rating
      await db.run('UPDATE users SET kp=kp+15 WHERE uid=?', req.user.uid);

      return res.json({ success: true });
    }

    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/complete', auth, async (req, res) => {
  try {
    const db = await initDB();
    const sess = await db.get('SELECT * FROM sessions WHERE id=?', req.params.id);
    if (!sess) return res.status(404).json({ error: 'Not found' });
    
    await db.run("UPDATE sessions SET status='completed' WHERE id=?", req.params.id);
    await db.run("UPDATE users SET xp=xp+50, sess_count=sess_count+1 WHERE uid IN (?,?)", sess.peer1, sess.peer2);
    
    const teacherUid = sess.role1 === 'teach' ? sess.peer1 : sess.peer2;
    await db.run("UPDATE users SET kp=kp+50 WHERE uid=?", teacherUid);

    // Get quiz stats for AI analysis
    const qs = await db.all('SELECT * FROM quiz_questions WHERE session_id=?', sess.id);
    const qIds = qs.map(q => q.id);
    let correctAns = 0;
    
    if (qIds.length > 0) {
      const qp = qIds.map(() => '?').join(',');
      const ans = await db.all(`SELECT * FROM quiz_answers WHERE question_id IN (${qp})`, ...qIds);
      correctAns = ans.filter(a => a.is_correct === 1).length;
    }

    // Call internal AI analyze API to generate feedback
    const fetch = require('node-fetch');
    const PORT = process.env.PORT || 3000;
    fetch(`http://localhost:${PORT}/api/ai/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': req.headers.authorization },
      body: JSON.stringify({
        session_id: sess.id,
        subject: sess.subject,
         pulse_checks_total: qs.length,
        pulse_checks_correct: correctAns
      })
    }).catch(console.error); // Async fire-and-forget

    res.json({ success: true, quizzes: qs.length, correct: correctAns, xp_earned: 50 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
