import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { marked } from 'marked';
import db, { articleRepo, folderRepo, backlogRepo } from '../db/database.js';
import { searchWeb, fetchWebPage, formulateSearchQuery, generateArticleDraft, generateSeoTitles, classifyTitlesIntoFolders, enhanceImagePrompt } from '../services/deepseek.js';
import { generateFluxImage, getSavedImages } from '../services/flux.js';

const router = express.Router();

// Multer storage setup for manual image uploads
const storageDir = path.resolve(process.cwd(), 'storage', 'images');
const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, storageDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const cleanName = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]/gi, '').substring(0, 25);
    cb(null, `upload-${cleanName}-${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  }
});

// Configure marked
marked.setOptions({
  gfm: true,
  breaks: true
});

// -------------------------------------------------------------
// ARTICLES API
// -------------------------------------------------------------
router.get('/articles', (req, res) => {
  try {
    const { folderId, status, search } = req.query;
    const articles = articleRepo.getAll({ folderId, status, search });
    res.json({ success: true, articles });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/articles/:id', (req, res) => {
  try {
    const article = articleRepo.getById(req.params.id);
    if (!article) {
      return res.status(404).json({ success: false, error: 'Article not found' });
    }
    res.json({ success: true, article });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/articles', (req, res) => {
  try {
    const {
      title, folder_id, topic, region, status, cover_image,
      cover_image_prompt, executive_summary, outline, content_markdown,
      citations, image_prompts, reasoning_log
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Article title is required' });
    }

    const content_html = content_markdown ? marked.parse(content_markdown) : '';

    const article = articleRepo.create({
      title: title.trim(),
      folder_id: folder_id ? Number(folder_id) : null,
      topic: topic || '',
      region: region || '',
      status: status || 'draft',
      cover_image: cover_image || '',
      cover_image_prompt: cover_image_prompt || '',
      executive_summary: executive_summary || '',
      outline: outline || '[]',
      content_markdown: content_markdown || '',
      content_html,
      citations: citations || '[]',
      image_prompts: image_prompts || '[]',
      reasoning_log: reasoning_log || ''
    });

    // Check if there's a matching title_backlog item to link and sync
    try {
      const match = db.prepare('SELECT id, folder_id FROM title_backlog WHERE (title = ? OR topic = ?) AND article_id IS NULL').get(article.title, article.title);
      if (match) {
        db.prepare(`
          UPDATE title_backlog
          SET article_id = ?,
              folder_id = COALESCE(?, folder_id),
              status = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(article.id, article.folder_id, article.status === 'published' ? 'completed' : 'writing', match.id);
      }
    } catch (e) {
      console.warn('Notice: Could not link backlog item on article create:', e.message);
    }

    res.status(201).json({ success: true, article });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/articles/:id', (req, res) => {
  try {
    const {
      title, folder_id, topic, region, status, cover_image,
      cover_image_prompt, executive_summary, outline, content_markdown,
      citations, image_prompts, reasoning_log
    } = req.body;

    const content_html = content_markdown !== undefined ? marked.parse(content_markdown) : undefined;

    const article = articleRepo.update(req.params.id, {
      title,
      folder_id,
      topic,
      region,
      status,
      cover_image,
      cover_image_prompt,
      executive_summary,
      outline,
      content_markdown,
      content_html,
      citations,
      image_prompts,
      reasoning_log
    });

    if (!article) {
      return res.status(404).json({ success: false, error: 'Article not found' });
    }

    // Keep linked title_backlog in sync if folder_id or status changed
    try {
      db.prepare(`
        UPDATE title_backlog
        SET folder_id = COALESCE(?, folder_id),
            status = COALESCE(?, status),
            updated_at = CURRENT_TIMESTAMP
        WHERE article_id = ?
      `).run(
        article.folder_id,
        article.status === 'published' ? 'completed' : 'writing',
        article.id
      );
    } catch (e) {
      console.warn('Notice: Could not sync linked backlog on article update:', e.message);
    }

    res.json({ success: true, article });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/articles/:id/move', (req, res) => {
  try {
    const { folder_id } = req.body;
    const article = articleRepo.moveToFolder(req.params.id, folder_id);
    if (!article) {
      return res.status(404).json({ success: false, error: 'Article not found' });
    }
    res.json({ success: true, article });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/articles/:id', (req, res) => {
  try {
    articleRepo.delete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// FOLDERS API
// -------------------------------------------------------------
router.get('/folders', (req, res) => {
  try {
    const folders = folderRepo.getAll();
    res.json({ success: true, folders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/folders', (req, res) => {
  try {
    const { name, description, color, icon } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Folder name is required' });
    }
    const folder = folderRepo.create({ name: name.trim(), description, color, icon });
    res.status(201).json({ success: true, folder });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/folders/:id', (req, res) => {
  try {
    const { name, description, color, icon } = req.body;
    const folder = folderRepo.update(req.params.id, { name, description, color, icon });
    if (!folder) {
      return res.status(404).json({ success: false, error: 'Folder not found' });
    }
    res.json({ success: true, folder });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/folders/:id', (req, res) => {
  try {
    folderRepo.delete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// TITLE BACKLOG / CONTENT QUEUE API
// -------------------------------------------------------------
router.get('/backlog', (req, res) => {
  try {
    const { folderId, status, priority, search } = req.query;
    const items = backlogRepo.getAll({ folderId, status, priority, search });
    const stats = backlogRepo.getStats();
    res.json({ success: true, items, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/backlog', (req, res) => {
  try {
    const { title, topic, region, folder_id, notes, priority } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Title is required' });
    }
    const item = backlogRepo.create({ title, topic, region, folder_id, notes, priority });
    res.status(201).json({ success: true, item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/backlog/bulk', async (req, res) => {
  try {
    const { titlesText, folder_id, region, priority, auto_classify } = req.body;
    if (!titlesText || !titlesText.trim()) {
      return res.status(400).json({ success: false, error: 'No titles provided' });
    }

    const items = backlogRepo.bulkCreate({
      titlesText,
      folder_id: auto_classify ? null : folder_id,
      region,
      priority
    });

    let classifiedCount = 0;
    let summary = {};
    if (auto_classify && items.length > 0) {
      try {
        const folders = folderRepo.getAll();
        const classifications = await classifyTitlesIntoFolders({
          titles: items.map(t => ({ id: t.id, title: t.title, region: t.region })),
          folders: folders.map(f => ({ id: f.id, name: f.name, description: f.description }))
        });
        classifiedCount = backlogRepo.bulkAssignFolders(classifications);
        const folderLookup = new Map(folders.map(f => [f.id, f.name]));
        for (const c of classifications) {
          const fname = folderLookup.get(c.folder_id) || 'Uncategorized';
          summary[fname] = (summary[fname] || 0) + 1;
        }
      } catch (classifyErr) {
        console.warn('[Bulk Import] Auto-classification warning:', classifyErr.message);
      }
    }

    res.status(201).json({
      success: true,
      count: items.length,
      items,
      autoClassified: Boolean(auto_classify),
      classifiedCount,
      summary
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// AI Batch Classify Titles into Cultural Folders
router.post('/backlog/ai-classify', async (req, res) => {
  try {
    const { scope = 'uncategorized', folder_id = null, ids = null } = req.body;
    const folders = folderRepo.getAll();
    if (!folders || folders.length === 0) {
      return res.status(400).json({ success: false, error: 'No folders available to classify into' });
    }

    let targetTitles = [];
    if (Array.isArray(ids) && ids.length > 0) {
      const all = backlogRepo.getAll();
      const idSet = new Set(ids.map(Number));
      targetTitles = all.filter(t => idSet.has(t.id));
    } else if (scope === 'uncategorized') {
      targetTitles = backlogRepo.getAll({ folderId: 'uncategorized' });
    } else if (scope === 'all') {
      targetTitles = backlogRepo.getAll();
    } else if (scope === 'folder' && folder_id) {
      targetTitles = backlogRepo.getAll({ folderId });
    } else {
      targetTitles = backlogRepo.getAll({ folderId: 'uncategorized' });
    }

    if (targetTitles.length === 0) {
      return res.json({
        success: true,
        count: 0,
        totalRequested: 0,
        message: 'No titles found matching the selected scope.',
        summary: {},
        classifications: []
      });
    }

    console.log(`[AI Classification] Processing ${targetTitles.length} titles under scope "${scope}"...`);

    const classifications = await classifyTitlesIntoFolders({
      titles: targetTitles.map(t => ({ id: t.id, title: t.title, region: t.region })),
      folders: folders.map(f => ({ id: f.id, name: f.name, description: f.description }))
    });

    const updatedCount = backlogRepo.bulkAssignFolders(classifications);

    const summary = {};
    const folderLookup = new Map(folders.map(f => [f.id, f.name]));
    for (const c of classifications) {
      const fname = folderLookup.get(c.folder_id) || 'Unknown';
      summary[fname] = (summary[fname] || 0) + 1;
    }

    console.log(`[AI Classification] Successfully classified ${updatedCount} titles into folders.`);

    res.json({
      success: true,
      count: updatedCount,
      totalRequested: targetTitles.length,
      summary,
      classifications
    });
  } catch (err) {
    console.error('AI Classification error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Single Title AI Classify
router.post('/backlog/:id/ai-classify', async (req, res) => {
  try {
    const item = backlogRepo.getById(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Title not found' });
    }

    const folders = folderRepo.getAll();
    if (!folders || folders.length === 0) {
      return res.status(400).json({ success: false, error: 'No folders available' });
    }

    const classifications = await classifyTitlesIntoFolders({
      titles: [{ id: item.id, title: item.title, region: item.region }],
      folders: folders.map(f => ({ id: f.id, name: f.name, description: f.description }))
    });

    if (!classifications || classifications.length === 0) {
      return res.status(500).json({ success: false, error: 'AI could not determine a matching folder' });
    }

    const assigned = classifications[0];
    const updated = backlogRepo.update(item.id, { folder_id: assigned.folder_id });
    const matchedFolder = folders.find(f => f.id === assigned.folder_id);

    res.json({
      success: true,
      item: updated,
      folder: matchedFolder,
      confidence: assigned.confidence || 'high'
    });
  } catch (err) {
    console.error('Single title AI classification error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/backlog/:id', (req, res) => {
  try {
    const item = backlogRepo.update(req.params.id, req.body);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/backlog/:id/start', (req, res) => {
  try {
    const result = backlogRepo.startWriting(req.params.id);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Backlog item not found' });
    }
    res.json({
      success: true,
      articleId: result.articleId,
      redirectUrl: `/editor/${result.articleId}`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/backlog/:id', (req, res) => {
  try {
    backlogRepo.delete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// DEEPSEEK RESEARCH & WRITING API
// -------------------------------------------------------------
router.post('/research', async (req, res) => {
  try {
    const { topic, region, customQuery, count = 5 } = req.body;
    const query = customQuery || formulateSearchQuery(topic, region);
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query or Topic is required' });
    }

    const results = await searchWeb(query, count);
    res.json({ success: true, query, count: results.length, results });
  } catch (err) {
    console.error('Research error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fetch-page', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const content = await fetchWebPage(url);
    res.json({ success: true, url, content });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const {
      topic,
      region,
      customAngle,
      outline,
      includeSummary = true,
      includeReferences = true,
      searchResults = [],
      minWords = 1500,
      model
    } = req.body;

    if (!topic || !topic.trim()) {
      return res.status(400).json({ success: false, error: 'Article topic is required' });
    }

    console.log(`[DeepSeekWriter] Generating article for "${topic}" (~${minWords} words) using ${model || 'deepseek-chat'}...`);

    const result = await generateArticleDraft({
      topic,
      region,
      customAngle,
      outline,
      includeSummary,
      includeReferences,
      searchResults,
      minWords,
      model
    });

    const renderedHtml = result.articleBody ? marked.parse(result.articleBody) : '';

    res.json({
      success: true,
      summary: result.summary,
      articleBody: result.articleBody,
      renderedHtml,
      imagePrompts: result.imagePrompts,
      reasoningContent: result.reasoningContent
    });
  } catch (err) {
    console.error('Generation error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/optimize-titles', async (req, res) => {
  try {
    const { topic, currentTitle, region, contentSnippet } = req.body;
    const titles = await generateSeoTitles({
      topic,
      currentTitle,
      region,
      contentSnippet
    });
    res.json({ success: true, titles });
  } catch (err) {
    console.error('Title optimization error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// FLUX IMAGE GENERATION API
// -------------------------------------------------------------
router.post('/generate-image', async (req, res) => {
  try {
    const { prompt, aspectRatio = '16:9', articleSlug = '' } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ success: false, error: 'Image prompt is required' });
    }

    console.log(`[Flux] Generating image with prompt: "${prompt.substring(0, 50)}..." (${aspectRatio})`);

    const imageResult = await generateFluxImage(prompt, {
      aspectRatio,
      articleSlug
    });

    res.json({ success: true, image: imageResult });
  } catch (err) {
    console.error('Image generation error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/enhance-prompt', async (req, res) => {
  try {
    const { prompt, topic, region, style = 'auto' } = req.body;
    console.log(`[Flux] Enhancing prompt with style "${style}" for topic: "${topic || prompt}"...`);
    const result = await enhanceImagePrompt({ prompt, topic, region, style });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Prompt enhancement error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/images', (req, res) => {
  try {
    const images = getSavedImages();
    res.json({ success: true, images });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/upload-image', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image uploaded' });
    }
    const filename = req.file.filename;
    const url = `/images/${filename}`;
    res.json({
      success: true,
      image: {
        filename,
        url,
        sizeBytes: req.file.size
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Markdown live parser
router.post('/render-markdown', (req, res) => {
  try {
    const { markdown } = req.body;
    const html = marked.parse(markdown || '');
    res.json({ success: true, html });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
