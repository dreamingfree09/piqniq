# Piqniq Platform - Quick Start Guide

## 🚀 Getting Started

### Prerequisites
- Node.js 22+ installed (validated on 24.11.0)
- MongoDB running locally or connection string ready
- Git for version control

### Installation

```bash
# Clone the repository (if not already)
git clone https://github.com/dreamingfree09/piqniq.git
cd piqniq

# Install the locked dependencies
npm ci

# Create .env file
cp .env.example .env
```

### Environment Variables

Create a `.env` file with the following:

```env
# MongoDB
MONGODB_URI=mongodb://localhost:27017/piqniq

# Session
SESSION_SECRET=your-secret-key-here

# Auto-logout after inactivity (minutes). Set to 0 to disable.
SESSION_IDLE_TIMEOUT_MINUTES=30

# Email (for password reset)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-email-password

# Server
PORT=3000
NODE_ENV=development

# Client URL (for email links)
BASE_URL=http://localhost:3000
```

Notes:
- If `MONGODB_URI` is not set, the server falls back to
  `mongodb://localhost:27017/piqniq` for normal application startup. Test mode instead requires explicit disposable database selection; see [isolated validation](Docs/TESTING.md).
- If port `3000` is already in use, the server will automatically try `3001`,
  `3002`, etc. (up to 10 attempts). You can also set `PORT` explicitly.

Optional (Home page Tech News feed):
```env
# Cache TTL for aggregated RSS/Atom news (milliseconds)
NEWS_CACHE_TTL_MS=600000

# Per-feed fetch timeout (milliseconds)
NEWS_FETCH_TIMEOUT_MS=7000

# Max upstream feed size (bytes)
NEWS_MAX_BYTES=750000
```

### Running the Application

```bash

# Recommended (Windows): clean ports, then start
npm run start:clean

# Or start directly
node app.js

# The server will start on <http://localhost:3000> (or the next free port)
```

### Available URLs

- **Main App**: <http://localhost:3000>
- **Forum**: <http://localhost:3000/forum>
- **Resources**: <http://localhost:3000/resources>
- **Pathways**: <http://localhost:3000/pathways>
- **Portfolio (editor)**: <http://localhost:3000/portfolio>
- **Portfolio (invite-only view)**: <http://localhost:3000/portfolio/:username?token=...>
- **Study Room (sign-in required)**: <http://localhost:3000/study>
- **Profile**: <http://localhost:3000/profile/:username>
- **Dashboard**: <http://localhost:3000/profile/dashboard>
- **Admin panel**: <http://localhost:3000/admin>
- **API Docs (Swagger)**: <http://localhost:3000/api-docs>
- **Tech News (API)**: <http://localhost:3000/api/news?limit=6>

Legacy HTML routes (still served as static files):
- `/forum.html`, `/resources.html`, `/pathways.html`, `/portfolio.html`, `/profile.html`, `/dashboard.html`, `/admin.html`

## ✅ Using the Site (Quick Checklist)

1. Start MongoDB and the server.
2. Register your first account.
  - Note: automatic “first user becomes superadmin” is disabled by default.
  - Create/promote a superadmin explicitly with: `npm run admin:bootstrap`
3. Open the admin panel at `/admin` (requires appropriate role/permissions).
  - Create curated **Tags**.
  - Add curated **Resources**.
  - Update **Pathways** content (Content/Admin).
4. If you want curated starter content immediately (recommended on a fresh/empty DB), seed it:
  - `npm run seed:curated`
4. Use the forum at `/forum` to create posts and select curated tags.
5. Build your personal portfolio at `/portfolio` and generate an invite link to share it.

Site portfolio note:
- `GET /api/site-portfolio` is public.
- Staff can manage site portfolio items (Content/Admin).

## 📚 Curated content seeding (recommended for fresh clones)

If the database is empty, the Resources page can appear blank because there are no curated `Resource` documents yet.

Run the curated seed script (safe/idempotent):

```bash
npm run seed:curated
```

Quick check (API):
- <http://localhost:3000/api/resources?page=1&limit=10>

## 🔐 Testing RBAC / Permissions

Important: Superadmins bypass permission checks. To validate real 401/403/200 behavior, use a normal (non-superadmin) account.

### Seed 2 test users (recommended)

This creates/updates two non-superadmin users:
- `rbac_denied` (no roles) – useful to confirm access is denied
- `rbac_content` (system role `Content`) – can access admin panel and manage curated content

```bash
# Optional: set a known password for both users
# PowerShell:
#   $env:RBAC_TEST_PASSWORD='YourPassword123!'

npm run rbac:seed
```

### Run an automated RBAC smoke test (creates + cleans up)

This runs a quick end-to-end permission check using temporary users and then deletes them.

```bash
npm run rbac:smoke
```

### What to try

- Sign in as `rbac_denied` and open `/admin`
  - Expected: denied (403)
- Sign in as `rbac_content` and open `/admin`
  - Expected: admin panel loads
  - Expected: can manage **Pathways** + **Resources**
  - Expected: cannot manage **Users/Roles/Audit/Logs** (should see 403 from the API)

If you want to test user/role management permissions, create or assign the `Admin`/`Moderator` system roles in the admin panel.

## 🧪 Testing

### Run Tests

```bash
# Run all tests with coverage
npm test

# Run in watch mode (for development)
npm run test:watch

# Run specific test file
npm test -- --testPathPattern="auth"
npm test -- --testPathPattern="posts"
```

Notes:
- `npm test` includes a small RBAC smoke test that creates temporary users in the test database and cleans them up.

### Test Results
- 13 tests passing
- 1 test skipped
- 33% code coverage overall

## 📚 API Documentation

### Access Swagger UI

1. Start the server: `node app.js`
2. Open browser: <http://localhost:3000/api-docs>
3. Explore all endpoints with interactive documentation

### Main API Routes

#### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password with token

#### Posts
- `GET /api/posts` - Get all posts (supports filtering, pagination)
- `POST /api/posts` - Create new post (authenticated)
- `GET /api/posts/:id` - Get single post
- `PUT /api/posts/:id` - Update post (author only)
- `DELETE /api/posts/:id` - Delete post (author only)
- `POST /api/posts/:id/like` - Like/unlike post
- `POST /api/posts/:id/replies` - Add reply to post

#### Profile
- `GET /api/profile/:username` - View user profile
- `PUT /api/profile` - Update own profile
- `GET /api/profile/notifications` - Get notifications
- `PUT /api/profile/notifications/:id/read` - Mark notification as read

#### Upload
- `POST /api/upload/avatar` - Upload avatar (authenticated, 5MB limit)
- `POST /api/upload/post-image` - Upload post image (authenticated, 10MB limit)
- `DELETE /api/upload/delete` - Delete uploaded file

#### Social
- `POST /api/social/follow/:userId` - Follow/unfollow user
- `GET /api/social/followers/:userId` - Get user's followers
- `GET /api/social/following/:userId` - Get users being followed
- `GET /api/social/feed` - Get personalized feed from followed users
- `GET /api/social/suggestions` - Get user suggestions to follow

#### Admin
- `GET /api/admin/dashboard` - Admin dashboard stats
- `GET /api/admin/users` - Manage users
- `GET /api/admin/posts` - Manage posts
- `DELETE /api/admin/posts/:id` - Delete any post
- `PUT /api/admin/users/:id/ban` - Ban/unban user

#### System
- `GET /api/system/health` - Health check
- `GET /api/system/metrics` - System metrics

## 🔌 WebSocket Events

### Server → Client Events

```javascript
// Notification received
socket.on('notification', (notification) => {
  // { type, message, link }
});

// New post broadcast
socket.on('new-post', (post) => {
  // { _id, title, author, category, ... }
});

// Post updated
socket.on('post-update', (update) => {
  // { postId, ...changes }
});

// Like update
socket.on('like-update', ({ postId, likesCount, action }) => {
  // Update UI with new like count
});

// New reply
socket.on('new-reply', ({ postId, reply }) => {
  // Add reply to post in UI
});

// User typing indicator
socket.on('user-typing', ({ postId, username }) => {
  // Show "User is typing..." indicator
});
```

### Client → Server Events

```javascript
// Authenticate socket connection
socket.emit('authenticate', { userId });

// Join a post's room for real-time updates
socket.emit('join-post', postId);

// Leave a post's room
socket.emit('leave-post', postId);

// Emit typing indicator
socket.emit('typing', { postId, username });
```

## 🖼️ Image Upload

### Client-Side Usage

```javascript
// Avatar upload
const formData = new FormData();
formData.append('avatar', fileInput.files[0]);

const response = await fetch('/api/upload/avatar', {
  method: 'POST',
  body: formData,
  credentials: 'include'
});

const { avatarUrl } = await response.json();
```

### Image Requirements
- **Avatar**: Max 5MB, formats: JPEG, PNG, GIF, WebP
- **Post Image**: Max 10MB, formats: JPEG, PNG, GIF, WebP
- Files stored in `/public/uploads/avatars` and `/public/uploads/posts`

## 🎮 Gamification System

### Reputation Points
- Create post: +10
- Receive like: +5
- Create reply: +3
- Give like: +1

### Available Badges
1. **First Post** - Create your first post
2. **Early Adopter** - Be an early platform user
3. **Conversation Starter** - Create 10 posts
4. **Popular** - Get 50 total likes
5. **Influencer** - Get 100 total likes
6. **Active Contributor** - Create 25 posts
7. **Discussion Master** - Create 50 posts
8. **Community Legend** - Get 500 total likes

Badges are awarded automatically and trigger real-time WebSocket notifications!

## 👥 Social Features

### Following Users

```javascript
// Follow a user
const response = await fetch(`/api/social/follow/${userId}`, {
  method: 'POST',
  credentials: 'include'
});

const { isFollowing } = await response.json();
// isFollowing: true if now following, false if unfollowed
```

### Personalized Feed

```javascript
// Get posts from users you follow
const response = await fetch('/api/social/feed', {
  credentials: 'include'
});

const { posts } = await response.json();
// Returns up to 50 most recent posts from followed users
```

### User Suggestions

```javascript
// Get suggested users to follow
const response = await fetch('/api/social/suggestions', {
  credentials: 'include'
});

const { users } = await response.json();
// Returns top 10 users by reputation (excluding already followed)
```

## 🛠️ Development Tools

### Logger Utility

```javascript
const { Logger } = require('./utils/logger');

// Log levels: info, warn, error
Logger.info('Message', { metadata });
Logger.warn('Warning message', { metadata });
Logger.error('Error message', { error: err.message });
```

### Validation

```javascript
const {
  registrationValidation,
  loginValidation,
  createPostValidation
} = require('./utils/validators');

// Use in routes
router.post('/register', registrationValidation, async (req, res) => {
  // Validation errors are handled automatically
});
```

## 🐛 Troubleshooting

### Common Issues

**MongoDB Connection Error**
```
Solution: Make sure MongoDB is running
$ mongod --dbpath=/path/to/data
```

**Port Already in Use**
```
Solution: Kill existing node processes
$ taskkill /F /IM node.exe
```

**WebSocket Not Connecting**
```
Solution: Check that server is running and Socket.io client script is loaded
<script src="/socket.io/socket.io.js"></script>
```

**Tests Failing**
```
Solution: Ensure NODE_ENV is set to 'test'
$ $env:NODE_ENV="test"; npm test
```

### Debug Mode

```bash
# Enable detailed logging
$env:DEBUG="*"
node app.js
```

## 📖 Further Reading

- [Express.js Documentation](https://expressjs.com/)
- [MongoDB Documentation](https://docs.mongodb.com/)
- [Socket.io Documentation](https://socket.io/docs/)
- [Jest Documentation](https://jestjs.io/)
- [Multer Documentation](https://github.com/expressjs/multer)
- [Swagger Documentation](https://swagger.io/docs/)

## 🤝 Contributing

1. Create feature branch: `git checkout -b feature/new-feature`
2. Write tests for new features
3. Ensure tests pass: `npm test`
4. Commit changes: `git commit -m 'Add new feature'`
5. Push branch: `git push origin feature/new-feature`
6. Create Pull Request

## 📄 License

See LICENSE file for details.

---

**Happy Coding! 🚀**

For questions or support, please open an issue on GitHub.

## Safe validation

Follow [isolated validation](Docs/TESTING.md) before running tests, chat smoke checks or local test servers. Set HOST=127.0.0.1 for private fixtures and use a new database/data directory; do not run start:clean or seed/bootstrap scripts against existing data.
