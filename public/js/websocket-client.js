/**
 * public/js/websocket-client.js
 *
 * WebSocket client helper.
 *
 * Connects to Socket.IO when a user is signed in and listens for server events
 * (notifications, post updates, etc.).
 */
class WebSocketClient {
  constructor() {
    this.socket = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
    this.init();
  }

  init() {
    // Only connect if user is logged in
    const currentUser = localStorage.getItem('currentUser');
    if (!currentUser) return;

    try {
      const userData = JSON.parse(currentUser);
      this.connect(userData._id || userData.id);
    } catch (error) {
      console.error('Failed to parse user data:', error);
    }
  }

  connect(userId) {
    // Load Socket.IO from CDN if not already loaded
    if (typeof io === 'undefined') {
      const script = document.createElement('script');
      script.src = '/socket.io/socket.io.js';
      script.onload = () => this.establishConnection(userId);
      document.head.appendChild(script);
    } else {
      this.establishConnection(userId);
    }
  }

  establishConnection(userId) {
    this.socket = io({
      reconnection: true,
      reconnectionDelay: this.reconnectDelay,
      reconnectionAttempts: this.maxReconnectAttempts
    });

    this.socket.on('connect', () => {
      console.log('✅ WebSocket connected');
      this.reconnectAttempts = 0;
      
      // Authenticate user
      this.socket.emit('authenticate', userId);
    });

    this.socket.on('authenticated', (data) => {
      console.log('✅ WebSocket authenticated:', data);
    });

    // Listen for real-time notifications
    this.socket.on('notification', (notification) => {
      console.log('📬 New notification:', notification);
      
      // Add to notifications manager if exists
      if (window.notificationsManager) {
        window.notificationsManager.addNotification(notification);
      }
      
      // Show browser notification if permitted
      this.showBrowserNotification(notification);
    });

    // Listen for new posts
    this.socket.on('new-post', (post) => {
      console.log('📝 New post:', post);
      
      // Refresh forum if on forum page
      if (window.location.pathname.includes('forum')) {
        this.showNewPostAlert(post);
      }
    });

    // Listen for post updates
    this.socket.on('post-update', (update) => {
      console.log('🔄 Post update:', update);
      this.handlePostUpdate(update);
    });

    // Listen for like updates
    this.socket.on('like-update', (data) => {
      console.log('❤️ Like update:', data);
      this.handleLikeUpdate(data);
    });

    // Listen for new replies
    this.socket.on('new-reply', (reply) => {
      console.log('💬 New reply:', reply);
      this.handleNewReply(reply);
    });

    // Listen for typing indicators
    this.socket.on('user-typing', (data) => {
      this.showTypingIndicator(data);
    });

    this.socket.on('disconnect', () => {
      console.log('❌ WebSocket disconnected');
    });

    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      this.reconnectAttempts++;
    });
  }

  // Show browser notification
  showBrowserNotification(notification) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Piqniq', {
        body: notification.message,
        icon: '/images/logo.png',
        badge: '/images/logo.png'
      });
    }
  }

  // Show new post alert
  showNewPostAlert(post) {
    const alert = document.createElement('div');
    alert.className = 'toast info';
    alert.innerHTML = `
      <span class="toast-icon">📝</span>
      <div class="toast-message">
        <strong>New Post:</strong> ${post.title}
      </div>
      <button class="toast-close" onclick="this.parentElement.remove()">×</button>
    `;
    document.body.appendChild(alert);
    
    setTimeout(() => alert.remove(), 5000);
  }

  // Handle post update
  handlePostUpdate(update) {
    const postElement = document.querySelector(`[data-post-id="${update.postId}"]`);
    if (postElement) {
      // Update post content in DOM
      if (update.field === 'likes') {
        const likesElement = postElement.querySelector('.likes-count');
        if (likesElement) {
          likesElement.textContent = update.value;
        }
      }
    }
  }

  // Handle like update
  handleLikeUpdate(data) {
    const likeButton = document.querySelector(`[data-post-id="${data.postId}"] .like-btn`);
    if (likeButton) {
      const countElement = likeButton.querySelector('.like-count');
      if (countElement) {
        countElement.textContent = data.likesCount;
      }
    }
  }

  // Handle new reply
  handleNewReply(reply) {
    const repliesContainer = document.querySelector(`[data-post-id="${reply.postId}"] .replies-list`);
    if (repliesContainer) {
      const replyElement = document.createElement('div');
      replyElement.className = 'reply-item new-reply';
      replyElement.innerHTML = `
        <div class="reply-header">
          <img src="${reply.author.avatar}" alt="${reply.author.username}" class="reply-avatar">
          <strong>${reply.author.username}</strong>
          <span class="reply-time">Just now</span>
        </div>
        <div class="reply-content">${reply.content}</div>
      `;
      repliesContainer.appendChild(replyElement);
      
      // Animate new reply
      setTimeout(() => replyElement.classList.remove('new-reply'), 100);
    }
  }

  // Show typing indicator
  showTypingIndicator(data) {
    const indicator = document.querySelector(`[data-post-id="${data.postId}"] .typing-indicator`);
    if (indicator) {
      indicator.textContent = `${data.username} is typing...`;
      indicator.style.display = 'block';
      
      setTimeout(() => {
        indicator.style.display = 'none';
      }, 3000);
    }
  }

  // Emit typing event
  emitTyping(postId, username) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('typing', { postId, username });
    }
  }

  // Join post room
  joinPost(postId) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('join-post', postId);
    }
  }

  // Leave post room
  leavePost(postId) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('leave-post', postId);
    }
  }

  // Disconnect
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

// Request notification permission only when signed in.
// This avoids surprising permission prompts on every page load.
try {
  const currentUser = localStorage.getItem('currentUser');
  if (currentUser && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
} catch {
  // ignore storage access errors
}

// Initialize WebSocket client
document.addEventListener('DOMContentLoaded', () => {
  window.wsClient = new WebSocketClient();
});
