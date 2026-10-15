/**
 * routes/system.js
 *
 * System/ops endpoints.
 *
 * Includes a health check that is safe even when MongoDB is disconnected (avoid hanging).
 */
const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
const User = require('../models/User');
const { generateStructuredData } = require('../utils/seo');
const { Logger } = require('../utils/logger');
const { stableHash } = require('../utils/privacy');

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'UP',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development'
    };

    // Check database connection
    const dbState = require('mongoose').connection.readyState;
    health.database = dbState === 1 ? 'connected' : 'disconnected';

    // Get basic stats (avoid hanging when Mongo isn't connected)
    let userCount = 0;
    let postCount = 0;
    if (dbState === 1) {
      [userCount, postCount] = await Promise.all([
        User.countDocuments(),
        Post.countDocuments()
      ]);
    }

    health.stats = {
      users: userCount,
      posts: postCount,
      memoryUsage: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
      }
    };

    res.json(health);
  } catch (error) {
    res.status(503).json({
      status: 'DOWN',
      error: error.message
    });
  }
});

// Generate sitemap
router.get('/sitemap.xml', async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:3000';
    
    // Get all posts for sitemap
    const posts = await Post.find({ deletedAt: null })
      .select('_id updatedAt')
      .sort({ updatedAt: -1 })
      .limit(1000);

    // Get all users for sitemap
    const users = await User.find()
      .select('username createdAt')
      .sort({ updatedAt: -1 })
      .limit(1000);

    // Static pages
    const staticPages = [
      { loc: '/', priority: '1.0', changefreq: 'daily' },
      { loc: '/forum.html', priority: '1.0', changefreq: 'hourly' },
      { loc: '/portfolio.html', priority: '0.8', changefreq: 'weekly' },
      { loc: '/portfolio', priority: '0.8', changefreq: 'weekly' },
      { loc: '/pathways.html', priority: '0.8', changefreq: 'weekly' }
    ];

    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    // Add static pages
    staticPages.forEach(page => {
      sitemap += `
  <url>
    <loc>${baseUrl}${page.loc}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`;
    });

    // Add post pages
    posts.forEach(post => {
      sitemap += `
  <url>
    <loc>${baseUrl}/post/${post._id}</loc>
    <lastmod>${post.updatedAt.toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
    });

    // Add user profiles
    users.forEach(user => {
      sitemap += `
  <url>
    <loc>${baseUrl}/profile.html?user=${user.username}</loc>
    <lastmod>${user.createdAt.toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
    });

    sitemap += '\n</urlset>';

    res.header('Content-Type', 'application/xml');
    res.send(sitemap);
  } catch (error) {
    res.status(500).json({ error: 'Error generating sitemap' });
  }
});

// Robots.txt
router.get('/robots.txt', (req, res) => {
  const baseUrl = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:3000';
  
  const robots = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /logs/

Sitemap: ${baseUrl}/api/system/sitemap.xml`;

  res.header('Content-Type', 'text/plain');
  res.send(robots);
});

// Get post metadata for SEO (for dynamic meta tag generation)
router.get('/meta/post/:id', async (req, res) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, deletedAt: null })
      .populate('author', 'username avatar')
      .select('title content createdAt updatedAt author likes replies category');

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const structuredData = generateStructuredData('DiscussionForumPosting', post);

    res.json({
      title: `${post.title} - Piqniq Forum`,
      description: post.content.substring(0, 160),
      keywords: `${post.category}, forum, discussion, programming`,
      structuredData,
      author: post.author.username,
      url: `/post.html?id=${post._id}`,
      image: post.author.avatar || '/images/logo.png'
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching metadata' });
  }
});

// Get user metadata for SEO
router.get('/meta/user/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .select('username bio avatar socialLinks reputation badges');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const structuredData = generateStructuredData('Person', user);

    res.json({
      title: `${user.username}'s Profile - Piqniq`,
      description: user.bio || `View ${user.username}'s profile, posts, and contributions on Piqniq.`,
      keywords: `${user.username}, developer, profile, piqniq`,
      structuredData,
      url: `/profile.html?user=${user.username}`,
      image: user.avatar || '/images/logo.png'
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching metadata' });
  }
});

// Analytics endpoint (for future integration)
router.post('/analytics/track', (req, res) => {
  // This placeholder has no external analytics sink. Do not retain arbitrary
  // client data or raw network identifiers in an unauthenticated log endpoint.
  Logger.info('Analytics event', { eventHash: stableHash(String(req.body?.event || '').slice(0, 200)) });

  res.json({ success: true });
});

module.exports = router;
