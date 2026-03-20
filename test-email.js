#!/usr/bin/env node
/**
 * Test SendGrid Email Configuration
 */

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const emailTransporter = nodemailer.createTransport({
  host: 'smtp.sendgrid.net',
  port: 587,
  secure: false,
  auth: {
    user: 'apikey',
    pass: process.env.SENDGRID_API_KEY
  }
});

const testEmail = {
  from: process.env.EMAIL_FROM || 'info@greenreachgreens.com',
  to: 'peter@greenreachfarms.com',
  subject: 'Light Engine - Email Test',
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #10b981;">Email Configuration Test</h1>
      
      <p>This is a test email from Light Engine production system.</p>
      
      <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p><strong>From:</strong> ${process.env.EMAIL_FROM || 'info@greenreachgreens.com'}</p>
        <p><strong>SMTP:</strong> SendGrid (smtp.sendgrid.net:587)</p>
        <p><strong>Date:</strong> ${new Date().toISOString()}</p>
      </div>
      
      <p style="color: #059669;">✅ If you receive this email, SendGrid is configured correctly!</p>
      
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
      
      <p style="color: #6b7280; font-size: 14px;">
        &copy; 2026 Light Engine. All rights reserved.
      </p>
    </div>
  `,
  text: `
Email Configuration Test

This is a test email from Light Engine production system.

From: ${process.env.EMAIL_FROM || 'info@greenreachgreens.com'}
SMTP: SendGrid (smtp.sendgrid.net:587)
Date: ${new Date().toISOString()}

✅ If you receive this email, SendGrid is configured correctly!

© 2026 Light Engine. All rights reserved.
  `
};

console.log('Testing SendGrid email configuration...');
console.log('From:', testEmail.from);
console.log('To:', testEmail.to);
console.log('Subject:', testEmail.subject);

emailTransporter.sendMail(testEmail)
  .then(info => {
    console.log('✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
    console.log('Response:', info.response);
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Email failed:', error.message);
    if (error.response) {
      console.error('Response:', error.response);
    }
    process.exit(1);
  });
