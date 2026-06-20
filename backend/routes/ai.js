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

// Internal-ish endpoint called post-session to generate AI feedback for the teacher
router.post('/analyze', auth, async (req, res) => {
  try {
    const { session_id, subject, pulse_checks_total, pulse_checks_correct, transcript } = req.body;
    if (!session_id || !subject) return res.status(400).json({ error: 'Missing session data' });

    const db = await initDB();
    const sess = await db.get('SELECT * FROM sessions WHERE id=?', session_id);
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    const teacherUid = sess.role1 === 'teach' ? sess.peer1 : sess.peer2;
    const studentUid = sess.role1 === 'teach' ? sess.peer2 : sess.peer1;

    let clarity = 5.0, engagement = 5.0, feedback = "Session completed. Keep practicing!", repDelta = 0;
    let aiNotes = "";

    if (!process.env.ANTHROPIC_API_KEY) {
      // Fallback
      if (pulse_checks_total > 0) {
        engagement = (pulse_checks_correct / pulse_checks_total) * 10;
        clarity = engagement >= 5 ? 8.5 : 4.0;
        feedback = `Student answered ${pulse_checks_correct} out of ${pulse_checks_total} pulse checks correctly.`;
        repDelta = engagement >= 5 ? 0.2 : -0.1;
      } else {
        clarity = 7.0; engagement = 6.0;
        feedback = "Good session, but try using Pulse Checks next time to verify understanding.";
        repDelta = 0.1;
      }
    } else {
      let prompt = `Analyze a teaching session on "${subject}".
The teacher sent ${pulse_checks_total} live pulse-check questions during the session.
The student answered ${pulse_checks_correct} correctly.
Below is the raw STT transcript of the session (if available):
<transcript>
${transcript || '(No transcript recorded)'}
</transcript>

Generate a JSON evaluation with:
- "clarity_score" (1-10 float)
- "engagement_score" (1-10 float)
- "feedback_text" (a 1-2 sentence constructive summary for the teacher)
- "suggestions" (an array of 1-2 short bullet points for improvement)
- "learning_notes" (Markdown formatted study notes summarizing the key concepts taught in the transcript. Include headings, bullet points, and any detected practice questions. If no transcript, just provide general tips for the subject.)
- "safety_audit" (Object with "is_safe": boolean, "flag_reason": string or null. Flag for harassment, inappropriate content, or deliberate privacy violations like sharing personal contact info repeatedly.)
Output EXACTLY valid JSON, nothing else.`;

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
            max_tokens: 400,
            messages: [{ role: 'user', content: prompt }]
          })
        });

        const data = await response.json();
        const text = data.content?.[0]?.text;
        const resJson = JSON.parse(text);

        clarity = parseFloat(resJson.clarity_score) || 7.0;
        engagement = parseFloat(resJson.engagement_score) || 7.0;
        feedback = JSON.stringify({ summary: resJson.feedback_text, suggestions: resJson.suggestions || [] });
        aiNotes = resJson.learning_notes || "";
        
        repDelta = (clarity > 7 && engagement > 7) ? 0.3 : (clarity < 5 ? -0.2 : 0.1);

        if (resJson.safety_audit && resJson.safety_audit.is_safe === false) {
          await db.run('UPDATE users SET strikes = strikes + 1 WHERE uid = ? OR uid = ?', teacherUid, studentUid);
          console.warn(`Safety flag in session ${session_id}: ${resJson.safety_audit.flag_reason}`);
        }

      } catch (err) {
        console.error("Claude Analyze failed:", err);
      }
    }

    // Save feedback
    await db.run(`INSERT INTO ai_feedback(id,session_id,teacher_uid,student_uid,clarity_score,engagement_score,feedback_text,rep_delta,created_at)
                VALUES(?,?,?,?,?,?,?,?,?)`,
      uuidv4(), session_id, teacherUid, studentUid, clarity, engagement, feedback, repDelta, Date.now()
    );

    if (aiNotes) {
      await db.run(`INSERT INTO notes(id,session_id,author_uid,title,content,is_public,ts)
                    VALUES(?,?,?,?,?,0,?)`,
        uuidv4(), session_id, teacherUid, `AI Notes: ${subject}`, aiNotes, Date.now()
      );
    }

    // Update teacher scores
    const t = await db.get('SELECT teaching_score, rep_score, sess_count FROM users WHERE uid=?', teacherUid);
    const oldScore = t.teaching_score || 0;
    const count = t.sess_count || 1;
    // Rolling average for teaching score
    let newScore = oldScore === 0 ? clarity : ((oldScore * (count - 1)) + clarity) / count;
    let newRep = (t.rep_score || 0) + repDelta;
    if (newRep < 0) newRep = 0;
    if (newScore > 10) newScore = 10;
    
    await db.run(`UPDATE users SET teaching_score=?, rep_score=? WHERE uid=?`, newScore, newRep, teacherUid);

    res.json({ success: true, clarity, engagement, repDelta });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/my-score', auth, async (req, res) => {
  try {
    const db = await initDB();
    const u = await db.get('SELECT teaching_score, rep_score FROM users WHERE uid=?', req.user.uid);
    const feedbacks = await db.all(`
      SELECT clarity_score, engagement_score, feedback_text, created_at 
      FROM ai_feedback WHERE teacher_uid=? ORDER BY created_at DESC LIMIT 5
    `, req.user.uid);

    res.json({
      teaching_score: u.teaching_score,
      rep_score: u.rep_score,
      recent_feedback: feedbacks
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
