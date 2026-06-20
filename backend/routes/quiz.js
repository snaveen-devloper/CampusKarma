const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
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

// Generate 3 contextual quiz questions for a subject using Anthropic API
router.post('/generate', auth, async (req, res) => {
  try {
    const { subject, session_id } = req.body;
    if (!subject || !session_id) return res.status(400).json({ error: 'Subject and session_id required' });

    let questions = [];

    if (!process.env.ANTHROPIC_API_KEY) {
      // Fallback if no API key
      questions = [
        { q: `What is the core principle of ${subject}?`, opts: ['Depends', 'Nothing', 'Everything', 'Consistency'], ans: 3 },
        { q: `Which of these is fundamental to ${subject}?`, opts: ['Hard work', 'Practice', 'Sleep', 'Reading'], ans: 1 },
        { q: `Are you paying attention to ${subject}?`, opts: ['Yes', 'No', 'Maybe', 'Who knows'], ans: 0 }
      ];
    } else {
      // Call Claude API
      const prompt = `You are a strict but fair AI teaching assistant for a P2P tutoring platform.
Generate exactly 3 multiple choice questions for a high-school/college level student learning "${subject}".
The questions should test basic attention and understanding of core concepts.
Return ONLY valid JSON in this exact format, with no markdown formatting or extra text:
[
  { "question": "Question text here", "options": ["A", "B", "C", "D"], "correct_index": 0 }
]`;

      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 500,
            messages: [{ role: 'user', content: prompt }]
          })
        });

        const data = await response.json();
        const text = data.content?.[0]?.text;
        questions = JSON.parse(text);
      } catch (err) {
        console.error("Claude API failed, using fallback:", err);
        questions = [
          { q: `Is ${subject} difficult?`, opts: ['Yes', 'No', 'Sometimes', 'Always'], ans: 2 }
        ];
      }
    }

    // Save to DB
    const db = await initDB();
    const saved = [];
    for (const q of questions) {
      const id = 'qq_' + uuidv4().substring(0,8);
      await db.run(`INSERT INTO quiz_questions(id,session_id,question,options,correct_index,asked_at) VALUES(?,?,?,?,?,?)`,
        id, session_id, q.q || q.question, JSON.stringify(q.opts || q.options), q.ans ?? q.correct_index, null);
      saved.push({
        id, question: q.q || q.question, options: q.opts || q.options, correct_index: q.ans ?? q.correct_index
      });
    }

    res.json({ questions: saved });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Teacher pushes question to student (HTTP fallback wrapper for WS)
router.post('/push', auth, async (req, res) => {
  try {
    const db = await initDB();
    const { question_id, student_uid, time_limit } = req.body;
    const q = await db.get('SELECT * FROM quiz_questions WHERE id=?', question_id);
    if (!q) return res.status(404).json({ error: 'Question not found' });

    await db.run('UPDATE quiz_questions SET asked_at=? WHERE id=?', Date.now(), question_id);

    if (req.app.locals.wsClients.has(student_uid)) {
      req.app.locals.wsClients.get(student_uid).send(JSON.stringify({
        type: 'quiz_push',
        from: req.user.uid,
        session_id: q.session_id,
        question_id: q.id,
        question: q.question,
        options: JSON.parse(q.options),
        time_limit: time_limit || 30
      }));
    }

    res.json({ success: true, message: 'Pushed to student' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Student answers (HTTP fallback wrapper for WS)
router.post('/answer', auth, async (req, res) => {
  try {
    const db = await initDB();
    const { question_id, answer_index } = req.body;
    const qrow = await db.get('SELECT * FROM quiz_questions WHERE id=?', question_id);
    if (!qrow) return res.status(404).json({ error: 'Question not found' });

    const is_correct = answer_index === qrow.correct_index ? 1 : 0;
    
    await db.run(`INSERT OR REPLACE INTO quiz_answers(id,question_id,student_uid,answer_index,is_correct,answered_at)
                VALUES(?,?,?,?,?,?)`,
      uuidv4(), question_id, req.user.uid, answer_index, is_correct, Date.now()
    );

    if (is_correct) {
      await db.run('UPDATE users SET xp=xp+10 WHERE uid=?', req.user.uid);
      const sess = await db.get('SELECT peer1, peer2, role1 FROM sessions WHERE id=?', qrow.session_id);
      if (sess) {
        const teacher = sess.role1 === 'teach' ? sess.peer1 : sess.peer2;
        await db.run('UPDATE users SET kp=kp+5 WHERE uid=?', teacher);
      }
    }

    res.json({ success: true, is_correct, correct_index: qrow.correct_index });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/session/:id', auth, async (req, res) => {
  try {
    const db = await initDB();
    const questions = await db.all('SELECT * FROM quiz_questions WHERE session_id=?', req.params.id);
    const answers = await db.all(`
      SELECT a.* FROM quiz_answers a 
      JOIN quiz_questions q ON a.question_id = q.id 
      WHERE q.session_id=?
    `, req.params.id);

    res.json({ questions, answers });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
