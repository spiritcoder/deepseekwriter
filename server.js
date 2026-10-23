import express from 'express';
import expressLayouts from 'express-ejs-layouts';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

import apiRoutes from './routes/api.js';
import webRoutes from './routes/web.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8086;

// Ensure storage and upload directories exist
const imagesDir = path.join(__dirname, 'storage', 'images');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Static assets
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(imagesDir));

// View engine
app.use(expressLayouts);
app.set('layout', 'layout');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

import { backlogRepo, folderRepo } from './db/database.js';

// Global template variables middleware
app.use((req, res, next) => {
  try {
    const stats = backlogRepo.getStats();
    res.locals.backlogPendingCount = stats ? (stats.planned || 0) : 0;
    res.locals.backlogStats = stats;
  } catch (e) {
    res.locals.backlogPendingCount = 0;
    res.locals.backlogStats = { total: 0, planned: 0, writing: 0, completed: 0 };
  }
  next();
});

// Routes
app.use('/api', apiRoutes);
app.use('/', webRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).render('index', {
    title: '404 Not Found - DeepSeek Writer',
    folders: [],
    stats: { total: 0, published: 0, drafts: 0, inReview: 0, totalWords: 0 },
    articles: [],
    activeFolder: null,
    currentStatus: 'all',
    searchQuery: '',
    errorMessage: 'Page not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
});

import db from './db/database.js';

const server = app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 DeepSeek Writer Studio is running on:`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});

// Graceful shutdown handling for Docker & local terminal
const shutdown = () => {
  console.log('\n[Server] Shutting down gracefully...');
  server.close(() => {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      console.log('[Server] SQLite database synced and closed cleanly.');
    } catch (err) {
      console.warn('[Server] Error closing database:', err.message);
    }
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
