#!/usr/bin/env node
/**
 * Generate JWT Secret and Store in AWS Secrets Manager
 * 
 * This script:
 * 1. Generates a cryptographically secure random JWT secret
 * 2. Stores it in AWS Secrets Manager
 * 3. Outputs the ARN for use in Elastic Beanstalk configuration
 * 
 * Prerequisites:
 * - AWS CLI configured with credentials
 * - Permissions to create secrets in Secrets Manager
 * 
 * Usage:
 *   node scripts/setup-jwt-secret.js
 */

import crypto from 'crypto';
import { SecretsManagerClient, CreateSecretCommand, UpdateSecretCommand, DescribeSecretCommand } from '@aws-sdk/client-secrets-manager';

const SECRET_NAME = 'foxtrot/jwt-secret';
const REGION = process.env.AWS_REGION || 'us-east-1';

const client = new SecretsManagerClient({ region: REGION });

/**
 * Generate a cryptographically secure random secret
 */
function generateJwtSecret() {
  // Generate 64 bytes of random data and convert to base64
  // This produces a ~86 character string
  return crypto.randomBytes(64).toString('base64');
}

/**
 * Check if secret already exists
 */
async function secretExists(secretName) {
  try {
    await client.send(new DescribeSecretCommand({
      SecretId: secretName,
    }));
    return true;
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      return false;
    }
    throw error;
  }
}

/**
 * Create or update JWT secret in Secrets Manager
 */
async function setupJwtSecret() {
  console.log('🔐 JWT Secret Setup for Light Engine Foxtrot');
  console.log('═'.repeat(60));
  console.log();

  // Generate secret
  const jwtSecret = generateJwtSecret();
  console.log('✅ Generated cryptographically secure JWT secret');
  console.log(`   Length: ${jwtSecret.length} characters`);
  console.log();

  // Check if secret already exists
  const exists = await secretExists(SECRET_NAME);

  try {
    if (exists) {
      console.log(`⚠️  Secret '${SECRET_NAME}' already exists`);
      console.log('   Updating with new value...');
      
      const updateCommand = new UpdateSecretCommand({
        SecretId: SECRET_NAME,
        SecretString: jwtSecret,
        Description: 'JWT signing secret for Light Engine Foxtrot authentication',
      });

      await client.send(updateCommand);
      console.log('✅ Secret updated successfully');
    } else {
      console.log(`📝 Creating new secret '${SECRET_NAME}'...`);
      
      const createCommand = new CreateSecretCommand({
        Name: SECRET_NAME,
        Description: 'JWT signing secret for Light Engine Foxtrot authentication',
        SecretString: jwtSecret,
      });

      await client.send(createCommand);
      console.log('✅ Secret created successfully');
    }

    console.log();
    console.log('📋 Next Steps:');
    console.log('═'.repeat(60));
    console.log();
    console.log('1. Grant Elastic Beanstalk instance role access:');
    console.log();
    console.log('   aws iam attach-role-policy \\');
    console.log('     --role-name aws-elasticbeanstalk-ec2-role \\');
    console.log('     --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite');
    console.log();
    console.log('2. Set environment variable in Elastic Beanstalk:');
    console.log();
    console.log(`   eb setenv JWT_SECRET_ARN=arn:aws:secretsmanager:${REGION}:YOUR_ACCOUNT_ID:secret:${SECRET_NAME}`);
    console.log();
    console.log('   Or in AWS Console:');
    console.log('   Elastic Beanstalk > Environments > Configuration > Software');
    console.log(`   Add: JWT_SECRET_ARN=arn:aws:secretsmanager:${REGION}:YOUR_ACCOUNT_ID:secret:${SECRET_NAME}`);
    console.log();
    console.log('3. Get the full ARN:');
    console.log();
    console.log(`   aws secretsmanager describe-secret --secret-id ${SECRET_NAME} --region ${REGION}`);
    console.log();
    console.log('4. Deploy to Elastic Beanstalk:');
    console.log();
    console.log('   eb deploy light-engine-foxtrot-prod');
    console.log();
    console.log('✅ JWT secret setup complete!');
    console.log();

  } catch (error) {
    console.error();
    console.error('❌ Error setting up JWT secret:');
    console.error(`   ${error.message}`);
    console.error();
    
    if (error.name === 'InvalidRequestException') {
      console.error('💡 Tip: Make sure AWS credentials are configured:');
      console.error('   aws configure');
    } else if (error.name === 'AccessDeniedException') {
      console.error('💡 Tip: Ensure your IAM user/role has permissions:');
      console.error('   - secretsmanager:CreateSecret');
      console.error('   - secretsmanager:UpdateSecret');
      console.error('   - secretsmanager:DescribeSecret');
    }
    
    process.exit(1);
  }
}

// Run the setup
setupJwtSecret().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
