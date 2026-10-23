import express from 'express';
import db, { articleRepo, folderRepo, backlogRepo } from '../db/database.js';
import { marked } from 'marked';

const router = express.Router();

marked.setOptions({
  gfm: true,
  breaks: true
});

// Planned Titles & Content Queue Backlog
router.get('/backlog', (req, res) => {
  try {
    const { folder, status, priority, q, page: pageParam, limit: limitParam } = req.query;
    const folders = folderRepo.getAll();
    const stats = backlogRepo.getStats();

    let folderId = null;
    let activeFolder = null;
    if (folder) {
      if (folder === 'uncategorized') {
        folderId = 'uncategorized';
        activeFolder = { name: 'Uncategorized', color: '#64748b', slug: 'uncategorized' };
      } else {
        const found = folders.find(f => f.slug === folder || f.id == folder);
        if (found) {
          activeFolder = found;
          folderId = found.id;
        }
      }
    }

    const allItems = backlogRepo.getAll({
      folderId,
      status: status || 'all',
      priority: priority || 'all',
      search: q || ''
    });

    const page = Math.max(1, parseInt(pageParam) || 1);
    const limit = Math.max(5, Math.min(100, parseInt(limitParam) || 20));
    const totalItems = allItems.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const currentPage = Math.min(page, totalPages);
    const startIndex = (currentPage - 1) * limit;
    const paginatedItems = allItems.slice(startIndex, startIndex + limit);

    const uncategorizedTotal = backlogRepo.getUncategorizedCount();

    res.render('backlog', {
      title: 'Planned Titles - DeepSeek Writer',
      items: paginatedItems,
      totalItems,
      uncategorizedTotal,
      currentPage,
      totalPages,
      limit,
      startIndex: totalItems > 0 ? startIndex + 1 : 0,
      endIndex: Math.min(startIndex + limit, totalItems),
      stats,
      folders,
      activeFolder,
      currentStatus: status || 'all',
      currentPriority: priority || 'all',
      searchQuery: q || '',
      currentFolderParam: folder || ''
    });
  } catch (err) {
    console.error('Backlog web route error:', err);
    res.status(500).send('Error loading backlog: ' + err.message);
  }
});

// Dashboard
router.get('/', (req, res) => {
  try {
    const { folder, status, q, page: pageParam, limit: limitParam } = req.query;
    const folders = folderRepo.getAll();
    const stats = articleRepo.getStats();

    let activeFolder = null;
    let folderId = null;
    if (folder) {
      if (folder === 'uncategorized') {
        folderId = 'uncategorized';
        activeFolder = { name: 'Uncategorized', color: '#64748b', slug: 'uncategorized' };
      } else {
        const found = folders.find(f => f.slug === folder || f.id == folder);
        if (found) {
          activeFolder = found;
          folderId = found.id;
        }
      }
    }

    const allArticles = articleRepo.getAll({
      folderId,
      status: status || 'all',
      search: q || ''
    });

    const page = Math.max(1, parseInt(pageParam) || 1);
    const limit = Math.max(6, Math.min(60, parseInt(limitParam) || 12));
    const totalArticles = allArticles.length;
    const totalPages = Math.max(1, Math.ceil(totalArticles / limit));
    const currentPage = Math.min(page, totalPages);
    const startIndex = (currentPage - 1) * limit;
    const paginatedArticles = allArticles.slice(startIndex, startIndex + limit);

    res.render('index', {
      title: 'Dashboard - DeepSeek Writer',
      folders,
      stats,
      articles: paginatedArticles,
      totalArticles,
      currentPage,
      totalPages,
      limit,
      startIndex: totalArticles > 0 ? startIndex + 1 : 0,
      endIndex: Math.min(startIndex + limit, totalArticles),
      activeFolder,
      currentStatus: status || 'all',
      searchQuery: q || '',
      currentFolderParam: folder || ''
    });
  } catch (err) {
    console.error('Web route error:', err);
    res.status(500).send('Error loading dashboard: ' + err.message);
  }
});

// Editor - New Article
router.get('/editor/new', (req, res) => {
  try {
    const folders = folderRepo.getAll();
    const folderIdParam = req.query.folderId || req.query.folder_id || null;
    const backlogId = req.query.backlog_id || req.query.backlogId || null;

    let prefill = null;
    let selectedFolderId = folderIdParam;

    if (backlogId) {
      const backlog = backlogRepo.getById(backlogId);
      if (backlog) {
        selectedFolderId = backlog.folder_id || selectedFolderId;
        prefill = {
          title: backlog.title,
          topic: backlog.topic || backlog.title,
          region: backlog.region || '',
          folder_id: backlog.folder_id,
          content_markdown: `# ${backlog.title}\n\n`
        };
      }
    }

    res.render('editor', {
      title: 'New Article Studio - DeepSeek Writer',
      article: prefill,
      folders,
      selectedFolderId,
      isNew: true
    });
  } catch (err) {
    res.status(500).send('Error opening editor: ' + err.message);
  }
});

// Editor - Edit Article
router.get('/editor/:id', (req, res) => {
  try {
    let article = articleRepo.getById(req.params.id);
    if (!article) {
      return res.status(404).send('Article not found');
    }

    // Auto-sync category from linked backlog item if backlog was classified by AI or updated!
    const linkedBacklog = db.prepare('SELECT * FROM title_backlog WHERE article_id = ?').get(article.id);
    if (linkedBacklog && linkedBacklog.folder_id && (!article.folder_id || article.folder_id !== linkedBacklog.folder_id)) {
      articleRepo.update(article.id, { folder_id: linkedBacklog.folder_id });
      article = articleRepo.getById(article.id);
    }

    const folders = folderRepo.getAll();

    // Parse JSON fields safely
    let outline = [];
    let citations = [];
    let imagePrompts = [];
    try { outline = JSON.parse(article.outline || '[]'); } catch (e) {}
    try { citations = JSON.parse(article.citations || '[]'); } catch (e) {}
    try { imagePrompts = JSON.parse(article.image_prompts || '[]'); } catch (e) {}

    res.render('editor', {
      title: `Editing: ${article.title} - DeepSeek Writer`,
      article: {
        ...article,
        outline,
        citations,
        imagePrompts
      },
      folders,
      selectedFolderId: article.folder_id,
      isNew: false
    });
  } catch (err) {
    res.status(500).send('Error opening editor: ' + err.message);
  }
});

// Article Reader / Export View
router.get('/article/:id', (req, res) => {
  try {
    const article = articleRepo.getById(req.params.id);
    if (!article) {
      return res.status(404).send('Article not found');
    }

    const folders = folderRepo.getAll();
    const renderedHtml = article.content_markdown ? marked.parse(article.content_markdown) : '';

    let citations = [];
    try { citations = JSON.parse(article.citations || '[]'); } catch (e) {}

    res.render('view', {
      title: `${article.title} - igboatlas.com Publisher`,
      article,
      renderedHtml,
      citations,
      folders
    });
  } catch (err) {
    res.status(500).send('Error viewing article: ' + err.message);
  }
});

// Folder Management Page
router.get('/folders', (req, res) => {
  try {
    const folders = folderRepo.getAll();
    const stats = articleRepo.getStats();

    res.render('folders', {
      title: 'Folder Manager - DeepSeek Writer',
      folders,
      stats
    });
  } catch (err) {
    res.status(500).send('Error loading folders: ' + err.message);
  }
});

export default router;
