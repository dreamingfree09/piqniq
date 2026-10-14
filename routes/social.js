/**
 * routes/social.js
 *
 * Social graph API (follow/following, feed, suggestions).
 *
 * Most endpoints are authenticated and return personalized results.
 */
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { isAuthenticated } = require('../middleware/auth');
const { Logger } = require('../utils/logger');

/**
 * @swagger
 * /api/social/follow/{userId}:
 *   post:
 *     summary: Follow a user
 *     tags: [Social]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully followed user
 */
router.post('/follow/:userId', isAuthenticated, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.session.userId;

    if (userId === currentUserId.toString()) {
      return res.status(400).json({ message: 'You cannot follow yourself' });
    }

    const userToFollow = await User.findById(userId);
    const currentUser = await User.findById(currentUserId);

    if (!userToFollow) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if already following
    const isFollowing = currentUser.following.includes(userId);

    if (isFollowing) {
      // Unfollow
      currentUser.following = currentUser.following.filter(id => id.toString() !== userId);
      userToFollow.followers = userToFollow.followers.filter(id => id.toString() !== currentUserId.toString());
      
      await currentUser.save();
      await userToFollow.save();

      Logger.info('User unfollowed', { userId: currentUserId, unfollowedUser: userId });
      
      res.json({ 
        message: 'Unfollowed successfully',
        isFollowing: false,
        followersCount: userToFollow.followers.length
      });
    } else {
      // Follow
      currentUser.following.push(userId);
      userToFollow.followers.push(currentUserId);
      
      await currentUser.save();
      await userToFollow.save();

      // Create notification
      userToFollow.notifications.push({
        type: 'follow',
        message: `${currentUser.username} started following you`,
        link: `/profile/${currentUser.username}`,
        read: false
      });
      await userToFollow.save();

      // Send real-time notification via WebSocket
      if (global.wsManager) {
        global.wsManager.sendNotification(userId, {
          type: 'follow',
          message: `${currentUser.username} started following you`,
          link: `/profile/${currentUser.username}`
        });
      }

      Logger.info('User followed', { userId: currentUserId, followedUser: userId });
      
      res.json({ 
        message: 'Followed successfully',
        isFollowing: true,
        followersCount: userToFollow.followers.length
      });
    }
  } catch (error) {
    Logger.error('Follow error', { error: error.message });
    res.status(500).json({ message: 'Failed to follow user' });
  }
});

/**
 * @swagger
 * /api/social/followers/{userId}:
 *   get:
 *     summary: Get user's followers
 *     tags: [Social]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/followers/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .populate('followers', 'username avatar bio reputation')
      .select('followers');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user.followers);
  } catch (error) {
    Logger.error('Get followers error', { error: error.message });
    res.status(500).json({ message: 'Failed to get followers' });
  }
});

/**
 * @swagger
 * /api/social/following/{userId}:
 *   get:
 *     summary: Get users that this user follows
 *     tags: [Social]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/following/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .populate('following', 'username avatar bio reputation')
      .select('following');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user.following);
  } catch (error) {
    Logger.error('Get following error', { error: error.message });
    res.status(500).json({ message: 'Failed to get following' });
  }
});

/**
 * @swagger
 * /api/social/feed:
 *   get:
 *     summary: Get personalized feed from followed users
 *     tags: [Social]
 *     security:
 *       - cookieAuth: []
 */
router.get('/feed', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select('following');
    const Post = require('../models/Post');

    const feed = await Post.find({ 
      author: { $in: user.following }, deletedAt: null
    })
      .populate('author', 'username avatar')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(feed);
  } catch (error) {
    Logger.error('Get feed error', { error: error.message });
    res.status(500).json({ message: 'Failed to get feed' });
  }
});

/**
 * @swagger
 * /api/social/suggestions:
 *   get:
 *     summary: Get user suggestions to follow
 *     tags: [Social]
 *     security:
 *       - cookieAuth: []
 */
router.get('/suggestions', isAuthenticated, async (req, res) => {
  try {
    const currentUser = await User.findById(req.session.userId).select('following');
    
    // Find users not already followed, with high reputation
    const suggestions = await User.find({
      _id: { 
        $ne: req.session.userId,
        $nin: currentUser.following 
      }
    })
      .select('username avatar bio reputation badges')
      .sort({ reputation: -1 })
      .limit(10);

    res.json(suggestions);
  } catch (error) {
    Logger.error('Get suggestions error', { error: error.message });
    res.status(500).json({ message: 'Failed to get suggestions' });
  }
});

module.exports = router;
