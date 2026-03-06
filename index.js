require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Supabase 연결
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const JWT_SECRET = 'secret_key_1234'; // 아무거나 복잡하게 써도 됨
const upload = multer({ storage: multer.memoryStorage() });

// 1. 회원가입 (POST /register)
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const { data, error } = await supabase.from('users').insert([{ username, password: hashedPassword }]).select();
    if (error) throw error;
    res.status(201).json({ message: '가입 성공', user: data[0] });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// 2. 로그인 (POST /login)
app.post('/login', async (req, res) => {
  const { username, password, role } = req.body;
  try {
    const { data: users, error } = await supabase.from('users').select('*').eq('username', username);
    if (error || users.length === 0) return res.status(400).json({ error: '유저 없음' });

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: '비번 틀림' });

    const token = jwt.sign({ id: user.id, username: user.username, role: role || 'student' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: '로그인 성공', token, user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. 공부 기록 업로드 (POST /study) - 사진 포함
app.post('/study', upload.single('photo'), async (req, res) => {
  try {
    const { user_id, subject, study_time, content, satisfaction } = req.body;
    let photo_url = null;

    // 사진 업로드 로직
    if (req.file) {
      const fileName = `${Date.now()}_${req.file.originalname}`;
      // 한글 파일명 깨짐 방지
      const safeFileName = Buffer.from(fileName, 'latin1').toString('utf8'); 
      
      const { data, error } = await supabase.storage.from('study-photos').upload(fileName, req.file.buffer, { contentType: req.file.mimetype });
      if (error) throw error;
      
      const { data: publicData } = supabase.storage.from('study-photos').getPublicUrl(fileName);
      photo_url = publicData.publicUrl;
    }

    const { data, error } = await supabase.from('study_sessions').insert([{
      user_id, subject, study_time, content, satisfaction, photo_url
    }]).select();

    if (error) throw error;
    res.status(201).json({ message: '저장 완료', data });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// 4. 대시보드 데이터 조회 (GET /dashboard/:id)
app.get('/dashboard/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('study_sessions')
      .select('*').eq('user_id', req.params.id).order('created_at', { ascending: false });
    
    if (error) throw error;

    // 프론트엔드 포맷으로 변환
    const history = data.map(item => ({
      id: item.id,
      subject: item.subject,
      duration: `${Math.floor(item.study_time / 60)}시간 ${item.study_time % 60}분`,
      satisfaction: item.satisfaction,
      memo: item.content,
      hasPhoto: !!item.photo_url,
      photoUrl: item.photo_url,
      date: item.created_at.split('T')[0],
      isCheered: item.is_cheered
    }));

    res.json({ history });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. 랭킹 조회 (GET /ranking)
app.get('/ranking', async (req, res) => {
  try {
    const { data: users } = await supabase.from('users').select('username, study_sessions(study_time)');
    
    // 계산 로직
    const ranking = users.map(u => ({
      nickname: u.username,
      total_time: u.study_sessions ? u.study_sessions.reduce((a, b) => a + b.study_time, 0) : 0
    })).sort((a, b) => b.total_time - a.total_time).slice(0, 10);

    const formatted = ranking.map((r, i) => ({
      rank: i + 1,
      nickname: r.nickname,
      time: `${Math.floor(r.total_time / 60)}h ${r.total_time % 60}m`
    }));

    res.json(formatted);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. 학부모 응원 (PATCH /cheer/:id)
app.patch('/cheer/:id', async (req, res) => {
  try {
    const { data: current } = await supabase.from('study_sessions').select('is_cheered').eq('id', req.params.id).single();
    const { data, error } = await supabase.from('study_sessions').update({ is_cheered: !current.is_cheered }).eq('id', req.params.id).select();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`서버 켜짐: http://localhost:${PORT}`));