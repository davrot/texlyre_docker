// Wait for replica set to be ready
let rsStatus;
let attempts = 0;
const maxAttempts = 30;

while (attempts < maxAttempts) {
  try {
    rsStatus = rs.status();
    if (rsStatus.ok === 1) {
      print('✓ Replica set is ready');
      break;
    }
  } catch (e) {
    print(`Waiting for replica set... (${attempts + 1}/${maxAttempts})`);
    sleep(1000);
  }
  attempts++;
}

if (attempts >= maxAttempts) {
  print('✗ Failed to connect to replica set');
  quit(1);
}

// Switch to texlyre database
db = db.getSiblingDB('texlyre');

// Create collections with indexes for Yjs
db.createCollection('documents');
db.documents.createIndex({ docName: 1 }, { unique: true });
db.documents.createIndex({ lastModified: -1 });
db.documents.createIndex({ lastAccessed: 1 }, { 
  expireAfterSeconds: 7776000  // 90 days TTL for old documents
});

// Collection for Yjs updates (y-mongodb creates this, but we can optimize it)
db.createCollection('updates');
db.updates.createIndex({ docName: 1, version: 1 });
db.updates.createIndex({ docName: 1, clock: 1 });

// User metadata (optional, for future features)
db.createCollection('users');
db.users.createIndex({ userId: 1 }, { unique: true });

// Project metadata
db.createCollection('projects');
db.projects.createIndex({ projectId: 1 }, { unique: true });
db.projects.createIndex({ owner: 1 });
db.projects.createIndex({ createdAt: -1 });

print('✓ TeXlyre database initialized with collections and indexes');

