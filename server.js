const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const dotenv = require('dotenv');
dotenv.config();
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

const usersFilePath = path.resolve(__dirname, 'database', 'users.json');
const messagesFilePath = path.resolve(__dirname, 'database', 'messages.json');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_here'; // Use env variable

// Load users from file asynchronously
async function loadUsers() {
  try {
    const data = await fs.readFile(usersFilePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Failed to load users:', err);
    return {};
  }
}

// Save users to file asynchronously
async function saveUsers(users) {
  try {
    await fs.writeFile(usersFilePath, JSON.stringify(users, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save users:', err);
  }
}

// Load messages from file asynchronously
async function loadMessages() {
  try {
    const data = await fs.readFile(messagesFilePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Failed to load messages:', err);
    return {};
  }
}

// Save messages to file asynchronously
async function saveMessages(messages) {
  try {
    await fs.writeFile(messagesFilePath, JSON.stringify(messages, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save messages:', err);
  }
}

let users = {};
let messages = {};

function getChatKey(user1, user2) {
  return [user1, user2].sort().join('|');
}

async function initializeData() {
  users = await loadUsers();
  messages = await loadMessages();
}

initializeData().catch(err => {
  console.error('Failed to initialize data:', err);
});

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

const rateLimit = require('express-rate-limit');

// Apply rate limiting to all requests
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // increased limit to 200 requests per windowMs
  message: { error: 'Too many requests, please try again later.' }
});
app.use(limiter);

// Input validation middleware example
const { body, validationResult, query, param } = require('express-validator');

app.post('/register',
  body('username').isAlphanumeric().isLength({ min: 3, max: 20 }),
  body('password').isLength({ min: 6 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid input', details: errors.array() });
    }
    const { username, password } = req.body;
    if (users[username]) return res.status(409).json({ error: 'Username already taken' });
    try {
      const passwordHash = await bcrypt.hash(password, 10);
      users[username] = { passwordHash };
      await saveUsers(users);
      res.json({ success: true });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

app.post('/login',
  body('username').isAlphanumeric().isLength({ min: 3, max: 20 }),
  body('password').isLength({ min: 6 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid input', details: errors.array() });
    }
    const { username, password } = req.body;
    const user = users[username];
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });
    try {
      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) return res.status(401).json({ error: 'Invalid username or password' });
      const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '12h' });
      res.json({ success: true, token, username });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

// Search users endpoint (authenticated)
app.get('/search-users', authenticateToken, (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const results = Object.keys(users).filter(u => u.toLowerCase().includes(q));
  res.json({ users: results });
});

// Get message history between two users (authenticated)
app.get('/messages/:withUser', authenticateToken, (req, res) => {
  const user1 = req.user.username;
  const user2 = req.params.withUser;
  const key = getChatKey(user1, user2);
  const chatMessages = messages[key] || [];

  // Mark messages as read by user1
  chatMessages.forEach(msg => {
    if (!msg.readBy) msg.readBy = [];
    if (!msg.readBy.includes(user1)) {
      msg.readBy.push(user1);
    }
  });
  saveMessages(messages);

  // Filter out deleted messages
  const filteredMessages = chatMessages.filter(msg => !msg.deleted);

  res.json({ messages: filteredMessages });
});

// Socket.io connection and messaging
let onlineUsers = new Map(); // username -> socket.id

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Authentication error"));
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return next(new Error("Authentication error"));
    socket.user = user;
    next();
  });
});

io.on('connection', (socket) => {
  const username = socket.user.username;
  onlineUsers.set(username, socket.id);
  io.emit('user-online', username);

  socket.on('private message', (data) => {
    const { to, message } = data;
    if (!to || !message) return;
    const from = username;
    const timestamp = new Date().toISOString();
    const key = getChatKey(from, to);
    if (!messages[key]) messages[key] = [];
    messages[key].push({ from, to, message, timestamp, readBy: [from], reactions: {}, deleted: false });
    saveMessages(messages);

    // Schedule automatic deletion after 5 minutes (300000 ms)
    setTimeout(() => {
      const chatMessages = messages[key] || [];
      const msg = chatMessages.find(m => m.timestamp === timestamp && !m.deleted);
      if (msg) {
        msg.deleted = true;
        saveMessages(messages);
        // Notify both users about message deletion
        const toSocketId = onlineUsers.get(to);
        if (toSocketId) {
          io.to(toSocketId).emit('message deleted', { from: msg.from, to: msg.to, timestamp });
        }
        io.to(socket.id).emit('message deleted', { from: msg.from, to: msg.to, timestamp });
      }
    }, 300000); // 5 minutes

    const toSocketId = onlineUsers.get(to);
    if (toSocketId) {
      io.to(toSocketId).emit('private message', { from, message, timestamp });
    }
    // Also emit to sender for confirmation
    socket.emit('private message', { from, message, timestamp });
  });

  // Typing indicator events
  socket.on('typing', (data) => {
    const { toUser } = data;
    const from = username;
    const toSocketId = onlineUsers.get(toUser);
    if (toSocketId) {
      io.to(toSocketId).emit('typing', { from });
    }
  });

  socket.on('stop typing', (data) => {
    const { toUser } = data;
    const from = username;
    const toSocketId = onlineUsers.get(toUser);
    if (toSocketId) {
      io.to(toSocketId).emit('stop typing', { from });
    }
  });

  // Add reaction to a message
  socket.on('add reaction', (data) => {
    const { toUser, timestamp, emoji } = data;
    const from = username;
    const key = getChatKey(from, toUser);
    const chatMessages = messages[key] || [];
    const msg = chatMessages.find(m => m.timestamp === timestamp && !m.deleted);
    if (msg) {
      if (!msg.reactions) msg.reactions = {};
      if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
      if (!msg.reactions[emoji].includes(from)) {
        msg.reactions[emoji].push(from);
        saveMessages(messages);
        // Notify both users about reaction update
        const toSocketId = onlineUsers.get(toUser);
        if (toSocketId) {
          io.to(toSocketId).emit('reaction updated', { from: msg.from, to: msg.to, timestamp, reactions: msg.reactions });
        }
        io.to(socket.id).emit('reaction updated', { from: msg.from, to: msg.to, timestamp, reactions: msg.reactions });
      }
    }
  });

  // Remove reaction from a message
  socket.on('remove reaction', (data) => {
    const { toUser, timestamp, emoji } = data;
    const from = username;
    const key = getChatKey(from, toUser);
    const chatMessages = messages[key] || [];
    const msg = chatMessages.find(m => m.timestamp === timestamp && !m.deleted);
    if (msg && msg.reactions && msg.reactions[emoji]) {
      const index = msg.reactions[emoji].indexOf(from);
      if (index !== -1) {
        msg.reactions[emoji].splice(index, 1);
        if (msg.reactions[emoji].length === 0) {
          delete msg.reactions[emoji];
        }
        saveMessages(messages);
        // Notify both users about reaction update
        const toSocketId = onlineUsers.get(toUser);
        if (toSocketId) {
          io.to(toSocketId).emit('reaction updated', { from: msg.from, to: msg.to, timestamp, reactions: msg.reactions });
        }
        io.to(socket.id).emit('reaction updated', { from: msg.from, to: msg.to, timestamp, reactions: msg.reactions });
      }
    }
  });

  // Delete a message
  socket.on('delete message', (data) => {
    const { toUser, timestamp } = data;
    const from = username;
    const key = getChatKey(from, toUser);
    const chatMessages = messages[key] || [];
    const msg = chatMessages.find(m => m.timestamp === timestamp && !m.deleted);
    if (msg && msg.from === from) {
      msg.deleted = true;
      saveMessages(messages);
      // Notify both users about message deletion
      const toSocketId = onlineUsers.get(toUser);
      if (toSocketId) {
        io.to(toSocketId).emit('message deleted', { from: msg.from, to: msg.to, timestamp });
      }
      io.to(socket.id).emit('message deleted', { from: msg.from, to: msg.to, timestamp });
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(username);
    io.emit('user-offline', username);
  });
});

const PORT = process.env.PORT || 3000;

// New endpoint to get inbox/conversations for user
app.get('/inbox', authenticateToken, (req, res) => {
  const username = req.user.username;
  const inbox = [];

  for (const key in messages) {
    if (key.includes(username)) {
      const chatMessages = messages[key];
      const otherUser = key.split('|').find(u => u !== username);
      if (!otherUser) continue;

      // Count unread messages for this user
      const unreadCount = chatMessages.reduce((count, msg) => {
        if (msg.to === username && (!msg.readBy || !msg.readBy.includes(username)) && !msg.deleted) {
          return count + 1;
        }
        return count;
      }, 0);

      // Get last message
      const lastMessage = [...chatMessages].reverse().find(m => !m.deleted);

      inbox.push({
        user: otherUser,
        lastMessage: lastMessage ? lastMessage.message : '',
        lastTimestamp: lastMessage ? lastMessage.timestamp : null,
        unreadCount
      });
    }
  }

  // Sort inbox by lastTimestamp descending
  inbox.sort((a, b) => (b.lastTimestamp || '').localeCompare(a.lastTimestamp || ''));

  res.json({ inbox });
});

server.listen(PORT, () => {
  console.log(`WorldSecretMessenger server listening on port ${PORT}`);
});
