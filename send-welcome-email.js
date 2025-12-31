const nodemailer = require('nodemailer');

const emailTransporter = nodemailer.createTransport({
  host: 'smtp.sendgrid.net',
  port: 587,
  secure: false,
  auth: {
    user: 'apikey',
    pass: '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'
  }
});

const htmlEmail = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .credentials { background: white; padding: 20px; border-left: 4px solid #667eea; margin: 20px 0; }
    .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🌱 Welcome to GreenReach Farms</h1>
      <p>Your Cloud Plan Account is Ready!</p>
    </div>
    <div class="content">
      <h2>Hello Reach,</h2>
      <p>Your GreenReach Farms account has been successfully created! You can now log in and start optimizing your growing operations.</p>
      
      <div class="credentials">
        <h3>Your Login Credentials</h3>
        <p><strong>Farm ID:</strong> FARM-MJT7BTBW-FAB2</p>
        <p><strong>Email:</strong> info@greenreachfarms.com</p>
        <p><strong>Temporary Password:</strong> 5kr4seyWWJ8</p>
      </div>
      
      <a href="http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/login.html" class="button">Login to Your Dashboard</a>
      
      <h3>Next Steps:</h3>
      <ol>
        <li>Log in using your credentials above</li>
        <li>Complete your farm profile setup</li>
        <li>Configure your grow rooms and zones</li>
        <li>Start monitoring and optimizing!</li>
      </ol>
      
      <p>If you have any questions, please don't hesitate to reach out to our support team.</p>
      
      <p>Happy Growing!<br>The GreenReach Team</p>
    </div>
  </div>
</body>
</html>
`;

emailTransporter.sendMail({
  from: 'support@greenreach.ca',
  to: 'info@greenreachfarms.com',
  subject: '🌱 Welcome to GreenReach Farms - Your Account is Ready',
  html: htmlEmail
}).then(() => {
  console.log('✅ Welcome email sent successfully to info@greenreachfarms.com');
  process.exit(0);
}).catch(err => {
  console.error('❌ Failed to send email:', err.message);
  process.exit(1);
});
