const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  pingInterval: 25000,
  pingTimeout: 20000
});
const PORT = Number(process.env.PORT) || 3000;
const production = process.env.NODE_ENV === 'production';
const secret = process.env.SESSION_SECRET || (!production ? 'dev-only-change-this-session-secret-playspace' : null);
if (!secret) throw new Error('SESSION_SECRET é obrigatório em produção.');

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '8kb' }));

let mongoClient = null;
let db = null;
let mongoStatus = 'não configurado';
const memoryUsers = new Map();
const memoryWorlds = new Map();

const sessionOptions = {
  secret,
  resave: false,
  saveUninitialized: false,
  name: 'playspace.sid',
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: production,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
};
if (process.env.MONGODB_URI) {
  mongoClient = new MongoClient(process.env.MONGODB_URI);
  const store = MongoStore.create({
    client: mongoClient,
    collectionName: 'sessions',
    ttl: 60 * 60 * 24 * 7
  });
  sessionOptions.store = store;
}
const sessionMiddleware = session(sessionOptions);
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));

function usersCollection() { return db?.collection('users'); }
function worldsCollection() { return db?.collection('worlds'); }
function publicUser(user) {
  return user ? { id: String(user._id || user.id), username: user.username, avatar: user.avatar || '🧭' } : null;
}
async function findUserByName(username) {
  if (usersCollection()) return usersCollection().findOne({ username });
  return memoryUsers.get(username) || null;
}
async function saveUser(user) {
  if (usersCollection()) await usersCollection().insertOne(user);
  else memoryUsers.set(user.username, user);
}
async function getWorld(room) {
  if (worldsCollection()) return worldsCollection().findOne({ room });
  return memoryWorlds.get(room) || null;
}
async function persistWorld(room, blocks) {
  const doc = { room, blocks: Array.from(blocks.values()), updatedAt: new Date() };
  if (worldsCollection()) await worldsCollection().updateOne({ room }, { $set: doc }, { upsert: true });
  else memoryWorlds.set(room, doc);
}

app.get('/api/status', (_req, res) => res.json({
  ok: true,
  database: mongoStatus,
  persistence: db ? 'MongoDB Atlas' : 'memória temporária (reiniciar apaga dados)',
  multiplayer: 'Socket.IO ativo'
}));

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!/^[a-zA-Z0-9_]{3,18}$/.test(username)) return res.status(400).json({ error: 'Nome: 3–18 caracteres, letras, números ou _.' });
    if (password.length < 8 || password.length > 72) return res.status(400).json({ error: 'A senha deve ter entre 8 e 72 caracteres.' });
    if (await findUserByName(username)) return res.status(409).json({ error: 'Esse nome já está em uso.' });
    const user = { _id: crypto.randomUUID(), username, passwordHash: await bcrypt.hash(password, 12), avatar: '🧭', createdAt: new Date() };
    await saveUser(user);
    req.session.user = publicUser(user);
    res.status(201).json({ user: req.session.user, warning: db ? null : 'Conta temporária: configure MONGODB_URI para persistir.' });
  } catch (err) { next(err); }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const user = await findUserByName(username);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    req.session.user = publicUser(user);
    res.json({ user: req.session.user, warning: db ? null : 'Sessão/conta em memória temporária.' });
  } catch (err) { next(err); }
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => {
  res.clearCookie('playspace.sid');
  res.json({ ok: true });
}));
app.get('/api/me', (req, res) => res.json({ user: req.session.user || null }));

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Faça login para continuar.' });
  next();
}
app.patch('/api/profile', requireAuth, async (req, res, next) => {
  try {
    const avatar = String(req.body.avatar || '🧭').slice(0, 8);
    if (usersCollection()) await usersCollection().updateOne({ username: req.session.user.username }, { $set: { avatar } });
    else {
      const u = memoryUsers.get(req.session.user.username);
      if (u) u.avatar = avatar;
    }
    req.session.user.avatar = avatar;
    res.json({ user: req.session.user });
  } catch (e) { next(e); }
});

const rooms = new Map();
const MAX_BLOCKS_PER_ROOM = 4000;
const validBlock = b => b && Number.isInteger(b.x) && Number.isInteger(b.y) && Number.isInteger(b.z)
  && Math.abs(b.x) <= 128 && b.y >= -8 && b.y <= 80 && Math.abs(b.z) <= 128
  && ['dirt', 'grass', 'stone', 'wood', 'leaves'].includes(b.type);
function roomState(room) {
  if (!rooms.has(room)) rooms.set(room, { blocks: new Map(), players: new Map(), lastSaved: 0 });
  return rooms.get(room);
}
async function loadRoom(room) {
  const state = roomState(room);
  if (state.blocks.size) return state;
  const saved = await getWorld(room);
  if (saved?.blocks) for (const b of saved.blocks) if (validBlock(b)) state.blocks.set(`${b.x},${b.y},${b.z}`, b);
  return state;
}
const safeRoom = v => /^[a-zA-Z0-9_-]{1,32}$/.test(v || '') ? v : 'wildlands-public';

io.on('connection', socket => {
  const user = socket.request.session?.user;
  socket.emit('server:hello', { authenticated: !!user, user });
  socket.on('world:join', async payload => {
    try {
      const room = safeRoom(String(payload?.room || 'wildlands-public'));
      const state = await loadRoom(room);
      for (const oldRoom of socket.rooms) if (oldRoom.startsWith('world:')) socket.leave(oldRoom);
      socket.join(`world:${room}`);
      socket.data.room = room;
      const player = {
        id: socket.id,
        username: user?.username || `Visitante-${socket.id.slice(0, 4)}`,
        avatar: user?.avatar || '🧭',
        x: 0, y: 3, z: 0, rotation: 0
      };
      state.players.set(socket.id, player);
      socket.emit('world:state', { blocks: Array.from(state.blocks.values()), players: Array.from(state.players.values()) });
      socket.to(`world:${room}`).emit('player:joined', player);
    } catch { socket.emit('server:error', { message: 'Não foi possível entrar no mundo.' }); }
  });
  socket.on('player:move', data => {
    const room = socket.data.room; if (!room) return;
    const state = roomState(room);
    const p = state.players.get(socket.id); if (!p) return;
    const now = Date.now();
    if (now - (socket.data.lastMove || 0) < 40) return;
    socket.data.lastMove = now;
    const x = Number(data?.x), y = Number(data?.y), z = Number(data?.z), rotation = Number(data?.rotation);
    if (![x,y,z,rotation].every(Number.isFinite) || Math.abs(x)>128 || Math.abs(z)>128 || y < -8 || y > 80) return;
    Object.assign(p, { x, y, z, rotation });
    socket.to(`world:${room}`).volatile.emit('player:moved', p);
  });
  socket.on('block:change', async data => {
    const room = socket.data.room; if (!room) return;
    const state = roomState(room);
    if (Date.now() - (socket.data.lastBlock || 0) < 120) return;
    socket.data.lastBlock = Date.now();
    const b = data?.block;
    if (!validBlock(b) || !['place','remove'].includes(data?.action)) return;
    const p = state.players.get(socket.id); if (!p) return;
    const distance = Math.hypot(p.x - (b.x + .5), p.y - (b.y + .5), p.z - (b.z + .5));
    if (distance > 7) return;
    const key = `${b.x},${b.y},${b.z}`;
    if (data.action === 'place') {
      if (state.blocks.size >= MAX_BLOCKS_PER_ROOM || state.blocks.has(key)) return;
      state.blocks.set(key, b);
    } else {
      if (!state.blocks.has(key)) return;
      state.blocks.delete(key);
    }
    io.to(`world:${room}`).emit('block:changed', { action: data.action, block: b });
    if (Date.now() - state.lastSaved > 5000) {
      state.lastSaved = Date.now();
      try { await persistWorld(room, state.blocks); } catch { socket.emit('server:error', { message: 'Falha ao salvar mundo.' }); }
    }
  });
  socket.on('chat:send', data => {
    const room = socket.data.room; if (!room) return;
    const message = String(data?.message || '').trim().slice(0, 180);
    if (!message || Date.now() - (socket.data.lastChat || 0) < 700) return;
    socket.data.lastChat = Date.now();
    io.to(`world:${room}`).emit('chat:message', {
      username: user?.username || 'Visitante', message, at: Date.now()
    });
  });
  socket.on('disconnect', () => {
    const room = socket.data.room; if (!room) return;
    const state = roomState(room);
    state.players.delete(socket.id);
    socket.to(`world:${room}`).emit('player:left', { id: socket.id });
  });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Rota não encontrada.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'), err => err && next(err));
});
app.use((err, _req, res, _next) => {
  console.error('Erro interno:', err.message);
  res.status(500).json({ error: 'Erro interno. Consulte os logs do servidor.' });
});

async function start() {
  if (mongoClient) {
    try {
      await mongoClient.connect();
      db = mongoClient.db();
      await db.collection('users').createIndex({ username: 1 }, { unique: true });
      await db.collection('worlds').createIndex({ room: 1 }, { unique: true });
      mongoStatus = 'conectado';
    } catch (e) {
      mongoStatus = 'falha na conexão';
      console.error('MongoDB não conectou:', e.message);
      if (production) throw e;
    }
  }
  server.listen(PORT, '0.0.0.0', () => console.log(`PlaySpace ativo em 0.0.0.0:${PORT} | MongoDB: ${mongoStatus}`));
}
if (require.main === module) start().catch(err => { console.error(err); process.exit(1); });
module.exports = { app, server, validBlock, safeRoom };
