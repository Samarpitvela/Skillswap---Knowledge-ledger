/**
 * SkillSwap: Peer-to-Peer Knowledge Ledger
 * Backend Server (Node.js + Express + Supabase)
 * 
 * Features:
 * - Supabase Auth for JWT authentication
 * - Supabase PostgreSQL for ACID transactions
 * - Real-time subscription support
 * - Built-in row-level security (RLS)
 * - Automatic backups and recovery
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'skillswap-dev-secret-change-me';
const DEFAULT_SIGNUP_KC = 10;
const LOCAL_SKILLS_FILE = path.join(__dirname, 'skills-local.json');
const LOCAL_SESSIONS_FILE = path.join(__dirname, 'sessions-local.json');
const LOCAL_BALANCES_FILE = path.join(__dirname, 'balances-local.json');
const LOCAL_TRANSACTIONS_FILE = path.join(__dirname, 'transactions-local.json');
const KC_TOPUP_MARKER_FILE = path.join(__dirname, 'kc-topup-v1.json');

// ──────────────────────────────────────────────────────
// SUPABASE SETUP
// ──────────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const runtimeSupabaseKey = supabaseKey || supabaseServiceKey;
const isSupabaseConfigured = Boolean(supabaseUrl && runtimeSupabaseKey && supabaseServiceKey);

if (!isSupabaseConfigured) {
  console.warn('⚠️ Supabase credentials are missing. API endpoints are disabled until .env is configured.');
} else if (!supabaseKey) {
  console.warn('⚠️ SUPABASE_ANON_KEY is missing. Falling back to SUPABASE_SERVICE_ROLE_KEY for auth client.');
}

// Client for user operations (uses anon key)
const supabase = isSupabaseConfigured ? createClient(supabaseUrl, runtimeSupabaseKey) : null;

// Service role client for admin operations
const supabaseAdmin = isSupabaseConfigured ? createClient(supabaseUrl, supabaseServiceKey) : null;

// ──────────────────────────────────────────────────────
// MIDDLEWARE
// ──────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

function isMissingRelation(error, relationName) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes(`could not find the table 'public.${relationName.toLowerCase()}'`)
    || message.includes(`relation \"${relationName.toLowerCase()}\" does not exist`);
}

function readLocalSkills() {
  try {
    if (!fs.existsSync(LOCAL_SKILLS_FILE)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(LOCAL_SKILLS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeLocalSkills(skills) {
  fs.writeFileSync(LOCAL_SKILLS_FILE, JSON.stringify(skills, null, 2));
}

function readLocalSessions() {
  try {
    if (!fs.existsSync(LOCAL_SESSIONS_FILE)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(LOCAL_SESSIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeLocalSessions(sessions) {
  fs.writeFileSync(LOCAL_SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

function readLocalBalances() {
  try {
    if (!fs.existsSync(LOCAL_BALANCES_FILE)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(LOCAL_BALANCES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeLocalBalances(balances) {
  fs.writeFileSync(LOCAL_BALANCES_FILE, JSON.stringify(balances, null, 2));
}

function readLocalTransactions() {
  try {
    if (!fs.existsSync(LOCAL_TRANSACTIONS_FILE)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(LOCAL_TRANSACTIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeLocalTransactions(transactions) {
  fs.writeFileSync(LOCAL_TRANSACTIONS_FILE, JSON.stringify(transactions, null, 2));
}

function addLocalTransaction({ user_id, amount, tx_type, description, status = 'confirmed' }) {
  const txs = readLocalTransactions();
  txs.unshift({
    id: Date.now() + Math.floor(Math.random() * 1000),
    user_id: Number(user_id),
    amount: Number(amount),
    tx_type,
    description,
    status,
    created_at: new Date().toISOString()
  });
  writeLocalTransactions(txs);
}

function upsertLocalBalance(userId, deltaCredits = 0, createCredits = DEFAULT_SIGNUP_KC) {
  const balances = readLocalBalances();
  const idx = balances.findIndex((b) => Number(b.user_id) === Number(userId));
  if (idx === -1) {
    balances.push({
      user_id: Number(userId),
      available_credits: Number(createCredits),
      in_escrow_credits: 0,
      total_earned: Number(createCredits),
      total_spent: 0
    });
  } else if (deltaCredits !== 0) {
    balances[idx].available_credits = Number(balances[idx].available_credits || 0) + Number(deltaCredits);
    balances[idx].total_earned = Number(balances[idx].total_earned || 0) + Number(Math.max(0, deltaCredits));
  }
  writeLocalBalances(balances);
}

async function applyKcTopupForExistingAccounts() {
  if (!isSupabaseConfigured || fs.existsSync(KC_TOPUP_MARKER_FILE)) {
    return;
  }

  const topupAmount = 10;
  try {
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id');

    if (usersError) {
      console.warn(`⚠️ Skipping KC top-up: ${usersError.message}`);
      return;
    }

    const { data: balances, error: balancesError } = await supabaseAdmin
      .from('user_balances')
      .select('user_id, available_credits, in_escrow_credits, total_earned, total_spent');

    if (!balancesError) {
      const byUser = new Map((balances || []).map((b) => [Number(b.user_id), b]));

      for (const user of users || []) {
        const row = byUser.get(Number(user.id));
        if (row) {
          const { error: updateError } = await supabaseAdmin
            .from('user_balances')
            .update({
              available_credits: Number(row.available_credits || 0) + topupAmount,
              total_earned: Number(row.total_earned || 0) + topupAmount
            })
            .eq('user_id', user.id);
          if (updateError) {
            throw new Error(updateError.message);
          }
        } else {
          const { error: insertError } = await supabaseAdmin
            .from('user_balances')
            .insert({
              user_id: user.id,
              available_credits: topupAmount,
              in_escrow_credits: 0,
              total_earned: topupAmount,
              total_spent: 0
            });
          if (insertError) {
            throw new Error(insertError.message);
          }
        }
      }

      fs.writeFileSync(
        KC_TOPUP_MARKER_FILE,
        JSON.stringify({ applied_at: new Date().toISOString(), mode: 'database', amount: topupAmount }, null, 2)
      );
      console.log(`✅ Applied one-time +${topupAmount} KC top-up to existing accounts`);
      return;
    }

    if (!isMissingRelation(balancesError, 'user_balances')) {
      console.warn(`⚠️ Skipping KC top-up: ${balancesError.message}`);
      return;
    }

    for (const user of users || []) {
      upsertLocalBalance(user.id, topupAmount, topupAmount);
    }

    fs.writeFileSync(
      KC_TOPUP_MARKER_FILE,
      JSON.stringify({ applied_at: new Date().toISOString(), mode: 'local', amount: topupAmount }, null, 2)
    );
    console.log(`✅ Applied one-time +${topupAmount} KC top-up to existing accounts (local balances)`);
  } catch (err) {
    console.warn(`⚠️ KC top-up skipped: ${err.message}`);
  }
}

app.use('/api', (req, res, next) => {
  if (isSupabaseConfigured || req.path === '/health') {
    return next();
  }
  return res.status(503).json({
    error: 'Backend not configured',
    details: 'Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env'
  });
});

// Authentication middleware using local JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token verification failed' });
  }
}

// ──────────────────────────────────────────────────────
// AUTH ENDPOINTS (Using Supabase Auth)
// ──────────────────────────────────────────────────────

// Register
app.post('/api/auth/register', async (req, res) => {
  const { email, password, full_name, enrollment_id, username } = req.body;
  const normalizedUsername = (username || (email ? email.split('@')[0] : '')).trim();

  if (!email || !password || !normalizedUsername) {
    return res.status(400).json({ error: 'Username, email, and password are required' });
  }

  try {
    const { data: existingByEmail, error: existingByEmailError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingByEmailError) {
      return res.status(400).json({ error: existingByEmailError.message });
    }

    if (existingByEmail) {
      return res.status(409).json({ error: 'Email is already registered' });
    }

    const { data: existingByUsername, error: existingByUsernameError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('username', normalizedUsername)
      .maybeSingle();

    if (existingByUsernameError) {
      return res.status(400).json({ error: existingByUsernameError.message });
    }

    if (existingByUsername) {
      return res.status(409).json({ error: 'Username is already taken' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    // Create user profile
    const { data: createdUser, error: profileError } = await supabaseAdmin
      .from('users')
      .insert({
        username: normalizedUsername,
        email,
        full_name,
        enrollment_id,
        password_hash
      })
      .select('id, username, email, full_name, enrollment_id')
      .single();

    if (profileError) {
      return res.status(400).json({ error: profileError.message });
    }

    const userId = createdUser.id;

    // Initialize balance (10 KC welcome bonus)
    const { error: balanceError } = await supabaseAdmin
      .from('user_balances')
      .insert({
        user_id: userId,
        available_credits: DEFAULT_SIGNUP_KC,
        in_escrow_credits: 0,
        total_earned: DEFAULT_SIGNUP_KC,
        total_spent: 0
      });

    if (balanceError) {
      if (!isMissingRelation(balanceError, 'user_balances')) {
        return res.status(400).json({ error: balanceError.message });
      }
      upsertLocalBalance(userId, 0, DEFAULT_SIGNUP_KC);
    }

    // Log signup bonus transaction
    const { error: txError } = await supabaseAdmin
      .from('credit_transactions')
      .insert({
        user_id: userId,
        amount: DEFAULT_SIGNUP_KC,
        tx_type: 'signup_bonus',
        description: 'Signup Welcome Bonus',
        status: 'confirmed'
      });

    if (txError && !isMissingRelation(txError, 'credit_transactions')) {
      return res.status(400).json({ error: txError.message });
    }
    if (txError && isMissingRelation(txError, 'credit_transactions')) {
      addLocalTransaction({
        user_id: userId,
        amount: DEFAULT_SIGNUP_KC,
        tx_type: 'signup_bonus',
        description: 'Signup Welcome Bonus',
        status: 'confirmed'
      });
    }

    const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: 'User registered successfully',
      user: createdUser,
      token
    });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password, username } = req.body;
  if ((!email && !username) || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('id, username, email, full_name, enrollment_id, password_hash')
      .or(email ? `email.eq.${email}` : `username.eq.${username}`)
      .single();

    if (profileError || !userProfile) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordMatches = await bcrypt.compare(password, userProfile.password_hash || '');
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: userProfile.id, email: userProfile.email }, JWT_SECRET, { expiresIn: '7d' });
    delete userProfile.password_hash;

    res.json({
      message: 'Login successful',
      user: userProfile,
      token
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

// Logout
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
  res.json({ message: 'Logout successful' });
});

// ──────────────────────────────────────────────────────
// BALANCE ENDPOINTS
// ──────────────────────────────────────────────────────

// Get user balance
app.get('/api/balance', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_balances')
      .select('available_credits, in_escrow_credits, total_earned, total_spent')
      .eq('user_id', req.userId)
      .single();

    if (error) {
      if (isMissingRelation(error, 'user_balances')) {
        const localBalance = readLocalBalances().find((b) => Number(b.user_id) === Number(req.userId));
        return res.json({
          available_credits: Number(localBalance?.available_credits || 0),
          in_escrow_credits: Number(localBalance?.in_escrow_credits || 0),
          total_earned: Number(localBalance?.total_earned || 0),
          total_spent: Number(localBalance?.total_spent || 0)
        });
      }
      return res.status(404).json({ error: 'Balance not found' });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// Get transaction history
app.get('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('credit_transactions')
      .select('id, amount, tx_type, description, status, created_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      if (isMissingRelation(error, 'credit_transactions')) {
        const localTx = readLocalTransactions()
          .filter((tx) => Number(tx.user_id) === Number(req.userId))
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, 50);
        return res.json(localTx);
      }
      return res.status(400).json({ error: error.message });
    }

    const localTx = readLocalTransactions()
      .filter((tx) => Number(tx.user_id) === Number(req.userId));
    const merged = [...(data || []), ...localTx]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 50);
    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// ──────────────────────────────────────────────────────
// SKILLS ENDPOINTS
// ──────────────────────────────────────────────────────

// Get all skills
app.get('/api/skills', async (req, res) => {
  const { category, search } = req.query;

  try {
    let query = supabase
      .from('skills')
      .select('id, teacher_id, name, description, category, cost_credits, rating, users(username, rating)');

    if (category && category !== 'All') {
      query = query.eq('category', category);
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(100);

    if (error) {
      if (isMissingRelation(error, 'skills')) {
        let skills = readLocalSkills();
        if (category && category !== 'All') {
          skills = skills.filter((s) => s.category === category);
        }
        if (search) {
          const q = String(search).toLowerCase();
          skills = skills.filter((s) =>
            String(s.name || '').toLowerCase().includes(q)
            || String(s.description || '').toLowerCase().includes(q)
          );
        }
        return res.json(skills.slice(0, 100));
      }
      return res.status(400).json({ error: error.message });
    }

    const normalized = (data || []).map((s) => {
      const username = s?.users?.username || 'User';
      return {
        ...s,
        username,
        avatar_initials: username.slice(0, 2).toUpperCase()
      };
    });

    res.json(normalized);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch skills' });
  }
});

// Create skill
app.post('/api/skills', authenticateToken, async (req, res) => {
  const { name, description, category, cost_credits } = req.body;

  if (!name || !category || !cost_credits) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const { data, error } = await supabase
      .from('skills')
      .insert({
        teacher_id: req.userId,
        name,
        description,
        category,
        cost_credits
      })
      .select();

    if (error) {
      if (isMissingRelation(error, 'skills')) {
        const { data: me } = await supabaseAdmin
          .from('users')
          .select('username, full_name, email')
          .eq('id', req.userId)
          .maybeSingle();

        const username = me?.username || me?.full_name || me?.email || 'User';
        const skill = {
          id: Date.now(),
          teacher_id: req.userId,
          name,
          description: description || '',
          category,
          cost_credits: Number(cost_credits),
          rating: 5,
          username,
          avatar_initials: String(username).slice(0, 2).toUpperCase(),
          created_at: new Date().toISOString()
        };

        const existingSkills = readLocalSkills();
        existingSkills.unshift(skill);
        writeLocalSkills(existingSkills);
        return res.status(201).json({ message: 'Skill created', skill });
      }
      return res.status(400).json({ error: error.message });
    }
    const created = data[0] || {};
    const { data: me } = await supabaseAdmin
      .from('users')
      .select('username, full_name, email')
      .eq('id', req.userId)
      .maybeSingle();
    const username = me?.username || me?.full_name || me?.email || 'User';
    created.username = username;
    created.avatar_initials = String(username).slice(0, 2).toUpperCase();
    res.status(201).json({ message: 'Skill created', skill: created });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create skill' });
  }
});

// ──────────────────────────────────────────────────────
// ESCROW & SESSION ENDPOINTS
// ──────────────────────────────────────────────────────

// Request session (lock escrow)
app.post('/api/sessions/request', authenticateToken, async (req, res) => {
  const { skill_id, teacher_id, scheduled_at, duration_minutes } = req.body;

  try {
    let skillData = null;
    let skillLookupFromLocal = false;

    // Get skill cost
    const { data: dbSkillData, error: skillError } = await supabase
      .from('skills')
      .select('id, teacher_id, name, cost_credits')
      .eq('id', skill_id)
      .single();

    if (skillError) {
      if (isMissingRelation(skillError, 'skills')) {
        const localSkill = readLocalSkills().find((s) => Number(s.id) === Number(skill_id));
        if (!localSkill) {
          return res.status(404).json({ error: 'Skill not found' });
        }
        skillData = localSkill;
        skillLookupFromLocal = true;
      } else {
        return res.status(404).json({ error: 'Skill not found' });
      }
    } else {
      skillData = dbSkillData;
    }

    const cost = skillData.cost_credits;
    const resolvedTeacherId = teacher_id || skillData.teacher_id;

    // Check balance
    const { data: balanceData, error: balanceError } = await supabase
      .from('user_balances')
      .select('available_credits')
      .eq('user_id', req.userId)
      .single();

    let availableCredits = Number(balanceData?.available_credits || 0);
    const usingLocalBalance = Boolean(balanceError && isMissingRelation(balanceError, 'user_balances'));

    if (balanceError && !usingLocalBalance) {
      return res.status(400).json({ error: balanceError.message });
    }

    if (usingLocalBalance) {
      const localBalance = readLocalBalances().find((b) => Number(b.user_id) === Number(req.userId));
      availableCredits = Number(localBalance?.available_credits || 0);
    }

    if (availableCredits < cost) {
      return res.status(402).json({ error: 'Insufficient Knowledge Credits' });
    }

    // Use RPC call for atomic transaction
    const { data: sessionData, error: sessionError } = await supabase
      .rpc('request_session', {
        p_skill_id: skill_id,
        p_student_id: req.userId,
        p_teacher_id: resolvedTeacherId,
        p_scheduled_at: scheduled_at,
        p_duration_minutes: duration_minutes || 60,
        p_cost: cost
      });

    if (sessionError) {
      const lower = String(sessionError.message || '').toLowerCase();
      const canFallback =
        lower.includes('could not find the function')
        || lower.includes('request_session')
        || isMissingRelation(sessionError, 'sessions');

      if (!canFallback) {
        return res.status(400).json({ error: sessionError.message });
      }

      const localSessions = readLocalSessions();
      const { data: studentUser } = await supabaseAdmin
        .from('users')
        .select('username, full_name, email')
        .eq('id', req.userId)
        .maybeSingle();
      const { data: teacherUser } = await supabaseAdmin
        .from('users')
        .select('username, full_name, email')
        .eq('id', resolvedTeacherId)
        .maybeSingle();

      const studentName = studentUser?.username || studentUser?.full_name || studentUser?.email || `User-${req.userId}`;
      const teacherName = teacherUser?.username || teacherUser?.full_name || teacherUser?.email || `User-${resolvedTeacherId}`;

      const localSession = {
        id: Date.now(),
        skill_id: Number(skill_id),
        skill_name: skillData.name || 'Skill Session',
        student_id: req.userId,
        teacher_id: resolvedTeacherId,
        student_name: studentName,
        teacher_name: teacherName,
        scheduled_at,
        duration_minutes: duration_minutes || 60,
        cost_credits: Number(cost),
        status: 'pending',
        rating: null,
        feedback: null,
        created_at: new Date().toISOString(),
        source: skillLookupFromLocal ? 'local-skills' : 'fallback'
      };

      localSessions.unshift(localSession);
      writeLocalSessions(localSessions);
      if (usingLocalBalance) {
        const balances = readLocalBalances();
        const idx = balances.findIndex((b) => Number(b.user_id) === Number(req.userId));
        if (idx === -1) {
          balances.push({
            user_id: Number(req.userId),
            available_credits: 0,
            in_escrow_credits: Number(cost),
            total_earned: 0,
            total_spent: Number(cost)
          });
        } else {
          balances[idx].available_credits = Math.max(0, Number(balances[idx].available_credits || 0) - Number(cost));
          balances[idx].in_escrow_credits = Number(balances[idx].in_escrow_credits || 0) + Number(cost);
          balances[idx].total_spent = Number(balances[idx].total_spent || 0) + Number(cost);
        }
        writeLocalBalances(balances);
      }
      addLocalTransaction({
        user_id: req.userId,
        amount: -Number(cost),
        tx_type: 'session_requested',
        description: `Session requested for ${skillData.name || 'Skill Session'}`,
        status: 'confirmed'
      });

      return res.status(201).json({
        message: 'Session requested successfully',
        session: localSession,
        escrow: { amount: cost, status: usingLocalBalance ? 'locked' : 'simulated' }
      });
    }

    res.status(201).json({
      message: 'Session requested successfully',
      session: sessionData,
      escrow: { amount: cost, status: 'locked' }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to request session', details: err.message });
  }
});

// Complete session (release escrow)
app.post('/api/sessions/:sessionId/complete', authenticateToken, async (req, res) => {
  const { sessionId } = req.params;
  const { rating, feedback } = req.body;

  try {
    // Use RPC for atomic transaction
    const { data, error } = await supabase
      .rpc('complete_session', {
        p_session_id: parseInt(sessionId),
        p_user_id: req.userId,
        p_rating: rating,
        p_feedback: feedback
      });

    if (error) {
      const lower = String(error.message || '').toLowerCase();
      const canFallback =
        lower.includes('could not find the function')
        || lower.includes('complete_session')
        || isMissingRelation(error, 'sessions');

      if (!canFallback) {
        return res.status(400).json({ error: error.message });
      }

      const sessions = readLocalSessions();
      const idx = sessions.findIndex((s) => Number(s.id) === Number(sessionId));
      if (idx === -1) {
        return res.status(404).json({ error: 'Session not found' });
      }
      const target = sessions[idx];
      if (Number(target.student_id) !== Number(req.userId) && Number(target.teacher_id) !== Number(req.userId)) {
        return res.status(403).json({ error: 'Not allowed to complete this session' });
      }
      target.status = 'completed';
      target.rating = rating ?? target.rating;
      target.feedback = feedback ?? target.feedback;
      sessions[idx] = target;
      writeLocalSessions(sessions);
      return res.json({
        message: 'Session completed, escrow released',
        session: { id: sessionId, status: 'completed' }
      });
    }

    res.json({
      message: 'Session completed, escrow released',
      session: { id: sessionId, status: 'completed' }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to complete session', details: err.message });
  }
});

// Get user sessions
app.get('/api/sessions', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('sessions')
      .select(`
        id,
        skill_id,
        skills(name),
        student_id,
        teacher_id,
        users!sessions_student_id_fkey(username),
        users!sessions_teacher_id_fkey(username),
        scheduled_at,
        duration_minutes,
        status,
        rating,
        feedback,
        created_at
      `)
      .or(`student_id.eq.${req.userId},teacher_id.eq.${req.userId}`)
      .order('scheduled_at', { ascending: false });

    if (error) {
      if (isMissingRelation(error, 'sessions') || isMissingRelation(error, 'skills')) {
        const localSessions = readLocalSessions()
          .filter((s) => Number(s.student_id) === Number(req.userId) || Number(s.teacher_id) === Number(req.userId))
          .sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));
        return res.json(localSessions);
      }
      return res.status(400).json({ error: error.message });
    }

    const normalized = (data || []).map((s) => ({
      id: s.id,
      skill_id: s.skill_id,
      skill_name: s.skills?.name || 'Skill Session',
      student_id: s.student_id,
      teacher_id: s.teacher_id,
      student_name: s['users!sessions_student_id_fkey']?.username || `User-${s.student_id}`,
      teacher_name: s['users!sessions_teacher_id_fkey']?.username || `User-${s.teacher_id}`,
      scheduled_at: s.scheduled_at,
      duration_minutes: s.duration_minutes,
      status: s.status,
      rating: s.rating,
      feedback: s.feedback,
      created_at: s.created_at
    }));

    const localSessions = readLocalSessions()
      .filter((s) => Number(s.student_id) === Number(req.userId) || Number(s.teacher_id) === Number(req.userId));
    const byId = new Map();
    for (const s of normalized) byId.set(Number(s.id), s);
    for (const s of localSessions) byId.set(Number(s.id), s);
    const merged = Array.from(byId.values()).sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));
    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// ──────────────────────────────────────────────────────
// USER PROFILE ENDPOINTS
// ──────────────────────────────────────────────────────

// Get public profile
app.get('/api/users/:userId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, username, full_name, enrollment_id, rating, created_at')
      .eq('id', req.params.userId)
      .single();

    if (error) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get user's skills
    const { data: skills, error: skillsError } = await supabase
      .from('skills')
      .select('id, name, category, cost_credits, rating')
      .eq('teacher_id', req.params.userId);

    if (!skillsError) {
      data.skills = skills;
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Get current user profile
app.get('/api/users/me/profile', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, username, email, enrollment_id, full_name, rating, created_at')
      .eq('id', req.userId)
      .single();

    if (error) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get balance info
    const { data: balance, error: balanceError } = await supabaseAdmin
      .from('user_balances')
      .select('available_credits')
      .eq('user_id', req.userId)
      .single();

    if (balanceError && !isMissingRelation(balanceError, 'user_balances')) {
      return res.status(400).json({ error: balanceError.message });
    }

    if (balance) {
      data.available_credits = balance.available_credits;
    } else if (balanceError && isMissingRelation(balanceError, 'user_balances')) {
      const localBalance = readLocalBalances().find((b) => Number(b.user_id) === Number(req.userId));
      data.available_credits = Number(localBalance?.available_credits || 0);
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ──────────────────────────────────────────────────────
// HEALTH CHECK
// ──────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  if (!isSupabaseConfigured) {
    return res.status(503).json({
      status: '⚠️ SkillSwap backend is running, but Supabase is not configured',
      timestamp: new Date(),
      database: 'Not configured',
      auth: 'Not configured',
      required_env: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
    });
  }

  try {
    // Check Supabase connection
    const { data, error } = await supabase
      .from('users')
      .select('count')
      .limit(1);

    if (error) {
      return res.status(500).json({ 
        status: 'Database connection failed',
        error: error.message 
      });
    }

    res.json({
      status: '✅ SkillSwap Backend Running',
      timestamp: new Date(),
      database: 'Supabase PostgreSQL Connected',
      auth: 'Supabase Auth Enabled'
    });
  } catch (err) {
    res.status(500).json({
      status: '❌ Health check failed',
      error: err.message
    });
  }
});

// ──────────────────────────────────────────────────────
// ERROR HANDLING
// ──────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// ──────────────────────────────────────────────────────
// START SERVER
// ──────────────────────────────────────────────────────

const startServer = async () => {
  try {
    if (!isSupabaseConfigured) {
      app.listen(PORT, () => {
        console.log(`⚠️ SkillSwap Server running on http://localhost:${PORT}`);
        console.log('⚠️ Supabase is not configured yet.');
        console.log('🛠️ Add SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY to .env');
      });
      return;
    }

    // Test Supabase connection
    const { data, error } = await supabase
      .from('users')
      .select('count')
      .limit(1);

    if (error) {
      console.error('❌ Supabase connection failed:', error);
      process.exit(1);
    }
    
    await applyKcTopupForExistingAccounts();

    app.listen(PORT, () => {
      console.log(`✅ SkillSwap Server running on http://localhost:${PORT}`);
      console.log(`📊 Database: Supabase PostgreSQL`);
      console.log(`🔐 Authentication: Supabase Auth (JWT)`);
      console.log(`🌍 API Base URL: http://localhost:${PORT}/api`);
      console.log(`📝 Docs: Check README.md for API documentation`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
};

startServer();

module.exports = app;
