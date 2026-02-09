require('dotenv').config();
const Y = require('yjs');
const { MongodbPersistence } = require('y-mongodb-provider');
const { createClient } = require('redis');
const http = require('http');
const WebSocket = require('ws');
const { setupWSConnection } = require('./yjs-server');

const PORT = process.env.WS_PORT || 1234;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/texlyre';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

console.log('Starting TeXlyre Yjs Server...');
console.log('MongoDB URI:', MONGODB_URI.replace(/\/\/.*:.*@/, '//***:***@'));
console.log('Redis URL:', REDIS_URL.replace(/\/\/.*:.*@/, '//***:***@'));

// Initialize MongoDB persistence
const mdb = new MongodbPersistence(MONGODB_URI, {
  flushSize: parseInt(process.env.MONGODB_FLUSH_SIZE) || 100,
  multipleCollections: process.env.MONGODB_MULTIPLE_COLLECTIONS === 'true',
});

console.log('✓ MongoDB persistence initialized');

// Initialize Redis cache
let redisClient = null;
if (process.env.REDIS_CACHE_ENABLED === 'true') {
  redisClient = createClient({ 
    url: REDIS_URL,
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          console.error('Redis: Too many reconnection attempts');
          return new Error('Too many retries');
        }
        return Math.min(retries * 500, 3000);
      }
    }
  });
  
  redisClient.on('error', (err) => console.error('Redis Client Error:', err));
  redisClient.on('connect', () => console.log('✓ Redis cache connecting...'));
  redisClient.on('ready', () => console.log('✓ Redis cache ready'));
  redisClient.on('reconnecting', () => console.log('⚠ Redis cache reconnecting...'));
  
  redisClient.connect().catch((err) => {
    console.error('Failed to connect to Redis:', err);
    console.log('⚠ Continuing without Redis cache');
    redisClient = null;
  });
}

// Create HTTP server
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('TeXlyre Yjs WebSocket Server\n');
});

// Create WebSocket server
const wss = new WebSocket.Server({ 
  server,
  perMessageDeflate: {
    zlibDeflateOptions: {
      chunkSize: 1024,
      memLevel: 7,
      level: 3
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024
    },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    serverMaxWindowBits: 10,
    concurrencyLimit: 10,
    threshold: 1024
  }
});

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`New connection from ${ip}`);
  
  setupWSConnection(ws, req, { 
    persistence: mdb,
    redis: redisClient,
  });
});

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`${signal} received, closing server...`);
  
  wss.clients.forEach((client) => {
    client.close();
  });
  
  wss.close();
  
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
  }
  
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   TeXlyre Yjs Server Running           ║
╠════════════════════════════════════════╣
║   Port: ${PORT.toString().padEnd(30)}║
║   MongoDB: ${mdb ? 'Connected'.padEnd(27) : 'Disabled'.padEnd(27)}║
║   Redis: ${redisClient ? 'Connected'.padEnd(29) : 'Disabled'.padEnd(29)}║
╚════════════════════════════════════════╝
  `);
});
