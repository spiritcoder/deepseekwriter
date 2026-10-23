// Global DeepSeek Writer Frontend Utilities

function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

// Modal open/close helpers
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
  }
}

// Folder creation modal handling
async function handleCreateFolder(event) {
  event.preventDefault();
  const form = event.target;
  const name = form.folder_name.value.trim();
  const description = form.folder_description.value.trim();
  const color = form.folder_color.value;

  if (!name) {
    showToast('Folder name is required', 'error');
    return;
  }

  try {
    const res = await fetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, color })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showToast(`Folder "${name}" created successfully!`, 'success');
    closeModal('modal-create-folder');
    setTimeout(() => window.location.reload(), 400);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Move article to folder
let pendingMoveArticleId = null;
function promptMoveArticle(articleId, currentFolderId) {
  pendingMoveArticleId = articleId;
  const select = document.getElementById('move_folder_select');
  if (select && currentFolderId) {
    select.value = currentFolderId;
  }
  openModal('modal-move-article');
}

async function confirmMoveArticle() {
  if (!pendingMoveArticleId) return;
  const select = document.getElementById('move_folder_select');
  const folder_id = select ? select.value : null;

  try {
    const res = await fetch(`/api/articles/${pendingMoveArticleId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_id: folder_id === '' ? null : folder_id })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showToast('Article moved successfully!', 'success');
    closeModal('modal-move-article');
    setTimeout(() => window.location.reload(), 400);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Delete article
async function confirmDeleteArticle(articleId, title) {
  if (!confirm(`Are you sure you want to delete "${title || 'this article'}"? This cannot be undone.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/articles/${articleId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showToast('Article deleted', 'success');
    setTimeout(() => {
      if (window.location.pathname.startsWith('/editor/')) {
        window.location.href = '/';
      } else {
        window.location.reload();
      }
    }, 400);
  } catch (err) {
    showToast(err.message, 'error');
  }
}
