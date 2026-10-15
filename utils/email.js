const nodemailer = require('nodemailer');
const { Logger } = require('./logger');

const withTimeout = async (promise, ms, label) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`${label} timed out after ${ms}ms`);
      error.code = 'EMAIL_TIMEOUT';
      reject(error);
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

// Create reusable transporter
const createTransporter = () => {
  // Prefer real SMTP if configured (even in development)
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
      // Avoid long hangs during SMTP negotiation.
      connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10000),
      greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10000),
      socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 20000),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  // Otherwise fall back to Ethereal (dev/testing)
  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    auth: {
      user: process.env.ETHEREAL_USER || 'test@ethereal.email',
      pass: process.env.ETHEREAL_PASS || 'test123'
    }
  });
};

// Send verification email
async function sendVerificationEmail(user, token) {
  try {
    const nodeEnv = process.env.NODE_ENV || 'development';
    const isTestRuntime = nodeEnv === 'test' || process.env.JEST_WORKER_ID !== undefined;
    if (isTestRuntime) {
      return { messageId: 'skipped-test-runtime', accepted: [user.email] };
    }

    // If email credentials not configured, just log to console
    if (!process.env.ETHEREAL_USER && !process.env.SMTP_USER && process.env.NODE_ENV !== 'production') {
      const verificationUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/verify-email?token=${token}`;
      console.log('\n📧 EMAIL NOTIFICATION (Email not configured - would be sent to:', user.email, ')');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('Subject: Verify Your Email - Piqniq');
      console.log('To:', user.email);
      console.log('\nVerification Link:', verificationUrl);
      console.log('═══════════════════════════════════════════════════════════════\n');
      Logger.info('Verification email logged (email not configured)', { 
        userId: user._id,
        email: user.email,
        verificationUrl 
      });
      return { messageId: 'console-logged', accepted: [user.email] };
    }

    const transporter = createTransporter();
    const verificationUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/verify-email?token=${token}`;
    
    const mailOptions = {
      from: `"Piqniq Community" <${process.env.SMTP_FROM || 'noreply@piqniq.com'}>`,
      to: user.email,
      subject: 'Verify Your Email - Piqniq',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome to Piqniq! 🚀</h1>
            </div>
            <div class="content">
              <h2>Hi ${user.username}!</h2>
              <p>Thanks for joining our tech community. We're excited to have you on board!</p>
              <p>Please verify your email address by clicking the button below:</p>
              <a href="${verificationUrl}" class="button">Verify Email Address</a>
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #667eea;">${verificationUrl}</p>
              <p>This link will expire in 24 hours.</p>
              <p>If you didn't create an account with Piqniq, please ignore this email.</p>
            </div>
            <div class="footer">
              <p>&copy; 2025 Piqniq Community. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    const info = await withTimeout(transporter.sendMail(mailOptions), 15000, 'sendVerificationEmail');
    Logger.info('Verification email sent', { 
      messageId: info.messageId,
      userId: user._id
    });
    
    // Log ethereal preview URL in development
    if (process.env.NODE_ENV !== 'production') {
      console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
    }
    
    return info;
  } catch (error) {
    Logger.error('Failed to send verification email', { 
      error: error.message,
      user: user.email 
    });
    throw error;
  }
}

// Send password reset email
async function sendPasswordResetEmail(user, token) {
  try {
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) return { messageId: 'skipped-test-runtime', accepted: [user.email] };
    const transporter = createTransporter();
    const resetUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/reset-password?token=${token}`;
    
    const mailOptions = {
      from: `"Piqniq Community" <${process.env.SMTP_FROM || 'noreply@piqniq.com'}>`,
      to: user.email,
      subject: 'Password Reset Request - Piqniq',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Password Reset Request 🔐</h1>
            </div>
            <div class="content">
              <h2>Hi ${user.username},</h2>
              <p>We received a request to reset your password for your Piqniq account.</p>
              <p>Click the button below to reset your password:</p>
              <a href="${resetUrl}" class="button">Reset Password</a>
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #667eea;">${resetUrl}</p>
              <div class="warning">
                <strong>⚠️ Security Notice:</strong>
                <ul>
                  <li>This link will expire in 1 hour</li>
                  <li>If you didn't request this, please ignore this email</li>
                  <li>Your password won't change until you create a new one</li>
                </ul>
              </div>
            </div>
            <div class="footer">
              <p>&copy; 2025 Piqniq Community. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    const info = await withTimeout(transporter.sendMail(mailOptions), 15000, 'sendPasswordResetEmail');
    Logger.info('Password reset email sent', { 
      messageId: info.messageId,
      userId: user._id
    });
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
    }
    
    return info;
  } catch (error) {
    Logger.error('Failed to send password reset email', { 
      error: error.message,
      user: user.email 
    });
    throw error;
  }
}

// Send notification email
async function sendNotificationEmail(user, notification) {
  try {
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) return { messageId: 'skipped-test-runtime', accepted: [user.email] };
    const transporter = createTransporter();
    
    const mailOptions = {
      from: `"Piqniq Community" <${process.env.SMTP_FROM || 'noreply@piqniq.com'}>`,
      to: user.email,
      subject: `New Notification - ${notification.type}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .notification { background: white; padding: 20px; border-left: 4px solid #667eea; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>New Activity on Piqniq 🔔</h1>
            </div>
            <div class="content">
              <h2>Hi ${user.username},</h2>
              <div class="notification">
                <p>${notification.message}</p>
              </div>
              <p>Stay connected with your community!</p>
            </div>
            <div class="footer">
              <p>&copy; 2025 Piqniq Community. All rights reserved.</p>
              <p><a href="${process.env.BASE_URL || 'http://localhost:3000'}/profile/dashboard">Manage your notifications</a></p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    const info = await withTimeout(transporter.sendMail(mailOptions), 15000, 'sendNotificationEmail');
    Logger.info('Notification email sent', { 
      messageId: info.messageId,
      userId: user._id
    });
    
    return info;
  } catch (error) {
    Logger.error('Failed to send notification email', { 
      error: error.message,
      user: user.email 
    });
    throw error;
  }
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendNotificationEmail
};
