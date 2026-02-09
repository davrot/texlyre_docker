const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
const map = require('lib0/map');

const CALLBACK_DEBOUNCE_WAIT = 2000;
const CALLBACK_DEBOUNCE_MAXWAIT = 10000;
const REDIS_CACHE_TTL = parseInt(process.env.REDIS_CACHE_TTL) || 3600;

const docs = new Map();
const messageHandlers = [];

// Simple debounce implementation
const debounce = (func, wait, options = {}) => {
  let timeout;
  let lastCallTime = 0;
  const maxWait = options.maxWait || wait;
  
  const debounced = function(...args) {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;
    
    clearTimeout(timeout);
    
    if (timeSinceLastCall >= maxWait) {
      lastCallTime = now;
      func.apply(this, args);
    } else {
      timeout = setTimeout(() => {
        lastCallTime = Date.now();
        func.apply(this, args);
      }, wait);
    }
  };
  
  debounced.flush = function() {
    clearTimeout(timeout);
    func.apply(this, []);
  };
  
  return debounced;
};

const getYDoc = (docName, gc = true) => {
  return map.setIfUndefined(docs, docName, () => {
    const doc = new Y.Doc({ gc });
    return doc;
  });
};

const persistDoc = async (docName, ydoc, persistence, redis) => {
  try {
    // Save to MongoDB
    const state = Y.encodeStateAsUpdate(ydoc);
    await persistence.storeUpdate(docName, state);
    console.log(`[MongoDB] Persisted ${docName} (${state.length} bytes)`);
    
    // Update Redis cache
    if (redis && redis.isOpen) {
      try {
        const stateB64 = Buffer.from(state).toString('base64');
        await redis.setEx(`yjs:doc:${docName}`, REDIS_CACHE_TTL, stateB64);
        console.log(`[Redis] Cached ${docName}`);
      } catch (error) {
        console.error(`[Redis] Cache error for ${docName}:`, error.message);
      }
    }
  } catch (error) {
    console.error(`[Persistence] Error saving ${docName}:`, error);
  }
};

const setupWSConnection = (conn, req, { persistence, redis }) => {
  conn.binaryType = 'arraybuffer';
  
  // Parse document name from URL
  const docName = req.url.slice(1).split('?')[0];

  if (!docName || docName === '' || docName === 'favicon.ico') {
    conn.close();
    return;
  }
  
  if (!docName) {
    console.error('No document name provided');
    conn.close();
    return;
  }
  
  const doc = getYDoc(docName);
  doc.gc = true;
  
  // Load document state
  (async () => {
    try {
      // Try Redis cache first
      if (redis && redis.isOpen) {
        try {
          const cached = await redis.get(`yjs:doc:${docName}`);
          if (cached) {
            const state = Buffer.from(cached, 'base64');
            Y.applyUpdate(doc, state);
            console.log(`[Redis] Loaded ${docName} from cache (${state.length} bytes)`);
            return;
          }
        } catch (error) {
          console.error(`[Redis] Load error for ${docName}:`, error.message);
        }
      }
      
      // Fallback to MongoDB
      const persistedYdoc = await persistence.getYDoc(docName);
      const persistedState = Y.encodeStateAsUpdate(persistedYdoc);
      
      if (persistedState.length > 0) {
        Y.applyUpdate(doc, persistedState);
        console.log(`[MongoDB] Loaded ${docName} (${persistedState.length} bytes)`);
        
        // Cache in Redis for next time
        if (redis && redis.isOpen) {
          const stateB64 = Buffer.from(persistedState).toString('base64');
          await redis.setEx(`yjs:doc:${docName}`, REDIS_CACHE_TTL, stateB64);
          console.log(`[Redis] Cached ${docName} from MongoDB`);
        }
      } else {
        console.log(`[MongoDB] New document: ${docName}`);
      }
    } catch (error) {
      console.error(`[Load] Error loading ${docName}:`, error);
    }
  })();

  // Debounced persistence
  const debouncedPersist = debounce(
    () => persistDoc(docName, doc, persistence, redis),
    CALLBACK_DEBOUNCE_WAIT,
    { maxWait: CALLBACK_DEBOUNCE_MAXWAIT }
  );

  const updateHandler = (update, origin) => {
    if (origin !== conn) {
      debouncedPersist();
    }
  };

  doc.on('update', updateHandler);

  // Send sync step 1
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0); // Message type: sync
  syncProtocol.writeSyncStep1(encoder, doc);
  conn.send(encoding.toUint8Array(encoder));

  const awarenessStates = new Map();
  const awareness = new awarenessProtocol.Awareness(doc);

  conn.on('message', (message) => {
    try {
      const encoder = encoding.createEncoder();
      const decoder = decoding.createDecoder(new Uint8Array(message));
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case 0: // Sync
          encoding.writeVarUint(encoder, 0);
          syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
          if (encoding.length(encoder) > 1) {
            conn.send(encoding.toUint8Array(encoder));
          }
          break;
          
        case 1: // Awareness
          awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), conn);
          break;
          
        default:
          console.warn(`Unknown message type: ${messageType}`);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  conn.on('close', () => {
    doc.off('update', updateHandler);
    debouncedPersist.flush(); // Save any pending changes
    awareness.destroy();
    console.log(`Connection closed for ${docName}`);
    
    // Clean up if no more connections
    setTimeout(() => {
      if (doc.conns && doc.conns.size === 0) {
        docs.delete(docName);
        console.log(`Document ${docName} removed from memory`);
      }
    }, 30000); // Wait 30 seconds before cleanup
  });

  conn.on('error', (error) => {
    console.error(`WebSocket error for ${docName}:`, error);
  });
};

module.exports = { setupWSConnection };

