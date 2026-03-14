/**
 * Blog content registry — vanilla JS, no build step required.
 * Each article has metadata (for the listing page) and an HTML content string
 * (for the detail page). Imported by blog.html and blog-post.html via <script>.
 */

const greenreachBlogPosts = [
  // ── Buyer-facing articles ──
  {
    slug: 'local-produce-differentiation-grocers',
    title: 'Local Produce Differentiation: What Independent Grocers Can Do That Chains Cannot',
    excerpt: 'Why "local" has lost its meaning, and how independent grocers can use vertical farm sourcing to build real competitive advantage.',
    tag: 'For Grocers',
    published_at: '2026-03-13',
    author: 'GreenReach Team',
    reading_time: '8 min read'
  },
  {
    slug: 'restaurant-local-sourcing-story',
    title: 'The Restaurant Local Sourcing Story: From Cliché to Competitive Advantage',
    excerpt: 'How independent restaurants can turn "locally sourced" from a menu cliché into a genuine differentiator — with specificity, not spin.',
    tag: 'For Restaurants',
    published_at: '2026-03-13',
    author: 'GreenReach Team',
    reading_time: '7 min read'
  },
  {
    slug: 'vertical-farm-produce-not-a-commodity',
    title: 'Vertical Farm Produce Is Not a Commodity — Stop Pricing It Like One',
    excerpt: 'The case for why vertically farmed produce and field-grown imports are fundamentally different products — and why the pricing should reflect that.',
    tag: 'Buyers',
    published_at: '2026-03-13',
    author: 'GreenReach Team',
    reading_time: '9 min read'
  },
  {
    slug: 'vertical-farm-premium-positioning',
    title: "Why Vertical Farm Produce Isn't a Commodity — And What That Means for Buyers",
    excerpt: "Field-grown imports and locally grown vertical farm produce are not the same product. Here's why the framing matters for grocers and restaurants.",
    tag: 'Buyers',
    published_at: '2026-03-13',
    author: 'GreenReach Team',
    reading_time: '10 min read'
  },
  // ── Grower-facing articles ──
  {
    slug: 'vpd-guide-indoor-growing',
    title: 'VPD Guide for Indoor Growing: What Most Growers Get Wrong',
    excerpt: 'A complete guide to vapor pressure deficit — what it is, why it matters more than temperature or humidity alone, and the five mistakes costing you yield.',
    tag: 'Growing',
    published_at: '2026-03-13',
    author: 'GreenReach Team',
    reading_time: '8 min read'
  },
  {
    slug: 'light-engine-farm-server-april-22',
    title: 'Light Engine Farm Server: Everything You Need to Know Before April 22',
    excerpt: "The complete on-premise automation platform for indoor vertical farms launches April 22, 2026. Here's what it does, who it's for, and how it compares to Cloud.",
    tag: 'Product',
    published_at: '2026-03-13',
    author: 'GreenReach Team',
    reading_time: '9 min read'
  },
  {
    slug: 'canadian-farm-grants-2026',
    title: "Canadian Agricultural Grants and Funding: What You're Missing in 2026",
    excerpt: "Over 60 Canadian agricultural funding programs are currently accepting applications. Most farmers know about one or two. Here's the rest.",
    tag: 'Funding',
    published_at: '2026-03-13',
    author: 'GreenReach Team',
    reading_time: '7 min read'
  }
];
