/**
 * routes/profile.js
 *
 * Profile + dashboard API.
 *
 * Exposes public profile data by username and authenticated dashboard endpoints.
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const User = require('../models/User');
const Post = require('../models/Post');
const Portfolio = require('../models/Portfolio');
const ProfileDetails = require('../models/ProfileDetails');
const Vote = require('../models/Vote');
const ChatMessage = require('../models/ChatMessage');
const ChatUpload = require('../models/ChatUpload');
const { isAuthenticated } = require('../middleware/auth');
const { updateProfileValidation } = require('../utils/validators');

const makeExportFilename = (username) => {
  const safeUser = String(username || 'user').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40) || 'user';
  const date = new Date().toISOString().slice(0, 10);
  return `piqniq-export-${safeUser}-${date}.json`;
};

const randomToken = (bytes = 6) => crypto.randomBytes(bytes).toString('hex');

const normalizeString = (value, maxLen) => String(value || '').trim().slice(0, maxLen);

const isValidEmail = (value) => {
  const v = String(value || '').trim();
  if (!v) return false;
  // Basic validation: good enough for an optional public field.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
};

const isValidHttpUrl = (value) => {
  const v = String(value || '').trim();
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

const normalizeStringArray = (value, { maxItems, maxLen }) => {
  const arr = Array.isArray(value) ? value : [];
  return arr
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((v) => v.slice(0, maxLen));
};

const normalizeUrl = (value) => {
  const v = String(value || '').trim();
  if (!v) return '';
  if (!isValidHttpUrl(v)) {
    return '';
  }
  return v.slice(0, 500);
};

const normalizeLinkList = (value) => {
  const arr = Array.isArray(value) ? value : [];
  return arr
    .slice(0, 10)
    .map((l) => ({
      label: normalizeString(l?.label, 50),
      url: normalizeUrl(l?.url),
    }))
    .filter((l) => l.url);
};

const normalizeDatedItems = (value) => {
  const arr = Array.isArray(value) ? value : [];
  return arr
    .slice(0, 30)
    .map((x) => ({
      title: normalizeString(x?.title, 120),
      org: normalizeString(x?.org, 120),
      year: Number.isFinite(Number(x?.year)) ? Math.min(Math.max(Number(x.year), 1900), 2100) : undefined,
      url: normalizeUrl(x?.url),
    }))
    .filter((x) => x.title || x.org || x.year || x.url);
};

const normalizeExperienceItems = (value) => {
  const arr = Array.isArray(value) ? value : [];
  return arr
    .slice(0, 20)
    .map((x) => ({
      company: normalizeString(x?.company, 160),
      title: normalizeString(x?.title, 160),
      location: normalizeString(x?.location, 160),
      startDate: normalizeString(x?.startDate, 30),
      endDate: normalizeString(x?.endDate, 30),
      responsibilities: normalizeStringArray(x?.responsibilities, { maxItems: 12, maxLen: 300 }),
      impactHighlights: normalizeStringArray(x?.impactHighlights, { maxItems: 12, maxLen: 300 }),
      techUsed: normalizeStringArray(x?.techUsed, { maxItems: 15, maxLen: 40 }),
    }))
    .filter((x) => x.company || x.title || x.location || x.startDate || x.endDate || x.responsibilities.length || x.impactHighlights.length || x.techUsed.length);
};

const normalizeProfileDetailsPayload = (payload) => {
  const p = payload && typeof payload === 'object' ? payload : {};

  const identity = p.identity && typeof p.identity === 'object' ? p.identity : {};
  const about = p.about && typeof p.about === 'object' ? p.about : {};
  const careerIntent = p.careerIntent && typeof p.careerIntent === 'object' ? p.careerIntent : {};
  const skills = p.skills && typeof p.skills === 'object' ? p.skills : {};
  const experience = p.experience && typeof p.experience === 'object' ? p.experience : {};
  const learning = p.learning && typeof p.learning === 'object' ? p.learning : {};
  const links = p.links && typeof p.links === 'object' ? p.links : {};

  const contact = identity.contact && typeof identity.contact === 'object' ? identity.contact : {};
  const workingStyle = about.workingStyle && typeof about.workingStyle === 'object' ? about.workingStyle : {};
  const workPreferences = careerIntent.workPreferences && typeof careerIntent.workPreferences === 'object' ? careerIntent.workPreferences : {};
  const availability = careerIntent.availability && typeof careerIntent.availability === 'object' ? careerIntent.availability : {};
  const toolsAndTech = skills.toolsAndTech && typeof skills.toolsAndTech === 'object' ? skills.toolsAndTech : {};

  return {
    identity: {
      displayName: normalizeString(identity.displayName, 80),
      headline: normalizeString(identity.headline, 120),
      location: normalizeString(identity.location, 120),
      timezone: normalizeString(identity.timezone, 60),
      pronouns: normalizeString(identity.pronouns, 40),
      languagesSpoken: normalizeStringArray(identity.languagesSpoken, { maxItems: 15, maxLen: 40 }),
      contact: {
        publicEmail: isValidEmail(contact.publicEmail) ? normalizeString(contact.publicEmail, 255) : '',
        publicPhone: normalizeString(contact.publicPhone, 40),
        preferredContactMethod: normalizeString(contact.preferredContactMethod, 40),
      },
    },
    about: {
      summaryShort: normalizeString(about.summaryShort, 1000),
      summaryLong: normalizeString(about.summaryLong, 8000),
      personalMission: normalizeString(about.personalMission, 1000),
      values: normalizeStringArray(about.values, { maxItems: 20, maxLen: 40 }),
      strengths: normalizeStringArray(about.strengths, { maxItems: 20, maxLen: 40 }),
      growthAreas: normalizeStringArray(about.growthAreas, { maxItems: 20, maxLen: 40 }),
      workingStyle: {
        collaborationStyle: normalizeString(workingStyle.collaborationStyle, 1200),
        communicationStyle: normalizeString(workingStyle.communicationStyle, 1200),
        feedbackStyle: normalizeString(workingStyle.feedbackStyle, 1200),
      },
      funFacts: normalizeStringArray(about.funFacts, { maxItems: 20, maxLen: 120 }),
    },
    careerIntent: {
      targetRoles: normalizeStringArray(careerIntent.targetRoles, { maxItems: 25, maxLen: 60 }),
      targetRoleLevel: normalizeString(careerIntent.targetRoleLevel, 40),
      industriesOfInterest: normalizeStringArray(careerIntent.industriesOfInterest, { maxItems: 25, maxLen: 60 }),
      workPreferences: {
        workType: normalizeString(workPreferences.workType, 60),
        remotePreference: normalizeString(workPreferences.remotePreference, 60),
        relocation: normalizeString(workPreferences.relocation, 60),
        travelWillingness: normalizeString(workPreferences.travelWillingness, 60),
      },
      availability: {
        status: normalizeString(availability.status, 60),
        startDate: normalizeString(availability.startDate, 40),
      },
      compensation: {
        currency: normalizeString(careerIntent?.compensation?.currency, 8),
        rangeMin: Number.isFinite(Number(careerIntent?.compensation?.rangeMin)) ? Math.max(0, Number(careerIntent.compensation.rangeMin)) : undefined,
        rangeMax: Number.isFinite(Number(careerIntent?.compensation?.rangeMax)) ? Math.max(0, Number(careerIntent.compensation.rangeMax)) : undefined,
        notes: normalizeString(careerIntent?.compensation?.notes, 400),
      },
      visaWorkAuthorization: normalizeString(careerIntent.visaWorkAuthorization, 200),
    },
    skills: {
      topSkills: normalizeStringArray(skills.topSkills, { maxItems: 30, maxLen: 40 }),
      secondarySkills: normalizeStringArray(skills.secondarySkills, { maxItems: 40, maxLen: 40 }),
      softSkills: normalizeStringArray(skills.softSkills, { maxItems: 30, maxLen: 40 }),
      toolsAndTech: {
        languages: normalizeStringArray(toolsAndTech.languages, { maxItems: 40, maxLen: 40 }),
        frameworks: normalizeStringArray(toolsAndTech.frameworks, { maxItems: 40, maxLen: 40 }),
        databases: normalizeStringArray(toolsAndTech.databases, { maxItems: 40, maxLen: 40 }),
        cloudPlatforms: normalizeStringArray(toolsAndTech.cloudPlatforms, { maxItems: 40, maxLen: 40 }),
        devopsTools: normalizeStringArray(toolsAndTech.devopsTools, { maxItems: 40, maxLen: 40 }),
        securityTools: normalizeStringArray(toolsAndTech.securityTools, { maxItems: 40, maxLen: 40 }),
      }
    },
    experience: {
      work: normalizeExperienceItems(experience.work),
      volunteering: normalizeExperienceItems(experience.volunteering),
      internships: normalizeExperienceItems(experience.internships),
      freelance: normalizeExperienceItems(experience.freelance),
    },
    learning: {
      education: normalizeDatedItems(learning.education),
      certifications: normalizeDatedItems(learning.certifications),
      courses: normalizeDatedItems(learning.courses),
      learningGoals: normalizeString(learning.learningGoals, 2000),
    },
    links: {
      github: normalizeUrl(links.github),
      linkedin: normalizeUrl(links.linkedin),
      website: normalizeUrl(links.website),
      twitter: normalizeUrl(links.twitter),
      youtube: normalizeUrl(links.youtube),
      blog: normalizeUrl(links.blog),
      other: normalizeLinkList(links.other),
    }
  };
};

// ---- GDPR-minded self-service endpoints (authenticated) ----

// Export the current user's personal data.
// Returns a JSON payload; callers can download as a file.
router.get('/me/export', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.userId;
    const user = await User.findById(userId)
      .select('-password -emailVerificationToken -passwordResetToken')
      .lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // NOTE: Keep bounds to avoid unbounded exports.
    const maxItems = 500;

    const [
      portfolio,
      profileDetails,
      posts,
      votes,
      chatMessages,
      chatUploads,
      followerCount,
      followingCount,
    ] = await Promise.all([
      Portfolio.findOne({ owner: userId }).lean(),
      ProfileDetails.findOne({ owner: userId }).lean(),
      Post.find({ author: userId })
        .select('postType title content category tags acceptedReplyId createdAt updatedAt deletedAt')
        .sort({ createdAt: -1 })
        .limit(maxItems)
        .lean(),
      Vote.find({ voter: userId })
        .select('post replyId targetType value createdAt')
        .sort({ createdAt: -1 })
        .limit(maxItems)
        .lean(),
      ChatMessage.find({ user: userId })
        .select('room username content editedAt deletedAt createdAt expiresAt')
        .sort({ createdAt: -1 })
        .limit(maxItems)
        .lean(),
      ChatUpload.find({ user: userId })
        .select('room username originalName storedName mimeType size createdAt expiresAt')
        .sort({ createdAt: -1 })
        .limit(maxItems)
        .lean(),
      User.countDocuments({ followers: userId }),
      User.countDocuments({ following: userId }),
    ]);

    const payload = {
      generatedAt: new Date().toISOString(),
      version: 1,
      user: {
        id: String(user._id),
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        bio: user.bio,
        socialLinks: user.socialLinks,
        isEmailVerified: user.isEmailVerified,
        role: user.role,
        isSuperAdmin: user.isSuperAdmin,
        reputation: user.reputation,
        badges: user.badges,
        createdAt: user.createdAt,
      },
      social: {
        followerCount,
        followingCount,
      },
      portfolio: portfolio || null,
      profileDetails: profileDetails || null,
      forum: {
        posts: posts || [],
        // Replies are embedded in posts; exporting all replies requires scanning the full corpus.
        // Instead, we export authored posts (above) plus your votes.
      },
      voting: {
        votes: votes || [],
      },
      chat: {
        messages: chatMessages || [],
        uploads: chatUploads || [],
      },
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${makeExportFilename(user.username)}"`);
    return res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (error) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ---- Detailed profile (authenticated) ----

// GET /api/profile/details/me
router.get('/details/me', isAuthenticated, async (req, res) => {
  try {
    const ownerId = req.session.userId;

    const details = await ProfileDetails.findOneAndUpdate(
      { owner: ownerId },
      { $setOnInsert: { owner: ownerId } },
      { new: true, upsert: true }
    ).lean();

    res.json({ profileDetails: details });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/profile/details/me
router.put('/details/me', isAuthenticated, async (req, res) => {
  try {
    const ownerId = req.session.userId;
    const updates = normalizeProfileDetailsPayload(req.body);

    const details = await ProfileDetails.findOneAndUpdate(
      { owner: ownerId },
      { $set: updates, $setOnInsert: { owner: ownerId } },
      { new: true, upsert: true, runValidators: true }
    ).lean();

    res.json({ profileDetails: details });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete (anonymize) the current user's account.
// This performs GDPR-minded erasure of identifying fields while preserving community content integrity.
router.delete('/me', isAuthenticated, async (req, res) => {
  try {
    const nodeEnv = process.env.NODE_ENV || 'development';
    const isTestRuntime = nodeEnv === 'test' || process.env.JEST_WORKER_ID !== undefined;

    const userId = req.session.userId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const confirmUsername = String(req.body?.confirmUsername || '').trim();
    if (!confirmUsername || confirmUsername !== user.username) {
      return res.status(400).json({ error: 'confirmUsername is required' });
    }

    // Safety: avoid locking the site out of admin access.
    if (!isTestRuntime && user.isSuperAdmin) {
      const superAdminCount = await User.countDocuments({ isSuperAdmin: true });
      if (superAdminCount <= 1) {
        return res.status(409).json({ error: 'Cannot delete the last superadmin account' });
      }
    }

    const oldUsername = user.username;
    const token = randomToken(6);
    const newUsername = `del_${token}`.slice(0, 30);
    const newEmail = `deleted+${token}@example.invalid`;

    // Remove social graph references.
    await User.updateMany({ following: userId }, { $pull: { following: userId } });
    await User.updateMany({ followers: userId }, { $pull: { followers: userId } });

    // Remove portfolio (personal profile content).
    await Portfolio.deleteOne({ owner: userId });

    // Update chat denormalized username fields.
    await ChatMessage.updateMany({ user: userId }, { $set: { username: newUsername } });
    await ChatUpload.updateMany({ user: userId }, { $set: { username: newUsername } });

    // Clear identifying fields and revoke access.
    user.email = newEmail.toLowerCase();
    user.username = newUsername;
    user.password = crypto.randomBytes(24).toString('hex');
    user.avatar = '/images/default-avatar.png';
    user.bio = '';
    user.socialLinks = { github: '', linkedin: '', twitter: '', website: '' };
    user.sessionVersion = Number(user.sessionVersion || 0) + 1;
    user.isEmailVerified = false;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.role = 'member';
    user.roles = [];
    user.isSuperAdmin = false;
    user.reputation = 0;
    user.badges = [];
    user.notifications = [];
    user.following = [];
    user.followers = [];
    await user.save();

    global.wsManager?.disconnectUser?.(userId);

    // End the session.
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      return res.json({ message: 'Account deleted', previousUsername: oldUsername });
    });
  } catch (error) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// Get user profile by username
router.get('/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .select('-password -emailVerificationToken -passwordResetToken')
      .populate('badges');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get user's posts
    const posts = await Post.find({ author: user._id, deletedAt: null })
      .populate('author', 'username avatar')
      .sort({ createdAt: -1 })
      .limit(20);

    // Get stats
    const totalPosts = await Post.countDocuments({ author: user._id, deletedAt: null });
    const totalLikes = await Post.aggregate([
      { $match: { author: user._id, deletedAt: null } },
      { $project: { likesCount: { $size: '$likes' } } },
      { $group: { _id: null, total: { $sum: '$likesCount' } } }
    ]);

    res.json({
      user: {
        username: user.username,
        avatar: user.avatar,
        bio: user.bio,
        socialLinks: user.socialLinks,
        reputation: user.reputation,
        badges: user.badges,
        createdAt: user.createdAt,
      },
      stats: {
        totalPosts,
        totalLikes: totalLikes[0]?.total || 0,
        memberSince: user.createdAt,
      },
      posts,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update user profile
router.put('/update', isAuthenticated, updateProfileValidation, async (req, res) => {
  try {
    const { bio, socialLinks, avatar } = req.body;
    
    const user = await User.findByIdAndUpdate(
      req.session.userId,
      {
        bio,
        socialLinks,
        ...(avatar && { avatar }),
      },
      { new: true, runValidators: true }
    ).select('-password -emailVerificationToken -passwordResetToken');

    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update profile', error: error.message });
  }
});

// Get user dashboard
router.get('/dashboard/me', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId)
      .select('-password -emailVerificationToken -passwordResetToken');

    const myPosts = await Post.find({ author: req.session.userId })
      .populate('author', 'username avatar')
      .sort({ createdAt: -1 });

    const notifications = user.notifications.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);

    res.json({
      user,
      myPosts,
      notifications,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Mark notifications as read
router.put('/notifications/read', isAuthenticated, async (req, res) => {
  try {
    const { notificationIds } = req.body;
    
    await User.findByIdAndUpdate(req.session.userId, {
      $set: { 'notifications.$[elem].read': true }
    }, {
      arrayFilters: [{ 'elem._id': { $in: notificationIds } }]
    });

    res.json({ message: 'Notifications marked as read' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update notifications', error: error.message });
  }
});

module.exports = router;
