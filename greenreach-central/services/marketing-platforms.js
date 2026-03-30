/**
 * Marketing Platforms — GreenReach Central
 * Social media platform adapters for publishing content.
 * Twitter (OAuth 1.0a), LinkedIn (OAuth 2.0), Instagram (Graph API), Facebook (Pages API).
 * All adapters gracefully fall back to stub mode when credentials are missing.
 * Adapted from Real-Estate-Ready-MVP social/platforms.ts.
 */

import { createHmac, randomBytes } from 'crypto';
import { getSettings } from './marketing-settings.js';

/**
 * Generate OAuth 1.0a signature for Twitter API.
 */
function generateOAuthSignature(method, url, params, consumerSecret, tokenSecret) {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  return createHmac('sha1', signingKey).update(baseString).digest('base64');
}

/**
 * Generate OAuth 1.0a Authorization header for Twitter.
 */
function generateOAuthHeader(method, url, apiKey, apiSecret, accessToken, accessSecret) {
  const oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: '1.0',
  };

  const signature = generateOAuthSignature(method, url, oauthParams, apiSecret, accessSecret);
  oauthParams.oauth_signature = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(', ');

  return `OAuth ${headerParts}`;
}

// ── Twitter / X ────────────────────────────────────────────────────
async function publishToTwitter(content, imageUrl) {
  const creds = await getSettings([
    'twitter_api_key', 'twitter_api_secret',
    'twitter_access_token', 'twitter_access_secret',
  ]);

  if (!creds.twitter_api_key || !creds.twitter_api_secret ||
      !creds.twitter_access_token || !creds.twitter_access_secret) {
    console.log('[marketing-platforms] Twitter: no credentials — stub mode');
    return {
      success: true,
      stubbed: true,
      platformPostId: `stub-twitter-${Date.now()}`,
      details: 'Twitter credentials not configured — running in stub mode',
    };
  }

  try {
    const url = 'https://api.twitter.com/2/tweets';
    const authHeader = generateOAuthHeader(
      'POST', url,
      creds.twitter_api_key, creds.twitter_api_secret,
      creds.twitter_access_token, creds.twitter_access_secret
    );

    const body = { text: content.substring(0, 280) };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Twitter API error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    return {
      success: true,
      stubbed: false,
      platformPostId: data.data?.id || null,
      details: data,
    };
  } catch (err) {
    return {
      success: false,
      stubbed: false,
      error: err.message,
      details: null,
    };
  }
}

// ── LinkedIn ───────────────────────────────────────────────────────
async function publishToLinkedIn(content, imageUrl) {
  const creds = await getSettings(['linkedin_access_token', 'linkedin_person_urn']);

  if (!creds.linkedin_access_token || !creds.linkedin_person_urn) {
    console.log('[marketing-platforms] LinkedIn: no credentials — stub mode');
    return {
      success: true,
      stubbed: true,
      platformPostId: `stub-linkedin-${Date.now()}`,
      details: 'LinkedIn credentials not configured — running in stub mode',
    };
  }

  try {
    const url = 'https://api.linkedin.com/v2/ugcPosts';
    const body = {
      author: creds.linkedin_person_urn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: content },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${creds.linkedin_access_token}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`LinkedIn API error ${response.status}: ${errBody}`);
    }

    const postId = response.headers.get('x-restli-id') || `li-${Date.now()}`;
    return {
      success: true,
      stubbed: false,
      platformPostId: postId,
      details: { id: postId },
    };
  } catch (err) {
    return {
      success: false,
      stubbed: false,
      error: err.message,
      details: null,
    };
  }
}

// ── Instagram ──────────────────────────────────────────────────────
async function publishToInstagram(content, imageUrl) {
  const creds = await getSettings(['instagram_access_token', 'instagram_business_account']);

  if (!creds.instagram_access_token || !creds.instagram_business_account) {
    console.log('[marketing-platforms] Instagram: no credentials — stub mode');
    return {
      success: true,
      stubbed: true,
      platformPostId: `stub-instagram-${Date.now()}`,
      details: 'Instagram credentials not configured — running in stub mode',
    };
  }

  if (!imageUrl) {
    return {
      success: false,
      stubbed: false,
      error: 'Instagram requires an image_url for every post',
      details: null,
    };
  }

  try {
    const accountId = creds.instagram_business_account;
    const token = creds.instagram_access_token;

    // Step 1: Create media container
    const containerUrl = `https://graph.facebook.com/v18.0/${accountId}/media`;
    const containerResp = await fetch(containerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: content,
        access_token: token,
      }),
    });

    if (!containerResp.ok) {
      const errBody = await containerResp.text();
      throw new Error(`Instagram container error ${containerResp.status}: ${errBody}`);
    }

    const containerData = await containerResp.json();
    const containerId = containerData.id;

    // Step 2: Publish the container
    const publishUrl = `https://graph.facebook.com/v18.0/${accountId}/media_publish`;
    const publishResp = await fetch(publishUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: token,
      }),
    });

    if (!publishResp.ok) {
      const errBody = await publishResp.text();
      throw new Error(`Instagram publish error ${publishResp.status}: ${errBody}`);
    }

    const publishData = await publishResp.json();
    return {
      success: true,
      stubbed: false,
      platformPostId: publishData.id,
      details: publishData,
    };
  } catch (err) {
    return {
      success: false,
      stubbed: false,
      error: err.message,
      details: null,
    };
  }
}

// ── Facebook ───────────────────────────────────────────────────────
async function publishToFacebook(content, imageUrl) {
  const creds = await getSettings(['facebook_page_access_token', 'facebook_page_id']);

  if (!creds.facebook_page_access_token || !creds.facebook_page_id) {
    console.log('[marketing-platforms] Facebook: no credentials — stub mode');
    return {
      success: true,
      stubbed: true,
      platformPostId: `stub-facebook-${Date.now()}`,
      details: 'Facebook credentials not configured — running in stub mode',
    };
  }

  try {
    const pageId = creds.facebook_page_id;
    const token = creds.facebook_page_access_token;

    const endpoint = imageUrl
      ? `https://graph.facebook.com/v18.0/${pageId}/photos`
      : `https://graph.facebook.com/v18.0/${pageId}/feed`;

    const body = imageUrl
      ? { url: imageUrl, message: content, access_token: token }
      : { message: content, access_token: token };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Facebook API error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    return {
      success: true,
      stubbed: false,
      platformPostId: data.id || data.post_id,
      details: data,
    };
  } catch (err) {
    return {
      success: false,
      stubbed: false,
      error: err.message,
      details: null,
    };
  }
}

// ── Dispatcher ─────────────────────────────────────────────────────
/**
 * Publish content to a specific platform.
 * @param {string} platform - twitter, linkedin, instagram, facebook
 * @param {string} content - Post content
 * @param {string} [imageUrl] - Optional image URL
 * @returns {Promise<{success: boolean, stubbed: boolean, platformPostId: string|null, error?: string, details?: any}>}
 */
export async function publishToPlatform(platform, content, imageUrl) {
  switch (platform) {
    case 'twitter':   return publishToTwitter(content, imageUrl);
    case 'linkedin':  return publishToLinkedIn(content, imageUrl);
    case 'instagram': return publishToInstagram(content, imageUrl);
    case 'facebook':  return publishToFacebook(content, imageUrl);
    default:
      return {
        success: false,
        stubbed: false,
        error: `Unknown platform: ${platform}`,
        details: null,
      };
  }
}

/**
 * Get connection status for all platforms.
 * @returns {Promise<object>}
 */
export async function getPlatformStatus() {
  const platforms = ['twitter', 'linkedin', 'instagram', 'facebook'];
  const status = {};

  for (const platform of platforms) {
    const { checkPlatformCredentials } = await import('./marketing-settings.js');
    const result = await checkPlatformCredentials(platform);
    status[platform] = {
      connected: result.configured,
      source: result.source,
      mode: result.configured ? 'live' : 'stub',
    };
  }

  return status;
}

/**
 * Fetch account details from a platform's API using stored credentials.
 * Returns name, username, URL, and other public-facing profile info.
 * @param {string} platform - twitter, linkedin, instagram, facebook
 * @returns {Promise<{ok: boolean, platform: string, account?: object, error?: string}>}
 */
export async function getPlatformAccountInfo(platform) {
  const { checkPlatformCredentials } = await import('./marketing-settings.js');
  const credCheck = await checkPlatformCredentials(platform);
  if (!credCheck.configured) {
    return { ok: false, platform, error: 'Credentials not configured.' };
  }

  try {
    if (platform === 'facebook') {
      const creds = await getSettings(['facebook_page_access_token', 'facebook_page_id']);
      const pageId = creds.facebook_page_id;
      const token = creds.facebook_page_access_token;
      const fields = 'name,username,link,category,fan_count,followers_count,about,single_line_address,picture';
      const url = `https://graph.facebook.com/v18.0/${pageId}?fields=${fields}&access_token=${token}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Facebook API ${resp.status}: ${errText}`);
      }
      const data = await resp.json();
      return {
        ok: true,
        platform,
        account: {
          page_id: pageId,
          name: data.name || null,
          username: data.username || null,
          url: data.link || (data.username ? `https://www.facebook.com/${data.username}` : null),
          category: data.category || null,
          followers: data.followers_count || data.fan_count || null,
          about: data.about || null,
          address: data.single_line_address || null,
          picture_url: data.picture?.data?.url || null,
        },
      };
    }

    if (platform === 'instagram') {
      const creds = await getSettings(['instagram_access_token', 'instagram_business_account']);
      const accountId = creds.instagram_business_account;
      const token = creds.instagram_access_token;
      const fields = 'name,username,biography,followers_count,media_count,profile_picture_url,website';
      const url = `https://graph.facebook.com/v18.0/${accountId}?fields=${fields}&access_token=${token}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Instagram API ${resp.status}: ${errText}`);
      }
      const data = await resp.json();
      return {
        ok: true,
        platform,
        account: {
          account_id: accountId,
          name: data.name || null,
          username: data.username || null,
          url: data.username ? `https://www.instagram.com/${data.username}` : null,
          biography: data.biography || null,
          followers: data.followers_count || null,
          media_count: data.media_count || null,
          picture_url: data.profile_picture_url || null,
          website: data.website || null,
        },
      };
    }

    if (platform === 'twitter') {
      return { ok: true, platform, account: { note: 'Twitter/X account info requires OAuth 1.0a user context. Credentials are configured and active.' } };
    }

    if (platform === 'linkedin') {
      return { ok: true, platform, account: { note: 'LinkedIn profile info requires OAuth 2.0 user context. Credentials are configured and active.' } };
    }

    return { ok: false, platform, error: `Unknown platform: ${platform}` };
  } catch (err) {
    return { ok: false, platform, error: err.message };
  }
}
