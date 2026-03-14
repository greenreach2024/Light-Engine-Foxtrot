# GreenReach Blog Content Pack 1 — Summary

**Created:** 2026-03-13
**Status:** Ready for Scott's review. PR open on greenreach2024/Light-Engine-Foxtrot.

---

## Articles

### Article 1: The Complete VPD Guide for Indoor Growers
- **File:** `vpd-guide-content.ts`
- **Slug:** `vpd-guide-indoor-growing`
- **Tag:** Growing Science
- **Word count:** ~1,900 words
- **Primary keyword:** VPD chart indoor growing
- **Secondary keywords:** VPD for lettuce, VPD indoor farming, vapor pressure deficit cannabis, vpd by growth stage
- **CTA 1:** /landing-cloud.html (Start with Light Engine Cloud)
- **CTA 2:** /purchase.html (explore full Farm Server)
- **Content highlights:** What VPD is, why it controls growth, stage-by-stage table (propagation/vegetative/finishing/pre-harvest), top 5 mistakes growers make, energy cost angle, Light Engine automation

### Article 2: Light Engine Farm Server — What's Launching April 22
- **File:** `farm-server-launch-content.ts`
- **Slug:** `light-engine-farm-server-april-22`
- **Tag:** Product
- **Word count:** ~1,800 words
- **Primary keyword:** vertical farming automation software
- **Secondary keywords:** indoor farm management platform, farm automation system, vertical farm control system
- **CTA 1:** /purchase.html (Compare plans)
- **CTA 2:** https://calendly.com/greenreachfarms (Schedule a call)
- **Content highlights:** Edge architecture explanation, recipe-driven control, 3 ML models, QR traceability, AI agent system (11 classes), hardware compatibility, Edge vs Cloud comparison table, April 22 launch, early access CTA

### Article 3: How Canadian Farmers Are Leaving Thousands in Grant Money on the Table
- **File:** `grant-guide-content.ts`
- **Slug:** `canadian-farm-grants-2026`
- **Tag:** Funding
- **Word count:** ~1,700 words
- **Primary keyword:** Canadian farm grants 2026
- **Secondary keywords:** agriculture funding Canada, indoor farming grants, farm grant application Canada
- **CTA:** /grant-wizard.html (Try the Grant Wizard)
- **Content highlights:** Scale of unclaimed funding, 4 reasons farmers miss out, 6 programs covered (AgriInsurance, SDTC, CASPP, AgriMarketing, AgriStability, Farm Debt Mediation), Grant Wizard explanation, free/no-signup CTA

---

## Supporting Files

| File | Purpose |
|---|---|
| `blog-index-entries.ts` | Metadata array for all 3 posts — slug, title, excerpt, tag, date, cover_image |
| `image-briefs.md` | 4-5 image specs per article with filenames, alt text, and designer descriptions |
| `BLOG-SUMMARY.md` | This file |

---

## Developer Notes (for wiring the blog)

The site currently has no blog route. To publish these articles, a developer needs to:

1. **Create a blog listing page** — `greenreach-central/public/blog.html` — linking to each article
2. **Create individual article pages** — one HTML file per article (or a templated route in the server)
3. **Add content** — import and render the content from each `.ts` file (or inline the HTML)
4. **Add images** — create image folders at `greenreach-central/public/blog/[slug]/` and add images matching the image-briefs.md specs
5. **Add nav link** — add "Blog" to the main nav in `greenreach-org.html` and footer

Content files are plain HTML strings — no framework dependencies, no component library. They can be inlined into any HTML template using a simple `innerHTML` assignment or server-side template.

**Recommended priority:** Article 2 (Farm Server launch) should go live first given the April 22 countdown. Article 3 (Grants) has the strongest standalone traffic potential (Grant Wizard is a proven lead magnet). Article 1 (VPD) is the long-term SEO anchor.

---

## What's NOT in this pack (future articles to consider)

- Collingwood / Ontario indoor farming market context (local SEO)
- "How to set up your first grow room with Light Engine" (onboarding content)
- "Why we chose open hardware" (brand/philosophy)
- Growing microgreens for wholesale: economics and logistics
- Interview: Living Grocer Urban Farm pilot results
