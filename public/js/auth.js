/**
 * public/js/auth.js
 *
 * Client-side authentication state manager.
 *
 * Tracks current user, syncs with `/api/auth/me`, and updates nav/UI.
 * Uses session cookies (credentials: include) to maintain login state.
 */
class Auth {
  constructor() {
    this.currentUser = null;
    // Best-effort immediate UI to reduce header layout shifts while the network call runs.
    try {
      const stored = localStorage.getItem('currentUser');
      if (stored) {
        this.currentUser = JSON.parse(stored);
      }
    } catch {
      // ignore storage/parse failures
    }

    this.updateUI();
    this.checkAuthStatus();
  }

  async checkAuthStatus() {
    try {
      const response = await fetch('/api/auth/me');
      if (response.ok) {
        const data = await response.json();
        this.currentUser = data.user;
        try {
          localStorage.setItem('currentUser', JSON.stringify(data.user));
        } catch {
          // ignore storage failures
        }
      } else {
        // Important: a 401/403 here means localStorage is stale.
        this.currentUser = null;
        try {
          localStorage.removeItem('currentUser');
        } catch {
          // ignore storage failures
        }
      }
    } catch (error) {
      console.log('Not authenticated');
      this.currentUser = null;
      try {
        localStorage.removeItem('currentUser');
      } catch {
        // ignore storage failures
      }
    }
    // Always update UI after checking status
    this.updateUI();
  }

  async register(email, password, username) {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, username })
      });

      const data = await response.json();

      if (!response.ok) {
        const details = Array.isArray(data?.details) && data.details.length
          ? data.details.map(d => d?.message).filter(Boolean).join(' ')
          : '';

        throw new Error(details || data.error || 'Registration failed');
      }

      this.currentUser = data.user;
      try {
        localStorage.setItem('currentUser', JSON.stringify(data.user));
      } catch {
        // ignore storage failures
      }
      this.updateUI();
      try {
        window.dispatchEvent(new CustomEvent('auth:changed', { detail: { user: this.currentUser } }));
      } catch {
        // ignore
      }
      return { success: true, user: data.user };
    } catch (error) {
      const msg = String(error?.message || 'Registration failed');
      const isNetwork = /Failed to fetch|NetworkError|Load failed/i.test(msg);
      return {
        success: false,
        error: isNetwork
          ? 'Cannot reach the server. Make sure the site is opened at http://localhost:3000 and the server is running.'
          : msg
      };
    }
  }

  async login(email, password) {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        const details = Array.isArray(data?.details) && data.details.length
          ? data.details.map(d => d?.message).filter(Boolean).join(' ')
          : '';
        throw new Error(details || data.error || 'Login failed');
      }

      this.currentUser = data.user;
      try {
        localStorage.setItem('currentUser', JSON.stringify(data.user));
      } catch {
        // ignore storage failures
      }
      this.updateUI();
      try {
        window.dispatchEvent(new CustomEvent('auth:changed', { detail: { user: this.currentUser } }));
      } catch {
        // ignore
      }
      return { success: true, user: data.user };
    } catch (error) {
      const msg = String(error?.message || 'Login failed');
      const isNetwork = /Failed to fetch|NetworkError|Load failed/i.test(msg);
      return {
        success: false,
        error: isNetwork
          ? 'Cannot reach the server. Make sure the site is opened at http://localhost:3000 and the server is running.'
          : msg
      };
    }
  }

  async logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      this.currentUser = null;
      try {
        localStorage.removeItem('currentUser');
      } catch {
        // ignore storage failures
      }
      this.updateUI();
      try {
        window.dispatchEvent(new CustomEvent('auth:changed', { detail: { user: null } }));
      } catch {
        // ignore
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  updateUI() {
    const authButtons = document.querySelector('.auth-buttons');
    if (!authButtons) return;

    if (this.currentUser) {
      const canAdmin = Boolean(this.currentUser?.isSuperAdmin)
        || Array.isArray(this.currentUser?.permissions)
          && this.currentUser.permissions.includes('admin:access');

      authButtons.innerHTML = `
        <button id="themeToggle" class="theme-toggle" aria-label="Toggle dark mode">
          <span class="theme-icon">🌙</span>
        </button>
        ${canAdmin ? `
          <a href="/admin.html" style="color: #667eea; font-weight: 600; text-decoration: none; margin-right: 15px;">
            Admin
          </a>
        ` : ''}
        <a href="/dashboard.html" style="color: #667eea; font-weight: 600; text-decoration: none; margin-right: 15px;">
          Dashboard
        </a>
        <a href="/profile.html?user=${this.currentUser.username}" style="color: #667eea; font-weight: 600; text-decoration: none; margin-right: 15px;">
          ${this.currentUser.username}
        </a>
        <button id="logoutBtn" style="background-color: #333; color: #FFF;">Logout</button>
      `;

      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
          await this.logout();
          window.location.reload();
        });
      }
      
      // Reinitialize theme toggle after updating UI
      if (window.themeManager) {
        window.themeManager.initializeToggle();
      }

      // Hide the CTA section at the bottom when logged in
      const forumCta = document.querySelector('.forum-cta');
      if (forumCta) {
        forumCta.style.display = 'none';
      }

      // Show create post button when logged in
      const createPostBtn = document.getElementById('createPostBtn');
      if (createPostBtn) {
        createPostBtn.style.display = 'block';
      }
    } else {
      // Reset to original buttons when not logged in
      authButtons.innerHTML = `
        <button id="themeToggle" class="theme-toggle" aria-label="Toggle dark mode">
          <span class="theme-icon">🌙</span>
        </button>
        <button id="signIn">Sign In</button>
        <button id="register">Register</button>
      `;
      
      // Reinitialize theme toggle
      if (window.themeManager) {
        window.themeManager.initializeToggle();
      }
      
      // Show the CTA section when not logged in
      const forumCta = document.querySelector('.forum-cta');
      if (forumCta) {
        forumCta.style.display = 'block';
      }

      // Hide create post button when not logged in
      const createPostBtn = document.getElementById('createPostBtn');
      if (createPostBtn) {
        createPostBtn.style.display = 'none';
      }
    }
  }
}

// Initialize auth
const auth = new Auth();
// Expose for other scripts (forum.js uses window.auth)
window.auth = auth;

// Handle form submissions when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const getSafeNextUrl = () => {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = String(params.get('next') || '').trim();
      if (!raw) return null;

      // Prevent open redirects: only allow same-site relative paths.
      if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes(String.fromCharCode(92))) return null;
      const url = new URL(raw, window.location.origin);
      if (url.origin !== window.location.origin) return null;
      return url.pathname + url.search + url.hash;
    } catch {
      return null;
    }
  };

  // Sign in form
  const signInForm = document.getElementById('signInForm');
  if (signInForm) {
    signInForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const email = signInForm.querySelector('input[name="email"]').value;
      const password = signInForm.querySelector('input[name="password"]').value;

      const result = await auth.login(email, password);
      
      if (result.success) {
        document.getElementById('signInModal').style.display = 'none';
        signInForm.reset();
        showMessage('Login successful!', 'success');

        const nextUrl = getSafeNextUrl();
        if (nextUrl) {
          window.location.assign(nextUrl);
        }
      } else {
        showMessage(result.error, 'error');
      }
    });
  }

  // Register form
  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const username = registerForm.querySelector('input[name="username"]').value;
      const email = registerForm.querySelector('input[name="email"]').value;
      const password = registerForm.querySelector('input[name="password"]').value;
      const confirmPassword = registerForm.querySelector('input[name="confirmPassword"]').value;

      if (password !== confirmPassword) {
        showMessage('Passwords do not match', 'error');
        return;
      }

      if (!username || !email || !password) {
        showMessage('All fields are required', 'error');
        return;
      }

      const result = await auth.register(email, password, username);
      
      if (result.success) {
        document.getElementById('registerModal').style.display = 'none';
        registerForm.reset();
        showMessage('Registration successful!', 'success');

        const nextUrl = getSafeNextUrl();
        if (nextUrl) {
          window.location.assign(nextUrl);
        }
      } else {
        showMessage(result.error, 'error');
      }
    });
  }
});

// Show message to user (toast). Backwards-compatible with existing calls.
// Options:
// - actionText: string
// - onAction: function
// - durationMs: number (default 3500)
function showMessage(message, type = 'info', options = {}) {
  const resolvedType = ['success', 'error', 'info'].includes(type) ? type : 'info';
  const durationMs = Number(options?.durationMs) > 0 ? Number(options.durationMs) : 3500;

  const toast = document.createElement('div');
  toast.className = `toast ${resolvedType}`;

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = resolvedType === 'success' ? '✅' : resolvedType === 'error' ? '⚠️' : 'ℹ️';

  const msg = document.createElement('div');
  msg.className = 'toast-message';
  msg.textContent = String(message || '');

  toast.appendChild(icon);
  toast.appendChild(msg);

  if (options?.actionText && typeof options?.onAction === 'function') {
    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'toast-action';
    actionBtn.textContent = String(options.actionText);
    actionBtn.addEventListener('click', () => {
      try {
        options.onAction();
      } finally {
        removeToast();
      }
    });
    toast.appendChild(actionBtn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  toast.appendChild(closeBtn);

  document.body.appendChild(toast);

  const removeToast = () => {
    toast.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  };

  closeBtn.addEventListener('click', removeToast);

  if (!options?.actionText) {
    setTimeout(removeToast, durationMs);
  } else {
    // Keep undo/action toasts around a bit longer.
    setTimeout(removeToast, Math.max(durationMs, 8000));
  }
}

window.showMessage = window.showMessage || showMessage;
