/**
 * public/js/profile.js
 *
 * Profile + dashboard UI.
 *
 * Responsibilities:
 * - Load and render the signed-in user's dashboard
 * - Render public profile pages (badges, reputation, social links)
 * - Provide navigational actions (e.g., "My Portfolio")
 */
class ProfileManager {
  constructor() {
    this.currentUser = null;
    this._dashboardData = null;
    this._documents = [];
    this._shareCards = [];
    this._profileDetails = null;
  }

  async loadDashboard() {
    try {
      const response = await fetch('/api/profile/dashboard/me');
      if (!response.ok) throw new Error('Not authenticated');

      const data = await response.json();
      this.renderDashboard(data);
    } catch (error) {
      console.error('Dashboard error:', error);
      const container = document.getElementById('dashboardContainer');
      if (container) {
        container.innerHTML = `
          <div class="empty-message">
            <h2>Sign in required</h2>
            <p>Please sign in to view your dashboard.</p>
            <button type="button" class="btn-primary" id="openSignInFromDashboard">Sign In</button>
          </div>
        `;
        const btn = document.getElementById('openSignInFromDashboard');
        if (btn) {
          btn.addEventListener('click', () => {
            const signInModal = document.getElementById('signInModal');
            if (signInModal) signInModal.style.display = 'block';
          });
        }
      }
    }
  }

  async loadProfile(username) {
    try {
      const response = await fetch(`/api/profile/${username}`);
      if (!response.ok) throw new Error('Profile not found');

      const data = await response.json();
      this.renderProfile(data);
    } catch (error) {
      console.error('Profile error:', error);
      this.showError('Profile not found');
    }
  }

  renderDashboard(data) {
    const container = document.getElementById('dashboardContainer');
    if (!container) return;

    this._dashboardData = data;

    const unreadNotifications = data.notifications.filter(n => !n.read).length;

    container.innerHTML = `
      <div class="dashboard">
        <div class="dashboard-header">
          <h2>My Dashboard</h2>
          <div>
            <button class="btn-primary" onclick="window.location.href='/portfolio'">My Portfolio</button>
            <button class="btn-primary" onclick="window.location.href='/profile.html?user=${encodeURIComponent(data.user.username)}'">View Public Profile</button>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon">📝</div>
            <div class="stat-info">
              <h3>${data.myPosts.length}</h3>
              <p>Posts</p>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">⭐</div>
            <div class="stat-info">
              <h3>${data.user.reputation}</h3>
              <p>Reputation</p>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">🏆</div>
            <div class="stat-info">
              <h3>${data.user.badges?.length || 0}</h3>
              <p>Badges</p>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">🔔</div>
            <div class="stat-info">
              <h3>${unreadNotifications}</h3>
              <p>Notifications</p>
            </div>
          </div>
        </div>

        <div class="dashboard-content">
          <div class="dashboard-section">
            <h3>My Posts</h3>
            <div class="posts-list">
              ${this.renderPostsList(data.myPosts)}
            </div>
          </div>

          <div class="dashboard-sidebar">
            <div class="profile-edit-card">
              <h3>Profile Settings</h3>
              <form id="profileEditForm">
                <div class="form-group">
                  <label>Bio</label>
                  <textarea name="bio" maxlength="500">${this.escapeHtml(data.user.bio || '')}</textarea>
                </div>
                <div class="form-group">
                  <label>GitHub</label>
                  <input type="url" name="github" value="${this.escapeHtml(data.user.socialLinks?.github || '')}" placeholder="https://github.com/username">
                </div>
                <div class="form-group">
                  <label>LinkedIn</label>
                  <input type="url" name="linkedin" value="${this.escapeHtml(data.user.socialLinks?.linkedin || '')}" placeholder="https://linkedin.com/in/username">
                </div>
                <div class="form-group">
                  <label>Twitter</label>
                  <input type="url" name="twitter" value="${this.escapeHtml(data.user.socialLinks?.twitter || '')}" placeholder="https://twitter.com/username">
                </div>
                <button type="submit" class="btn-primary">Save Profile</button>
              </form>
            </div>

            <div class="profile-edit-card">
              <h3>Detailed Bio (Optional)</h3>
              <p class="muted-text">This is what powers your Share Card. Fill in as much as you want.</p>
              <form id="profileDetailsForm">
                <div class="form-group">
                  <label>Display Name</label>
                  <input type="text" name="displayName" maxlength="80" placeholder="e.g., Alex Johnson" />
                </div>
                <div class="form-group">
                  <label>Headline</label>
                  <input type="text" name="headline" maxlength="120" placeholder="e.g., Aspiring Cloud Engineer | Linux + Networking" />
                </div>
                <div class="form-group">
                  <label>Location</label>
                  <input type="text" name="location" maxlength="120" placeholder="e.g., London, UK" />
                </div>
                <div class="form-group">
                  <label>Short Summary</label>
                  <textarea name="summaryShort" maxlength="1000" placeholder="1–3 paragraphs that quickly explain what you do and what you’re aiming for."></textarea>
                </div>
                <div class="form-group">
                  <label>Long Summary</label>
                  <textarea name="summaryLong" maxlength="8000" placeholder="Optional: longer story, background, details, achievements, etc."></textarea>
                </div>
                <div class="form-group">
                  <label>Target Roles (comma-separated)</label>
                  <input type="text" name="targetRoles" placeholder="e.g., Cloud Engineer, DevOps Engineer, SOC Analyst" />
                </div>
                <div class="form-group">
                  <label>Top Skills (comma-separated)</label>
                  <input type="text" name="topSkills" placeholder="e.g., Linux, Networking, AWS, Python" />
                </div>
                <div class="form-group">
                  <label>Website</label>
                  <input type="url" name="website" placeholder="https://your-site.com" />
                </div>
                <div class="form-group">
                  <label>GitHub</label>
                  <input type="url" name="github2" placeholder="https://github.com/username" />
                </div>
                <div class="form-group">
                  <label>LinkedIn</label>
                  <input type="url" name="linkedin2" placeholder="https://linkedin.com/in/username" />
                </div>
                <button type="submit" class="btn-primary">Save Detailed Bio</button>
              </form>
            </div>

            <div class="profile-edit-card">
              <h3>Documents (CV, Cover Letter, etc.)</h3>
              <form id="documentUploadForm" enctype="multipart/form-data">
                <div class="form-group">
                  <label>File (max 25MB)</label>
                  <input type="file" name="file" required />
                </div>
                <div class="form-group">
                  <label>Type</label>
                  <select name="type">
                    <option value="CV">CV</option>
                    <option value="CoverLetter">Cover Letter</option>
                    <option value="Certificate">Certificate</option>
                    <option value="Transcript">Transcript</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Label (optional)</label>
                  <input type="text" name="label" maxlength="120" placeholder="e.g., CV – 2026" />
                </div>
                <button type="submit" class="btn-primary">Upload</button>
              </form>
              <div id="documentsList" class="notifications-list" style="margin-top: 12px;"></div>
            </div>

            <div class="profile-edit-card">
              <h3>Share Card</h3>
              <p class="muted-text">Create an expiring link with only the sections you choose.</p>
              <form id="createShareCardForm">
                <div class="form-group">
                  <label>Expires in (days, 1–365)</label>
                  <input type="number" name="expiresInDays" min="1" max="365" value="30" />
                </div>
                <div class="form-group">
                  <label>Include Sections</label>
                  <div class="checkbox-group" id="shareSections">
                    <label><input type="checkbox" name="sec_identity" checked /> Identity</label>
                    <label><input type="checkbox" name="sec_about" checked /> About</label>
                    <label><input type="checkbox" name="sec_careerIntent" checked /> Career Intent</label>
                    <label><input type="checkbox" name="sec_skills" checked /> Skills</label>
                    <label><input type="checkbox" name="sec_experience" checked /> Experience</label>
                    <label><input type="checkbox" name="sec_learning" checked /> Learning</label>
                    <label><input type="checkbox" name="sec_portfolio" checked /> Portfolio</label>
                    <label><input type="checkbox" name="sec_links" checked /> Links</label>
                    <label><input type="checkbox" name="sec_documents" checked /> Documents</label>
                  </div>
                </div>
                <div class="form-group" id="shareDocumentsPickerWrap">
                  <label>Documents to allow</label>
                  <div id="shareDocumentsPicker" class="checkbox-group"></div>
                </div>
                <button type="submit" class="btn-primary">Create Share Link</button>
              </form>

              <div id="shareCardCreated" class="empty-message" style="display:none; margin-top: 12px;"></div>

              <h4 style="margin-top: 18px;">Your recent links</h4>
              <div id="shareCardsList" class="notifications-list"></div>
            </div>

            <div class="notifications-card">
              <h3>Recent Notifications</h3>
              <div class="notifications-list">
                ${this.renderNotifications(data.notifications)}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.attachDashboardEventListeners();
    this.loadDashboardExtras();
  }

  renderProfile(data) {
    const container = document.getElementById('profileContainer');
    if (!container) return;

    const memberSince = new Date(data.user.createdAt).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric'
    });

    container.innerHTML = `
      <div class="profile">
        <div class="profile-header">
          <div class="profile-avatar">
            <img src="${this.safeUrl(data.user.avatar, '/images/default-avatar.png')}" alt="${this.escapeHtml(data.user.username)}">
          </div>
          <div class="profile-info">
            <h1>${this.escapeHtml(data.user.username)}</h1>
            <p class="profile-bio">${this.escapeHtml(data.user.bio || 'No bio yet')}</p>
            <div class="profile-social">
              <a href="/portfolio/${encodeURIComponent(data.user.username)}">Portfolio</a>
              ${data.user.socialLinks?.github ? `<a href="${this.safeUrl(data.user.socialLinks.github)}" target="_blank" rel="noopener noreferrer"><i>GitHub</i></a>` : ''}
              ${data.user.socialLinks?.linkedin ? `<a href="${this.safeUrl(data.user.socialLinks.linkedin)}" target="_blank" rel="noopener noreferrer"><i>LinkedIn</i></a>` : ''}
              ${data.user.socialLinks?.twitter ? `<a href="${this.safeUrl(data.user.socialLinks.twitter)}" target="_blank" rel="noopener noreferrer"><i>Twitter</i></a>` : ''}
            </div>
          </div>
          <div class="profile-stats">
            <div class="profile-stat">
              <span>${data.stats.totalPosts}</span>
              <label>Posts</label>
            </div>
            <div class="profile-stat">
              <span>${data.stats.totalLikes}</span>
              <label>Likes</label>
            </div>
            <div class="profile-stat">
              <span>${data.user.reputation}</span>
              <label>Rep</label>
            </div>
          </div>
        </div>

        <div class="profile-badges">
          ${this.renderBadges(data.user.badges)}
        </div>

        <div class="profile-content">
          <h3>${this.escapeHtml(data.user.username)}'s Posts</h3>
          <div class="profile-posts">
            ${this.renderPostsList(data.posts)}
          </div>
        </div>
      </div>
    `;
  }

  renderPostsList(posts) {
    if (!posts || posts.length === 0) {
      return '<p class="empty-message">No posts yet</p>';
    }

    return posts.map(post => `
      <div class="post-item" data-id="${post._id}">
        <div class="post-item-header">
          <h4><a href="/post/${post._id}">${this.escapeHtml(post.title)}</a></h4>
          <span class="post-category">${post.category}</span>
        </div>
        <p class="post-excerpt">${this.escapeHtml(post.content.substring(0, 150))}...</p>
        <div class="post-item-footer">
          <span>❤️ ${post.likes?.length || 0}</span>
          <span>💬 ${post.replies?.length || 0}</span>
          <span>👁️ ${post.views || 0}</span>
          <span>${this.formatDate(post.createdAt)}</span>
          ${auth?.user?.username === post.author.username ? `
            <button class="btn-icon" onclick="profileManager.editPost('${post._id}')">✏️</button>
            <button class="btn-icon delete" onclick="profileManager.deletePost('${post._id}')">🗑️</button>
          ` : ''}
        </div>
      </div>
    `).join('');
  }

  renderNotifications(notifications) {
    if (!notifications || notifications.length === 0) {
      return '<p class="empty-message">No notifications</p>';
    }

    return notifications.slice(0, 10).map(notif => `
      <div class="notification-item ${notif.read ? 'read' : 'unread'}">
        <p>${this.escapeHtml(notif.message)}</p>
        <span class="notification-time">${this.formatDate(notif.createdAt)}</span>
      </div>
    `).join('');
  }

  renderBadges(badges) {
    if (!badges || badges.length === 0) {
      return '<p class="empty-message">No badges earned yet. Keep participating to earn badges!</p>';
    }

    return `<div class="user-badges">
      ${badges.map(badge => `
        <div class="badge-item" title="Earned ${this.formatDate(badge.earnedAt)}">
          <span class="badge-icon">${this.escapeHtml(badge.icon || '🏆')}</span>
          <span class="badge-name">${this.escapeHtml(badge.name)}</span>
        </div>
      `).join('')}
    </div>`;
  }

  attachDashboardEventListeners() {
    const form = document.getElementById('profileEditForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.updateProfile(new FormData(form));
      });
    }

    const detailsForm = document.getElementById('profileDetailsForm');
    if (detailsForm) {
      detailsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.updateProfileDetails(new FormData(detailsForm));
      });
    }

    const docForm = document.getElementById('documentUploadForm');
    if (docForm) {
      docForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.uploadDocument(new FormData(docForm));
      });
    }

    const shareForm = document.getElementById('createShareCardForm');
    if (shareForm) {
      shareForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.createShareCard(new FormData(shareForm));
      });

      const docsToggle = shareForm.querySelector('input[name="sec_documents"]');
      if (docsToggle) {
        docsToggle.addEventListener('change', () => this.syncShareDocumentsVisibility());
      }
    }
  }

  async loadDashboardExtras() {
    await Promise.all([
      this.fetchProfileDetailsAndPopulateForm(),
      this.refreshDocuments(),
      this.refreshShareCards(),
    ]);
  }

  parseCommaList(value, maxItems = 25) {
    return String(value || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, maxItems);
  }

  async fetchProfileDetailsAndPopulateForm() {
    try {
      const res = await fetch('/api/profile/details/me');
      if (!res.ok) return;
      const data = await res.json();
      this._profileDetails = data.profileDetails || null;

      const form = document.getElementById('profileDetailsForm');
      if (!form || !this._profileDetails) return;

      const d = this._profileDetails;
      form.elements.displayName.value = d.identity?.displayName || '';
      form.elements.headline.value = d.identity?.headline || '';
      form.elements.location.value = d.identity?.location || '';
      form.elements.summaryShort.value = d.about?.summaryShort || '';
      form.elements.summaryLong.value = d.about?.summaryLong || '';
      form.elements.targetRoles.value = (d.careerIntent?.targetRoles || []).join(', ');
      form.elements.topSkills.value = (d.skills?.topSkills || []).join(', ');
      form.elements.website.value = d.links?.website || '';
      form.elements.github2.value = d.links?.github || '';
      form.elements.linkedin2.value = d.links?.linkedin || '';
    } catch (error) {
      console.warn('Failed to load profile details', error);
    }
  }

  async updateProfileDetails(formData) {
    try {
      const payload = {
        identity: {
          displayName: formData.get('displayName'),
          headline: formData.get('headline'),
          location: formData.get('location'),
        },
        about: {
          summaryShort: formData.get('summaryShort'),
          summaryLong: formData.get('summaryLong'),
        },
        careerIntent: {
          targetRoles: this.parseCommaList(formData.get('targetRoles'), 25),
        },
        skills: {
          topSkills: this.parseCommaList(formData.get('topSkills'), 30),
        },
        links: {
          website: formData.get('website'),
          github: formData.get('github2'),
          linkedin: formData.get('linkedin2'),
        }
      };

      const response = await fetch('/api/profile/details/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        if (typeof showMessage === 'function') {
          showMessage('Detailed bio saved!', 'success');
        }
        await this.fetchProfileDetailsAndPopulateForm();
      } else {
        throw new Error('Update failed');
      }
    } catch (error) {
      console.error('Profile details update error:', error);
      if (typeof showMessage === 'function') {
        showMessage('Failed to save detailed bio', 'error');
      }
    }
  }

  async refreshDocuments() {
    try {
      const res = await fetch('/api/documents');
      if (!res.ok) return;
      const data = await res.json();
      this._documents = Array.isArray(data.items) ? data.items : [];

      this.renderDocumentsList();
      this.renderShareDocumentsPicker();
      this.syncShareDocumentsVisibility();
    } catch (error) {
      console.warn('Failed to load documents', error);
    }
  }

  renderDocumentsList() {
    const el = document.getElementById('documentsList');
    if (!el) return;

    if (!this._documents.length) {
      el.innerHTML = '<p class="empty-message">No documents uploaded yet.</p>';
      return;
    }

    el.innerHTML = this._documents.map(doc => {
      const label = this.escapeHtml(doc.label || doc.originalName || 'Document');
      const meta = `${this.escapeHtml(doc.type || 'Other')} • ${(doc.sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
      return `
        <div class="notification-item read" data-doc-id="${doc._id}">
          <p><strong>${label}</strong><br/><span class="muted-text">${meta}</span></p>
          <div style="display:flex; gap:8px; align-items:center;">
            <a class="btn-secondary" href="/api/documents/${encodeURIComponent(doc._id)}/download">Download</a>
            <button type="button" class="btn-secondary" data-action="delete-doc" data-id="${doc._id}">Delete</button>
          </div>
        </div>
      `;
    }).join('');

    el.querySelectorAll('button[data-action="delete-doc"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (!id) return;
        await this.deleteDocument(id);
      });
    });
  }

  async uploadDocument(formData) {
    try {
      const response = await fetch('/api/documents', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        if (typeof showMessage === 'function') {
          showMessage('Document uploaded!', 'success');
        }
        const form = document.getElementById('documentUploadForm');
        if (form) form.reset();
        await this.refreshDocuments();
      } else {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Document upload error:', error);
      if (typeof showMessage === 'function') {
        showMessage('Failed to upload document', 'error');
      }
    }
  }

  async deleteDocument(documentId) {
    if (!confirm('Delete this document?')) return;
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      if (typeof showMessage === 'function') {
        showMessage('Document deleted', 'success');
      }
      await this.refreshDocuments();
    } catch (error) {
      console.error('Delete document error:', error);
      if (typeof showMessage === 'function') {
        showMessage('Failed to delete document', 'error');
      }
    }
  }

  renderShareDocumentsPicker() {
    const picker = document.getElementById('shareDocumentsPicker');
    if (!picker) return;

    if (!this._documents.length) {
      picker.innerHTML = '<p class="empty-message">Upload documents to select them here.</p>';
      return;
    }

    picker.innerHTML = this._documents.map(doc => {
      const label = this.escapeHtml(doc.label || doc.originalName || 'Document');
      return `<label><input type="checkbox" name="doc_${doc._id}" value="${doc._id}" /> ${label}</label>`;
    }).join('');
  }

  syncShareDocumentsVisibility() {
    const form = document.getElementById('createShareCardForm');
    const wrap = document.getElementById('shareDocumentsPickerWrap');
    if (!form || !wrap) return;
    const enabled = Boolean(form.querySelector('input[name="sec_documents"]')?.checked);
    wrap.style.display = enabled ? '' : 'none';
  }

  async refreshShareCards() {
    try {
      const res = await fetch('/api/share-card');
      if (!res.ok) return;
      const data = await res.json();
      this._shareCards = Array.isArray(data.items) ? data.items : [];
      this.renderShareCardsList();
    } catch (error) {
      console.warn('Failed to load share cards', error);
    }
  }

  renderShareCardsList() {
    const el = document.getElementById('shareCardsList');
    if (!el) return;

    if (!this._shareCards.length) {
      el.innerHTML = '<p class="empty-message">No share links created yet.</p>';
      return;
    }

    const now = Date.now();
    el.innerHTML = this._shareCards.map(card => {
      const expiresAt = card.expiresAt ? new Date(card.expiresAt) : null;
      const revokedAt = card.revokedAt ? new Date(card.revokedAt) : null;
      const expired = expiresAt ? expiresAt.getTime() < now : false;
      const status = revokedAt ? 'Revoked' : (expired ? 'Expired' : 'Active');
      const canRevoke = !revokedAt && !expired;
      return `
        <div class="notification-item ${status === 'Active' ? 'unread' : 'read'}">
          <p>
            <strong>${status}</strong><br/>
            <span class="muted-text">Expires: ${expiresAt ? expiresAt.toLocaleString() : '—'} • Views: ${card.viewCount || 0}</span>
          </p>
          <div style="display:flex; gap:8px; align-items:center;">
            ${canRevoke ? `<button type="button" class="btn-secondary" data-action="revoke-share" data-id="${card._id}">Revoke</button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    el.querySelectorAll('button[data-action="revoke-share"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (!id) return;
        await this.revokeShareCard(id);
      });
    });
  }

  async revokeShareCard(shareCardId) {
    if (!confirm('Revoke this share link? Anyone with it will lose access.')) return;
    try {
      const res = await fetch(`/api/share-card/${encodeURIComponent(shareCardId)}/revoke`, { method: 'POST' });
      if (!res.ok) throw new Error('Revoke failed');
      if (typeof showMessage === 'function') {
        showMessage('Share link revoked', 'success');
      }
      await this.refreshShareCards();
    } catch (error) {
      console.error('Revoke share card error:', error);
      if (typeof showMessage === 'function') {
        showMessage('Failed to revoke share link', 'error');
      }
    }
  }

  async createShareCard(formData) {
    try {
      const expiresInDays = Number(formData.get('expiresInDays') || 30);

      const sections = {
        identity: Boolean(formData.get('sec_identity')),
        about: Boolean(formData.get('sec_about')),
        careerIntent: Boolean(formData.get('sec_careerIntent')),
        skills: Boolean(formData.get('sec_skills')),
        experience: Boolean(formData.get('sec_experience')),
        learning: Boolean(formData.get('sec_learning')),
        portfolio: Boolean(formData.get('sec_portfolio')),
        links: Boolean(formData.get('sec_links')),
        documents: Boolean(formData.get('sec_documents')),
      };

      const allowedDocumentIds = [];
      if (sections.documents) {
        for (const doc of this._documents) {
          if (formData.get(`doc_${doc._id}`)) {
            allowedDocumentIds.push(doc._id);
          }
        }
      }

      const payload = {
        expiresInDays,
        include: { sections },
        allowedDocumentIds,
      };

      const res = await fetch('/api/share-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Create failed');
      }

      const data = await res.json();
      const url = data.absoluteUrl || data.url;
      const created = document.getElementById('shareCardCreated');
      if (created) {
        created.style.display = '';
        created.innerHTML = `
          <h4>Share link created</h4>
          <p><a href="${this.escapeHtml(url)}" target="_blank">Open Share Card</a></p>
          <div style="display:flex; gap:8px; align-items:center; justify-content:center;">
            <input type="text" value="${this.escapeHtml(url)}" readonly style="max-width: 420px; width: 100%;" />
            <button type="button" class="btn-primary" id="copyShareLinkBtn">Copy</button>
          </div>
        `;
        const copyBtn = document.getElementById('copyShareLinkBtn');
        if (copyBtn) {
          copyBtn.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(url);
              if (typeof showMessage === 'function') showMessage('Copied!', 'success');
            } catch {
              if (typeof showMessage === 'function') showMessage('Copy failed', 'error');
            }
          });
        }
      }

      if (typeof showMessage === 'function') {
        showMessage('Share link created', 'success');
      }

      await this.refreshShareCards();
    } catch (error) {
      console.error('Create share card error:', error);
      if (typeof showMessage === 'function') {
        showMessage('Failed to create share link', 'error');
      }
    }
  }

  async updateProfile(formData) {
    try {
      const data = {
        bio: formData.get('bio'),
        socialLinks: {
          github: formData.get('github'),
          linkedin: formData.get('linkedin'),
          twitter: formData.get('twitter'),
        }
      };

      const response = await fetch('/api/profile/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (response.ok) {
        if (typeof showMessage === 'function') {
          showMessage('Profile updated successfully!', 'success');
        }
      } else {
        throw new Error('Update failed');
      }
    } catch (error) {
      console.error('Profile update error:', error);
      if (typeof showMessage === 'function') {
        showMessage('Failed to update profile', 'error');
      }
    }
  }

  async deletePost(postId) {
    if (!confirm('Are you sure you want to delete this post?')) return;

    try {
      const response = await fetch(`/api/posts/${postId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        if (typeof showMessage === 'function') {
          showMessage('Post deleted successfully', 'success');
        }
        location.reload();
      }
    } catch (error) {
      console.error('Delete error:', error);
      if (typeof showMessage === 'function') {
        showMessage('Failed to delete post', 'error');
      }
    }
  }

  async editPost(postId) {
    // Redirect to edit page or open edit modal
    window.location.href = `/forum?edit=${postId}`;
  }

  formatDate(date) {
    const d = new Date(date);
    const now = new Date();
    const diff = now - d;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
  }

  safeUrl(value, fallback = '') {
    try {
      const url = new URL(String(value || ''), window.location.origin);
      if (value && ['http:', 'https:'].includes(url.protocol)) return this.escapeHtml(url.href);
    } catch { /* Invalid legacy profile URLs are omitted. */ }
    return fallback;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showError(message) {
    const container = document.getElementById('profileContainer') || document.getElementById('dashboardContainer');
    if (container) {
      container.innerHTML = `<div class="error-message">${this.escapeHtml(message)}</div>`;
    }
  }
}

// Initialize on page load
let profileManager;
document.addEventListener('DOMContentLoaded', () => {
  profileManager = new ProfileManager();
});
