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

// Get all notes (public + own private)
router.get('/', auth, async (req, res) => {
  try {
    const db = await initDB();
    const notes = await db.all(`
      SELECT n.*, u.name as author_name 
      FROM notes n
      LEFT JOIN users u ON n.author_uid = u.uid
      WHERE n.author_uid = ? OR n.is_public = 1
      ORDER BY n.ts DESC
    `, req.user.uid);
    res.json({ notes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update or Publish a note
router.patch('/:id', auth, async (req, res) => {
  try {
    const { title, content, is_public } = req.body;
    const db = await initDB();
    const note = await db.get('SELECT * FROM notes WHERE id=?', req.params.id);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    if (note.author_uid !== req.user.uid) return res.status(403).json({ error: 'Forbidden' });

    let updates = [];
    let params = [];
    if (title !== undefined) { updates.push('title=?'); params.push(title); }
    if (content !== undefined) { updates.push('content=?'); params.push(content); }
    if (is_public !== undefined) { updates.push('is_public=?'); params.push(is_public); }

    if (updates.length > 0) {
      params.push(req.params.id);
      await db.run(`UPDATE notes SET ${updates.join(', ')} WHERE id=?`, ...params);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fork a public note
router.post('/:id/fork', auth, async (req, res) => {
  try {
    const db = await initDB();
    const original = await db.get('SELECT * FROM notes WHERE id=?', req.params.id);
    if (!original) return res.status(404).json({ error: 'Note not found' });
    if (!original.is_public && original.author_uid !== req.user.uid) {
      return res.status(403).json({ error: 'Cannot fork private note' });
    }

    const newId = uuidv4();
    await db.run(`INSERT INTO notes(id, session_id, author_uid, title, content, is_public, forks, ts) 
                  VALUES(?, ?, ?, ?, ?, 0, 0, ?)`,
      newId, original.session_id, req.user.uid, `Fork of ${original.title}`, original.content, Date.now()
    );

    await db.run('UPDATE notes SET forks = forks + 1 WHERE id=?', req.params.id);

    res.json({ success: true, new_id: newId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create note manually
router.post('/', auth, async (req, res) => {
  try {
    const { title, content, is_public } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const db = await initDB();
    const id = uuidv4();
    await db.run(`INSERT INTO notes(id, author_uid, title, content, is_public, ts) 
                  VALUES(?, ?, ?, ?, ?, ?)`,
      id, req.user.uid, title, content || '', is_public ? 1 : 0, Date.now()
    );
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete note
router.delete('/:id', auth, async (req, res) => {
  try {
    const db = await initDB();
    const note = await db.get('SELECT * FROM notes WHERE id=?', req.params.id);
    if (!note) return res.status(404).json({ error: 'Not found' });
    if (note.author_uid !== req.user.uid) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM notes WHERE id=?', req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
