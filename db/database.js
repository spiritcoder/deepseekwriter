import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Ensure storage/images directory exists
const storageDir = path.join(rootDir, 'storage', 'images');
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

// Database file path
const dbPath = path.join(rootDir, 'deepseekwriter.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency and performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    color TEXT DEFAULT '#475569',
    icon TEXT DEFAULT 'folder',
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    topic TEXT DEFAULT '',
    region TEXT DEFAULT '',
    status TEXT DEFAULT 'draft', -- 'draft', 'review', 'published', 'archived'
    cover_image TEXT DEFAULT '',
    cover_image_prompt TEXT DEFAULT '',
    executive_summary TEXT DEFAULT '',
    outline TEXT DEFAULT '[]', -- JSON array of sections
    content_markdown TEXT NOT NULL DEFAULT '',
    content_html TEXT DEFAULT '',
    citations TEXT DEFAULT '[]', -- JSON array of search citations
    image_prompts TEXT DEFAULT '[]', -- JSON array of suggested image prompts
    reasoning_log TEXT DEFAULT '',
    word_count INTEGER DEFAULT 0,
    reading_time INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_articles_folder_id ON articles(folder_id);
  CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
  CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at);

  CREATE TABLE IF NOT EXISTS title_backlog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    topic TEXT DEFAULT '',
    region TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    priority TEXT DEFAULT 'normal', -- 'low', 'normal', 'high'
    status TEXT DEFAULT 'planned', -- 'planned', 'writing', 'completed'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_backlog_folder_id ON title_backlog(folder_id);
  CREATE INDEX IF NOT EXISTS idx_backlog_status ON title_backlog(status);
`);

// Seed default folders if empty
const countFolders = db.prepare('SELECT COUNT(*) as count FROM folders').get();
if (countFolders.count === 0) {
  const insertFolder = db.prepare(`
    INSERT INTO folders (name, slug, description, color, icon, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const defaultFolders = [
    ['Food', 'food', 'Traditional cuisine, sacred crops, culinary heritage, fermentation, and delicacies', '#f97316', 'utensils', 1],
    ['Cosmology & Deities', 'cosmology-and-deities', 'Chukwu, Alusi, Agbara, celestial principles, and the cosmic architecture of Uwa', '#8b5cf6', 'moon', 2],
    ['History & Heritage', 'history-and-heritage', 'Origins, migrations, archaeological treasures like Igbo-Ukwu, and ancient kingdoms', '#0284c7', 'landmark', 3],
    ['Culture & Traditions', 'culture-and-traditions', 'Omenala, title-taking (Ozo), masquerades, festivals, and social customs', '#10b981', 'feather', 4],
    ['People & Biographies', 'people-and-biographies', 'Ancestors, legendary dibias, scholars, warriors, monarchs, and contemporary leaders', '#ec4899', 'users', 5],
    ['Places & Geography', 'places-and-geography', 'Towns, sacred hills, rivers, sacred groves, landscapes, and settlement histories', '#38bdf8', 'map-pin', 6],
    ['Arts & Literature', 'arts-and-literature', 'Proverbs, oral poetry, mythology, Uli body motifs, sculpture, and bronze work', '#a855f7', 'book-open', 7],
    ['Science & Innovation', 'science-and-innovation', 'Blacksmithing, metallurgy, indigenous calendar, lunar navigation, and bone-setting', '#06b6d4', 'cpu', 8],
    ['Economy & Livelihood', 'economy-and-livelihood', 'Market systems (Eke, Orie, Afo, Nkwo), apprentice schemes, farming, and commerce', '#f59e0b', 'briefcase', 9],
    ['Beliefs & Spirituality', 'beliefs-and-spirituality', 'Chi, Afa divination, Igo Mmuo, Ikenga, taboos (Nso), and spiritual philosophy', '#6366f1', 'compass', 10]
  ];

  for (const f of defaultFolders) {
    insertFolder.run(...f);
  }
}

// Helper: Slugify string
export function generateSlug(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\s\W-]+/g, '-')
    .replace(/^-+|-+$/g, '') || ('article-' + Date.now());
}

// -------------------------------------------------------------
// FOLDERS REPOSITORY
// -------------------------------------------------------------
export const folderRepo = {
  getAll() {
    const folders = db.prepare(`
      SELECT f.*, 
             COUNT(DISTINCT a.id) AS article_count,
             COUNT(DISTINCT b.id) AS backlog_count
      FROM folders f
      LEFT JOIN articles a ON a.folder_id = f.id
      LEFT JOIN title_backlog b ON b.folder_id = f.id
      GROUP BY f.id
      ORDER BY f.sort_order ASC, f.name ASC
    `).all();
    return folders;
  },

  getById(id) {
    return db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
  },

  getBySlug(slug) {
    return db.prepare('SELECT * FROM folders WHERE slug = ?').get(slug);
  },

  create({ name, description = '', color = '#475569', icon = 'folder' }) {
    let baseSlug = generateSlug(name);
    let slug = baseSlug;
    let counter = 1;
    while (db.prepare('SELECT id FROM folders WHERE slug = ?').get(slug)) {
      slug = `${baseSlug}-${counter++}`;
    }

    const info = db.prepare(`
      INSERT INTO folders (name, slug, description, color, icon, sort_order)
      VALUES (?, ?, ?, ?, ?, (SELECT IFNULL(MAX(sort_order), 0) + 1 FROM folders))
    `).run(name, slug, description, color, icon);

    return this.getById(info.lastInsertRowid);
  },

  update(id, { name, description, color, icon }) {
    const existing = this.getById(id);
    if (!existing) return null;

    let slug = existing.slug;
    if (name && name !== existing.name) {
      let baseSlug = generateSlug(name);
      slug = baseSlug;
      let counter = 1;
      while (db.prepare('SELECT id FROM folders WHERE slug = ? AND id != ?').get(slug, id)) {
        slug = `${baseSlug}-${counter++}`;
      }
    }

    db.prepare(`
      UPDATE folders
      SET name = COALESCE(?, name),
          slug = ?,
          description = COALESCE(?, description),
          color = COALESCE(?, color),
          icon = COALESCE(?, icon),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, slug, description, color, icon, id);

    return this.getById(id);
  },

  delete(id) {
    // Foreign key on delete set null will detach articles
    return db.prepare('DELETE FROM folders WHERE id = ?').run(id);
  }
};

// -------------------------------------------------------------
// ARTICLES REPOSITORY
// -------------------------------------------------------------
export const articleRepo = {
  getAll({ folderId, status, search, limit = 100, offset = 0 } = {}) {
    let sql = `
      SELECT a.*, f.name AS folder_name, f.color AS folder_color, f.slug AS folder_slug
      FROM articles a
      LEFT JOIN folders f ON f.id = a.folder_id
      WHERE 1=1
    `;
    const params = [];

    if (folderId !== undefined && folderId !== null && folderId !== '') {
      if (folderId === 'uncategorized' || folderId === 'null') {
        sql += ' AND a.folder_id IS NULL';
      } else {
        sql += ' AND a.folder_id = ?';
        params.push(folderId);
      }
    }

    if (status && status !== 'all') {
      sql += ' AND a.status = ?';
      params.push(status);
    }

    if (search && search.trim()) {
      sql += ' AND (a.title LIKE ? OR a.topic LIKE ? OR a.content_markdown LIKE ? OR a.region LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    sql += ' ORDER BY a.updated_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return db.prepare(sql).all(...params);
  },

  getStats() {
    const total = db.prepare('SELECT COUNT(*) as count FROM articles').get().count;
    const published = db.prepare("SELECT COUNT(*) as count FROM articles WHERE status = 'published'").get().count;
    const drafts = db.prepare("SELECT COUNT(*) as count FROM articles WHERE status = 'draft'").get().count;
    const inReview = db.prepare("SELECT COUNT(*) as count FROM articles WHERE status = 'review'").get().count;
    const totalWords = db.prepare('SELECT IFNULL(SUM(word_count), 0) as total FROM articles').get().total;

    return { total, published, drafts, inReview, totalWords };
  },

  getById(id) {
    return db.prepare(`
      SELECT a.*, f.name AS folder_name, f.color AS folder_color, f.slug AS folder_slug
      FROM articles a
      LEFT JOIN folders f ON f.id = a.folder_id
      WHERE a.id = ?
    `).get(id);
  },

  getBySlug(slug) {
    return db.prepare(`
      SELECT a.*, f.name AS folder_name, f.color AS folder_color, f.slug AS folder_slug
      FROM articles a
      LEFT JOIN folders f ON f.id = a.folder_id
      WHERE a.slug = ?
    `).get(slug);
  },

  create(data) {
    const {
      folder_id = null,
      title,
      topic = '',
      region = '',
      status = 'draft',
      cover_image = '',
      cover_image_prompt = '',
      executive_summary = '',
      outline = '[]',
      content_markdown = '',
      content_html = '',
      citations = '[]',
      image_prompts = '[]',
      reasoning_log = '',
      word_count = 0,
      reading_time = 1
    } = data;

    let baseSlug = generateSlug(title || 'untitled-draft');
    let slug = baseSlug;
    let counter = 1;
    while (db.prepare('SELECT id FROM articles WHERE slug = ?').get(slug)) {
      slug = `${baseSlug}-${counter++}`;
    }

    const calculatedWords = word_count || (content_markdown ? content_markdown.split(/\s+/).filter(Boolean).length : 0);
    const calculatedReading = Math.max(1, Math.round(calculatedWords / 200));

    const info = db.prepare(`
      INSERT INTO articles (
        folder_id, title, slug, topic, region, status, cover_image, cover_image_prompt,
        executive_summary, outline, content_markdown, content_html, citations,
        image_prompts, reasoning_log, word_count, reading_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      folder_id ? Number(folder_id) : null,
      title,
      slug,
      topic,
      region,
      status,
      cover_image,
      cover_image_prompt,
      executive_summary,
      typeof outline === 'string' ? outline : JSON.stringify(outline),
      content_markdown,
      content_html,
      typeof citations === 'string' ? citations : JSON.stringify(citations),
      typeof image_prompts === 'string' ? image_prompts : JSON.stringify(image_prompts),
      reasoning_log,
      calculatedWords,
      calculatedReading
    );

    return this.getById(info.lastInsertRowid);
  },

  update(id, data) {
    const existing = this.getById(id);
    if (!existing) return null;

    let slug = existing.slug;
    if (data.title && data.title !== existing.title) {
      let baseSlug = generateSlug(data.title);
      slug = baseSlug;
      let counter = 1;
      while (db.prepare('SELECT id FROM articles WHERE slug = ? AND id != ?').get(slug, id)) {
        slug = `${baseSlug}-${counter++}`;
      }
    }

    const markdown = data.content_markdown !== undefined ? data.content_markdown : existing.content_markdown;
    const words = markdown ? markdown.split(/\s+/).filter(Boolean).length : 0;
    const readingTime = Math.max(1, Math.round(words / 200));

    db.prepare(`
      UPDATE articles
      SET folder_id = ?,
          title = COALESCE(?, title),
          slug = ?,
          topic = COALESCE(?, topic),
          region = COALESCE(?, region),
          status = COALESCE(?, status),
          cover_image = COALESCE(?, cover_image),
          cover_image_prompt = COALESCE(?, cover_image_prompt),
          executive_summary = COALESCE(?, executive_summary),
          outline = COALESCE(?, outline),
          content_markdown = COALESCE(?, content_markdown),
          content_html = COALESCE(?, content_html),
          citations = COALESCE(?, citations),
          image_prompts = COALESCE(?, image_prompts),
          reasoning_log = COALESCE(?, reasoning_log),
          word_count = ?,
          reading_time = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      data.folder_id !== undefined ? (data.folder_id ? Number(data.folder_id) : null) : existing.folder_id,
      data.title,
      slug,
      data.topic,
      data.region,
      data.status,
      data.cover_image,
      data.cover_image_prompt,
      data.executive_summary,
      data.outline !== undefined ? (typeof data.outline === 'string' ? data.outline : JSON.stringify(data.outline)) : null,
      data.content_markdown,
      data.content_html,
      data.citations !== undefined ? (typeof data.citations === 'string' ? data.citations : JSON.stringify(data.citations)) : null,
      data.image_prompts !== undefined ? (typeof data.image_prompts === 'string' ? data.image_prompts : JSON.stringify(data.image_prompts)) : null,
      data.reasoning_log,
      words,
      readingTime,
      id
    );

    return this.getById(id);
  },

  moveToFolder(id, folderId) {
    db.prepare(`
      UPDATE articles
      SET folder_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(folderId ? Number(folderId) : null, id);
    return this.getById(id);
  },

  delete(id) {
    return db.prepare('DELETE FROM articles WHERE id = ?').run(id);
  }
};

// -------------------------------------------------------------
// TITLE BACKLOG / CONTENT QUEUE REPOSITORY
// -------------------------------------------------------------
export const backlogRepo = {
  getAll({ folderId, status, priority, search } = {}) {
    let sql = `
      SELECT b.*, f.name AS folder_name, f.color AS folder_color, f.slug AS folder_slug,
             a.slug AS article_slug, a.status AS article_status
      FROM title_backlog b
      LEFT JOIN folders f ON f.id = b.folder_id
      LEFT JOIN articles a ON a.id = b.article_id
      WHERE 1=1
    `;
    const params = [];

    if (folderId !== undefined && folderId !== null && folderId !== '') {
      if (folderId === 'uncategorized' || folderId === 'null') {
        sql += ' AND b.folder_id IS NULL';
      } else {
        sql += ' AND b.folder_id = ?';
        params.push(folderId);
      }
    }

    if (status && status !== 'all') {
      sql += ' AND b.status = ?';
      params.push(status);
    }

    if (priority && priority !== 'all') {
      sql += ' AND b.priority = ?';
      params.push(priority);
    }

    if (search && search.trim()) {
      sql += ' AND (b.title LIKE ? OR b.topic LIKE ? OR b.region LIKE ? OR b.notes LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    sql += " ORDER BY CASE b.priority WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, b.created_at DESC";
    return db.prepare(sql).all(...params);
  },

  getStats() {
    const total = db.prepare('SELECT COUNT(*) as count FROM title_backlog').get().count;
    const planned = db.prepare("SELECT COUNT(*) as count FROM title_backlog WHERE status = 'planned'").get().count;
    const writing = db.prepare("SELECT COUNT(*) as count FROM title_backlog WHERE status = 'writing'").get().count;
    const completed = db.prepare("SELECT COUNT(*) as count FROM title_backlog WHERE status = 'completed'").get().count;
    return { total, planned, writing, completed };
  },

  getUncategorizedCount() {
    return db.prepare('SELECT COUNT(*) as count FROM title_backlog WHERE folder_id IS NULL').get().count;
  },

  bulkAssignFolders(assignments) {
    if (!Array.isArray(assignments) || assignments.length === 0) return 0;
    const stmt = db.prepare(`
      UPDATE title_backlog
      SET folder_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    const syncArticleStmt = db.prepare(`
      UPDATE articles
      SET folder_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = (SELECT article_id FROM title_backlog WHERE id = ?)
    `);
    let updated = 0;
    const tx = db.transaction((list) => {
      for (const item of list) {
        if (item && item.id && item.folder_id !== undefined) {
          const fid = item.folder_id ? Number(item.folder_id) : null;
          const id = Number(item.id);
          const res = stmt.run(fid, id);
          if (res.changes > 0) {
            updated++;
            syncArticleStmt.run(fid, id);
          }
        }
      }
    });
    tx(assignments);
    return updated;
  },

  getById(id) {
    return db.prepare(`
      SELECT b.*, f.name AS folder_name, f.color AS folder_color, f.slug AS folder_slug
      FROM title_backlog b
      LEFT JOIN folders f ON f.id = b.folder_id
      WHERE b.id = ?
    `).get(id);
  },

  create({ title, topic = '', region = '', folder_id = null, notes = '', priority = 'normal' }) {
    if (!title || !title.trim()) {
      throw new Error('Title is required');
    }

    const cleanTitle = title.trim();
    const cleanTopic = topic ? topic.trim() : cleanTitle;

    const info = db.prepare(`
      INSERT INTO title_backlog (title, topic, region, folder_id, notes, priority, status)
      VALUES (?, ?, ?, ?, ?, ?, 'planned')
    `).run(
      cleanTitle,
      cleanTopic,
      region ? region.trim() : '',
      folder_id ? Number(folder_id) : null,
      notes ? notes.trim() : '',
      priority || 'normal'
    );

    return this.getById(info.lastInsertRowid);
  },

  bulkCreate({ titlesText, folder_id = null, region = '', priority = 'normal' }) {
    if (!titlesText || !titlesText.trim()) return [];

    const lines = titlesText
      .split('\n')
      .map(l => l.replace(/^\d+[\.\)]\s*/, '').replace(/^[-*]\s*/, '').trim())
      .filter(l => l.length > 0);

    const inserted = [];
    const insertStmt = db.prepare(`
      INSERT INTO title_backlog (title, topic, region, folder_id, notes, priority, status)
      VALUES (?, ?, ?, ?, '', ?, 'planned')
    `);

    const transaction = db.transaction((titles) => {
      for (const t of titles) {
        const info = insertStmt.run(
          t,
          t,
          region ? region.trim() : '',
          folder_id ? Number(folder_id) : null,
          priority || 'normal'
        );
        inserted.push(this.getById(info.lastInsertRowid));
      }
    });

    transaction(lines);
    return inserted;
  },

  update(id, data) {
    const existing = this.getById(id);
    if (!existing) return null;

    db.prepare(`
      UPDATE title_backlog
      SET title = COALESCE(?, title),
          topic = COALESCE(?, topic),
          region = COALESCE(?, region),
          folder_id = ?,
          notes = COALESCE(?, notes),
          priority = COALESCE(?, priority),
          status = COALESCE(?, status),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      data.title,
      data.topic,
      data.region,
      data.folder_id !== undefined ? (data.folder_id ? Number(data.folder_id) : null) : existing.folder_id,
      data.notes,
      data.priority,
      data.status,
      id
    );

    // Keep linked article folder in sync if folder_id was changed
    if (data.folder_id !== undefined) {
      db.prepare(`
        UPDATE articles
        SET folder_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = (SELECT article_id FROM title_backlog WHERE id = ?)
      `).run(data.folder_id ? Number(data.folder_id) : null, id);
    }

    return this.getById(id);
  },

  startWriting(id) {
    const backlog = this.getById(id);
    if (!backlog) return null;

    let articleId = backlog.article_id;

    if (!articleId) {
      // Create new draft article linked to this backlog item
      const article = articleRepo.create({
        title: backlog.title,
        topic: backlog.topic || backlog.title,
        region: backlog.region || '',
        folder_id: backlog.folder_id,
        status: 'draft',
        content_markdown: `# ${backlog.title}\n\n`,
        outline: '[]'
      });
      articleId = article.id;

      // Link article to backlog item and set status to 'writing'
      db.prepare(`
        UPDATE title_backlog
        SET article_id = ?, status = 'writing', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(articleId, id);
    } else {
      // If article already exists, always synchronize its folder_id with the classified backlog folder!
      if (backlog.folder_id) {
        db.prepare(`
          UPDATE articles
          SET folder_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(backlog.folder_id, articleId);
      }
    }

    return { articleId, backlog };
  },

  delete(id) {
    return db.prepare('DELETE FROM title_backlog WHERE id = ?').run(id);
  }
};

export default db;
