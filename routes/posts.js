/**
 * routes/posts.js
 *
 * Forum posts API.
 *
 * Key behaviors:
 * - Validates and normalizes curated tag slugs (tags must exist and be active)
 * - Enforces auth/verification requirements for write actions
 * - Implements voting + reputation changes + badge checks
 */
const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
const Vote = require('../models/Vote');
const User = require('../models/User');
const Tag = require('../models/Tag');
const { isAuthenticated, requireVerifiedEmail } = require('../middleware/auth');
const { createPostValidation, updatePostValidation, createReplyValidation } = require('../utils/validators');
const { updateReputation, checkAndAwardBadges } = require('../utils/gamification');

const REP = {
  POST_UPVOTE: 5,
  POST_DOWNVOTE: -2,
  REPLY_UPVOTE: 10,
  REPLY_DOWNVOTE: -2,
  ACCEPTED_ANSWER: 15,
};

const repForVote = (targetType, value) => {
  if (value === 0) return 0;
  if (targetType === 'post') return value === 1 ? REP.POST_UPVOTE : REP.POST_DOWNVOTE;
  return value === 1 ? REP.REPLY_UPVOTE : REP.REPLY_DOWNVOTE;
};

const clampReputation = (rep) => Math.max(0, rep);
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
router.param('id', (req, res, next, id) => /^[a-f0-9]{24}$/i.test(id) ? next() : res.status(400).json({ error: 'Invalid ID format' }));

const normalizePostTags = (value) => {
  const arr = Array.isArray(value) ? value : [];
  return Array.from(new Set(arr.map(v => String(v || '').trim().toLowerCase()).filter(Boolean))).slice(0, 8);
};

const assertTagsExist = async (slugs) => {
  if (!slugs.length) return;
  const existing = await Tag.find({ slug: { $in: slugs }, isActive: true }).select('slug');
  const allowed = new Set(existing.map(t => t.slug));
  const invalid = slugs.filter(s => !allowed.has(s));
  if (invalid.length) {
    const err = new Error(`Unknown tags: ${invalid.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }
};

// Get all posts (with pagination, category filter, and sorting)
router.get('/', async (req, res) => {
  try {
    const { category, page = 1, limit = 10, sort = 'newest', search, tag, solved } = req.query;
    let query = category && category !== 'all' ? { category } : {};
    query.deletedAt = null;

    if (tag) {
      query.tags = String(tag).trim().toLowerCase();
    }

    if (solved === 'true') {
      query.acceptedReplyId = { $ne: null };
    } else if (solved === 'false') {
      query.acceptedReplyId = null;
    }

    // Add search functionality (fallback to regex; unified search uses /api/search)
    if (search) {
      if (typeof search !== 'string' || search.length > 200) return res.status(400).json({ error: 'Invalid search text' });
      query.$or = [
        { title: { $regex: escapeRegex(search), $options: 'i' } },
        { content: { $regex: escapeRegex(search), $options: 'i' } }
      ];
    }

    // Determine sort order
    let sortOption = { createdAt: -1 }; // Default: newest
    if (sort === 'oldest') sortOption = { createdAt: 1 };
    else if (sort === 'popular') sortOption = { likes: -1, views: -1 };
    else if (sort === 'mostReplies') sortOption = { 'replies': -1 };

    const safeLimit = Math.min(50, Math.max(1, Number.parseInt(String(limit), 10) || 10));
    const safePage = Math.min(10000, Math.max(1, Number.parseInt(String(page), 10) || 1));

    // Pinned posts first
    const pinnedPosts = await Post.find({ ...query, isPinned: true })
      .select('title category author createdAt voteScore views isPinned likes acceptedReplyId replies._id')
      .populate('author', 'username avatar reputation')
      .sort(sortOption)
      .limit(100)
      .lean();

    const regularPosts = await Post.find({ ...query, isPinned: false })
      .select('title category author createdAt voteScore views isPinned likes acceptedReplyId replies._id')
      .populate('author', 'username avatar reputation')
      .sort(sortOption)
      .limit(safeLimit)
      .skip((safePage - 1) * safeLimit)
      .lean();

    const count = await Post.countDocuments({ ...query, isPinned: false });

    res.json({
      posts: [...pinnedPosts, ...regularPosts],
      totalPages: Math.ceil(count / safeLimit),
      currentPage: safePage,
      total: count + pinnedPosts.length
    });
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single post by ID
router.get('/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('author', 'username avatar reputation')
      .populate('replies.author', 'username avatar reputation');

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.deletedAt) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Increment views
    post.views += 1;
    await post.save();

    res.json({ post });
  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create new post (authenticated)
router.post('/', isAuthenticated, requireVerifiedEmail, createPostValidation, async (req, res) => {
  try {
    const { title, content, category } = req.body;
    const tags = normalizePostTags(req.body?.tags);
    await assertTagsExist(tags);

    const post = new Post({
      title,
      content,
      category,
      tags,
      author: req.session.userId
    });

    await post.save();
    await post.populate('author', 'username avatar');

    // Update reputation and check for badges
    await updateReputation(req.session.userId, 'POST_CREATED');
    await checkAndAwardBadges(req.session.userId);

    res.status(201).json({ post });
  } catch (error) {
    console.error('Create post error:', error);
    const code = Number(error?.statusCode || 0);
    if (code) {
      return res.status(code).json({ error: error.message });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Add reply to post (authenticated)
router.post('/:id/replies', isAuthenticated, requireVerifiedEmail, createReplyValidation, async (req, res) => {
  try {
    const { content, parentReplyId } = req.body;

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    let resolvedParentReplyId = null;
    let depth = 1;

    if (parentReplyId) {
      const parent = post.replies.id(parentReplyId);
      if (!parent) {
        return res.status(400).json({ error: 'Parent reply not found' });
      }

      const parentDepth = Number(parent.depth) || 1;
      depth = parentDepth + 1;

      if (depth > 5) {
        return res.status(400).json({ error: 'Maximum reply depth is 5 levels' });
      }

      resolvedParentReplyId = parent._id;
    }

    post.replies.push({
      content,
      author: req.session.userId,
      parentReplyId: resolvedParentReplyId,
      depth,
    });

    await post.save();
    await post.populate('replies.author', 'username avatar');

    // Update reputation and check for badges
    await updateReputation(req.session.userId, 'REPLY_CREATED');
    await checkAndAwardBadges(req.session.userId);

    // Send WebSocket notification to post author
    if (post.author.toString() !== req.session.userId && global.wsManager) {
      const replier = await User.findById(req.session.userId);
      global.wsManager.sendNotification(post.author, {
        type: 'reply',
        message: `${replier.username} replied to your post: ${post.title}`,
        link: `/post/${post._id}`
      });
    }

    // Broadcast new reply via WebSocket
    if (global.wsManager) {
      global.wsManager.sendReplyNotification(post._id, post.replies[post.replies.length - 1]);
    }

    res.status(201).json({ post });
  } catch (error) {
    console.error('Add reply error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete post (authenticated, author only)
router.delete('/:id', isAuthenticated, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.author.toString() !== req.session.userId) {
      return res.status(403).json({ error: 'Not authorized to delete this post' });
    }

    if (!post.deletedAt) {
      post.deletedAt = new Date();
      await post.save();
    }

    res.json({ message: 'Post deleted successfully', postId: post._id, deletedAt: post.deletedAt });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Restore post (authenticated, author only)
router.post('/:id/restore', isAuthenticated, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.author.toString() !== req.session.userId) {
      return res.status(403).json({ error: 'Not authorized to restore this post' });
    }

    if (!post.deletedAt) {
      return res.json({ message: 'Post already active', post });
    }

    // Allow restore for a limited time window (10 minutes).
    const tenMinutesMs = 10 * 60 * 1000;
    if (Date.now() - new Date(post.deletedAt).getTime() > tenMinutesMs) {
      return res.status(400).json({ error: 'Restore window expired' });
    }

    post.deletedAt = null;
    await post.save();
    await post.populate('author', 'username avatar');

    res.json({ message: 'Post restored', post });
  } catch (error) {
    console.error('Restore post error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Edit reply (authenticated, author only)
router.put('/:id/replies/:replyId', isAuthenticated, requireVerifiedEmail, async (req, res) => {
  try {
    const { content } = req.body;
    const next = String(content || '').trim();
    if (!next) {
      return res.status(400).json({ error: 'Reply cannot be empty' });
    }
    if (next.length > 5000) {
      return res.status(400).json({ error: 'Reply too long' });
    }

    const post = await Post.findById(req.params.id).populate('replies.author', 'username avatar reputation');
    if (!post || post.deletedAt) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const reply = post.replies.id(req.params.replyId);
    if (!reply) {
      return res.status(404).json({ error: 'Reply not found' });
    }

    if (reply.author && reply.author._id) {
      if (reply.author._id.toString() !== req.session.userId) {
        return res.status(403).json({ error: 'Not authorized to edit this reply' });
      }
    } else if (String(reply.author || '') !== req.session.userId) {
      return res.status(403).json({ error: 'Not authorized to edit this reply' });
    }

    if (reply.deletedAt) {
      return res.status(400).json({ error: 'Cannot edit a deleted reply' });
    }

    reply.content = next;
    reply.editedAt = new Date();
    post.updatedAt = Date.now();
    await post.save();

    res.json({ post });
  } catch (error) {
    console.error('Edit reply error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete reply (authenticated, author only) - soft delete with restore window
router.delete('/:id/replies/:replyId', isAuthenticated, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id).populate('replies.author', 'username avatar reputation');
    if (!post || post.deletedAt) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const reply = post.replies.id(req.params.replyId);
    if (!reply) {
      return res.status(404).json({ error: 'Reply not found' });
    }

    const replyAuthorId = reply.author && reply.author._id
      ? reply.author._id.toString()
      : String(reply.author || '');

    if (replyAuthorId !== req.session.userId) {
      return res.status(403).json({ error: 'Not authorized to delete this reply' });
    }

    if (!reply.deletedAt) {
      reply.deletedAt = new Date();
      reply.deletedContent = String(reply.content || '');
      reply.content = '[deleted]';
      post.updatedAt = Date.now();
      await post.save();
    }

    res.json({ message: 'Reply deleted', post, replyId: reply._id, deletedAt: reply.deletedAt });
  } catch (error) {
    console.error('Delete reply error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Restore reply (authenticated, author only)
router.post('/:id/replies/:replyId/restore', isAuthenticated, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id).populate('replies.author', 'username avatar reputation');
    if (!post || post.deletedAt) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const reply = post.replies.id(req.params.replyId);
    if (!reply) {
      return res.status(404).json({ error: 'Reply not found' });
    }

    const replyAuthorId = reply.author && reply.author._id
      ? reply.author._id.toString()
      : String(reply.author || '');

    if (replyAuthorId !== req.session.userId) {
      return res.status(403).json({ error: 'Not authorized to restore this reply' });
    }

    if (!reply.deletedAt) {
      return res.json({ message: 'Reply already active', post });
    }

    const tenMinutesMs = 10 * 60 * 1000;
    if (Date.now() - new Date(reply.deletedAt).getTime() > tenMinutesMs) {
      return res.status(400).json({ error: 'Restore window expired' });
    }

    reply.deletedAt = null;
    if (reply.content === '[deleted]' && reply.deletedContent) {
      reply.content = reply.deletedContent;
    }
    reply.deletedContent = null;
    post.updatedAt = Date.now();
    await post.save();

    res.json({ message: 'Reply restored', post });
  } catch (error) {
    console.error('Restore reply error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Edit post (authenticated, author only)
router.put('/:id', isAuthenticated, updatePostValidation, async (req, res) => {
  try {
    const { title, content } = req.body;
    const tags = req.body?.tags !== undefined ? normalizePostTags(req.body?.tags) : null;
    if (tags) {
      await assertTagsExist(tags);
    }
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.author.toString() !== req.session.userId) {
      return res.status(403).json({ error: 'Not authorized to edit this post' });
    }

    if (title) post.title = title;
    if (content) post.content = content;
    if (tags) post.tags = tags;
    post.updatedAt = Date.now();

    await post.save();
    await post.populate('author', 'username avatar');

    res.json({ post });
  } catch (error) {
    console.error('Edit post error:', error);
    const code = Number(error?.statusCode || 0);
    if (code) {
      return res.status(code).json({ error: error.message });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Like/Unlike post (authenticated)
router.post('/:id/like', isAuthenticated, requireVerifiedEmail, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const userIndex = post.likes.indexOf(req.session.userId);

    if (userIndex > -1) {
      // Unlike
      post.likes.splice(userIndex, 1);
    } else {
      // Like
      post.likes.push(req.session.userId);
      
      // Update reputation for post author
      await updateReputation(post.author, 'POST_LIKED');
      await checkAndAwardBadges(post.author);
      
      // Add notification to post author (if not self-like)
      if (post.author.toString() !== req.session.userId) {
        const User = require('../models/User');
        const liker = await User.findById(req.session.userId);
        await User.findByIdAndUpdate(post.author, {
          $push: {
            notifications: {
              type: 'like',
              message: `${liker.username} liked your post: ${post.title}`,
              link: `/post/${post._id}`,
              read: false
            }
          }
        });

        // Send WebSocket notification
        if (global.wsManager) {
          global.wsManager.sendNotification(post.author, {
            type: 'like',
            message: `${liker.username} liked your post: ${post.title}`,
            link: `/post/${post._id}`
          });
        }
      }

      // Broadcast like update via WebSocket
      if (global.wsManager) {
        global.wsManager.sendLikeUpdate(post._id, {
          postId: post._id,
          likesCount: post.likes.length,
          action: 'like'
        });
      }
    }

    await post.save();
    await post.populate('likes', 'username');

    res.json({ likes: post.likes, likesCount: post.likes.length });
  } catch (error) {
    console.error('Like post error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Vote on a post (authenticated + verified email)
router.post('/:id/vote', isAuthenticated, requireVerifiedEmail, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const requestedValue = Number(req.body?.value);
    if (![1, -1, 0].includes(requestedValue)) {
      return res.status(400).json({ error: 'Invalid vote value' });
    }

    if (post.author.toString() === req.session.userId) {
      return res.status(400).json({ error: 'You cannot vote on your own post' });
    }

    const existing = await Vote.findOne({
      voter: req.session.userId,
      post: post._id,
      replyId: null,
      targetType: 'post'
    });

    const oldValue = existing ? existing.value : 0;
    let newValue = requestedValue;
    if (requestedValue !== 0 && requestedValue === oldValue) {
      newValue = 0; // toggle off
    }

    const deltaScore = newValue - oldValue;
    const deltaUp = (newValue === 1 ? 1 : 0) - (oldValue === 1 ? 1 : 0);
    const deltaDown = (newValue === -1 ? 1 : 0) - (oldValue === -1 ? 1 : 0);
    const repDelta = repForVote('post', newValue) - repForVote('post', oldValue);

    if (newValue === 0) {
      if (existing) await existing.deleteOne();
    } else if (existing) {
      existing.value = newValue;
      await existing.save();
    } else {
      await Vote.create({
        voter: req.session.userId,
        post: post._id,
        replyId: null,
        targetType: 'post',
        value: newValue
      });
    }

    if (deltaScore !== 0 || deltaUp !== 0 || deltaDown !== 0) {
      post.voteScore += deltaScore;
      post.voteUpCount += deltaUp;
      post.voteDownCount += deltaDown;
      await post.save();
    }

    if (repDelta !== 0) {
      const author = await User.findById(post.author);
      if (author) {
        author.reputation = clampReputation(author.reputation + repDelta);
        await author.save();
        await checkAndAwardBadges(author._id);
      }
    }

    return res.json({
      vote: newValue,
      voteScore: post.voteScore,
      voteUpCount: post.voteUpCount,
      voteDownCount: post.voteDownCount
    });
  } catch (error) {
    console.error('Vote post error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Vote on a reply (authenticated + verified email)
router.post('/:id/replies/:replyId/vote', isAuthenticated, requireVerifiedEmail, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const reply = post.replies.id(req.params.replyId);
    if (!reply) {
      return res.status(404).json({ error: 'Reply not found' });
    }

    const requestedValue = Number(req.body?.value);
    if (![1, -1, 0].includes(requestedValue)) {
      return res.status(400).json({ error: 'Invalid vote value' });
    }

    if (reply.author && reply.author.toString() === req.session.userId) {
      return res.status(400).json({ error: 'You cannot vote on your own reply' });
    }

    const existing = await Vote.findOne({
      voter: req.session.userId,
      post: post._id,
      replyId: reply._id,
      targetType: 'reply'
    });

    const oldValue = existing ? existing.value : 0;
    let newValue = requestedValue;
    if (requestedValue !== 0 && requestedValue === oldValue) {
      newValue = 0; // toggle off
    }

    const deltaScore = newValue - oldValue;
    const deltaUp = (newValue === 1 ? 1 : 0) - (oldValue === 1 ? 1 : 0);
    const deltaDown = (newValue === -1 ? 1 : 0) - (oldValue === -1 ? 1 : 0);
    const repDelta = repForVote('reply', newValue) - repForVote('reply', oldValue);

    if (newValue === 0) {
      if (existing) await existing.deleteOne();
    } else if (existing) {
      existing.value = newValue;
      await existing.save();
    } else {
      await Vote.create({
        voter: req.session.userId,
        post: post._id,
        replyId: reply._id,
        targetType: 'reply',
        value: newValue
      });
    }

    if (deltaScore !== 0 || deltaUp !== 0 || deltaDown !== 0) {
      reply.voteScore = (reply.voteScore || 0) + deltaScore;
      reply.voteUpCount = (reply.voteUpCount || 0) + deltaUp;
      reply.voteDownCount = (reply.voteDownCount || 0) + deltaDown;
      await post.save();
    }

    if (repDelta !== 0 && reply.author) {
      const author = await User.findById(reply.author);
      if (author) {
        author.reputation = clampReputation(author.reputation + repDelta);
        await author.save();
        await checkAndAwardBadges(author._id);
      }
    }

    return res.json({
      vote: newValue,
      voteScore: reply.voteScore || 0,
      voteUpCount: reply.voteUpCount || 0,
      voteDownCount: reply.voteDownCount || 0
    });
  } catch (error) {
    console.error('Vote reply error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Accept/unaccept an answer for question-type posts
router.post('/:id/accept/:replyId', isAuthenticated, requireVerifiedEmail, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.postType !== 'question') {
      return res.status(400).json({ error: 'Only questions can accept an answer' });
    }

    if (post.author.toString() !== req.session.userId) {
      return res.status(403).json({ error: 'Not authorized to accept an answer for this post' });
    }

    const reply = post.replies.id(req.params.replyId);
    if (!reply) {
      return res.status(404).json({ error: 'Reply not found' });
    }

    const previousAccepted = post.acceptedReplyId ? post.acceptedReplyId.toString() : null;
    const requested = reply._id.toString();

    // Toggle: if already accepted, unaccept
    const accepting = previousAccepted !== requested;
    post.acceptedReplyId = accepting ? reply._id : null;
    await post.save();

    // Reputation adjustments
    if (previousAccepted) {
      const prevReply = post.replies.id(previousAccepted);
      if (prevReply?.author) {
        const prevAuthor = await User.findById(prevReply.author);
        if (prevAuthor) {
          prevAuthor.reputation = clampReputation(prevAuthor.reputation - REP.ACCEPTED_ANSWER);
          await prevAuthor.save();
          await checkAndAwardBadges(prevAuthor._id);
        }
      }
    }

    if (accepting && reply.author) {
      const replyAuthor = await User.findById(reply.author);
      if (replyAuthor) {
        replyAuthor.reputation = clampReputation(replyAuthor.reputation + REP.ACCEPTED_ANSWER);
        await replyAuthor.save();
        await checkAndAwardBadges(replyAuthor._id);
      }
    }

    return res.json({ acceptedReplyId: post.acceptedReplyId });
  } catch (error) {
    console.error('Accept answer error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
