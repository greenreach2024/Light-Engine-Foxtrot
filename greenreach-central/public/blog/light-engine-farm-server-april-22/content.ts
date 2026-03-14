export const farmServerLaunchContent = `
<p>On April 22, 2026, GreenReach is launching the Light Engine Farm Server — the complete on-premise automation platform for indoor vertical farms. If you've been waiting for a system that handles environmental control, crop traceability, ML-driven predictions, and direct-to-buyer sales from a single platform, this is it.</p>

<p>Here's everything you need to know about what's launching, what it does, and how it compares to the Cloud platform that's already available.</p>

<h2>What Is the Light Engine Farm Server?</h2>

<p>The Farm Server is the edge deployment of Light Engine — software that runs on hardware at your farm (a dedicated mini-PC or industrial computer), not in the cloud. This matters for farms that need real-time control without latency, or that operate in locations with unreliable internet connectivity.</p>

<p>The edge architecture means your lighting, climate, and irrigation controls respond in milliseconds. The system doesn't wait for a round-trip to a cloud server to adjust your VPD setpoint or fire an irrigation cycle. Control is local and instantaneous.</p>

<p>At the same time, the Farm Server syncs to GreenReach Central every 5 minutes — so your data is backed up, your admin can see farm performance remotely, and Central's AI recommendations reach your farm automatically.</p>

<h2>What the Farm Server Does</h2>

<h3>Recipe-Driven Environmental Control</h3>
<p>The core of the Farm Server is a recipe engine built on 60+ research-validated crop profiles. You assign a recipe to a growing group — Buttercrunch Lettuce 21-day, or Genovese Basil 28-day, for example — and the system immediately configures all environmental targets for that crop's growth stages:</p>
<ul>
  <li>Light spectrum, intensity (PPFD), and photoperiod</li>
  <li>Temperature and humidity setpoints by growth stage</li>
  <li>VPD targets with automatic 6-hour ramps between stages</li>
  <li>CO₂, irrigation, and ventilation parameters</li>
</ul>
<p>As the crop matures, environmental targets transition automatically. You don't manually adjust anything between seeding and harvest — the recipe handles it.</p>

<h3>ML-Powered Predictions</h3>
<p>The Farm Server runs three machine learning models locally:</p>
<ul>
  <li><strong>Harvest Predictor:</strong> Forecasts harvest date and expected yield weight per group based on current growth rate and environmental conditions. Validated across 39 crop scenarios.</li>
  <li><strong>Anomaly Detection:</strong> Identifies environmental anomalies before they become crop losses. Uses an Isolation Forest model trained on farm sensor data. 28 anomaly scenarios validated.</li>
  <li><strong>Predictive Temperature Forecasting:</strong> 24-hour temperature predictions using a SARIMAX model. Lets the system pre-condition the room before conditions drift out of range.</li>
</ul>
<p>These models run on-device — no API call required, no latency, no per-query cost.</p>

<h3>QR Tray Tracking and Seed-to-Sale Traceability</h3>
<p>Every tray gets a QR code at seeding. From that point forward, every event — transplant, quality check, harvest — is recorded by scanning the tray QR with a phone or tablet. The Activity Hub mobile app handles field scanning with offline capability.</p>
<p>The result is complete seed-to-sale traceability with no manual data entry. When a buyer receives your product, you can pull the full chain of custody: seeded date, recipe applied, environmental conditions, harvest date, lot code, and quality check results.</p>

<h3>AI Agent System</h3>
<p>The Farm Server includes an AI agent with 11 operational classes, powered by GPT-4o-mini:</p>
<ul>
  <li><strong>Operations:</strong> Natural language queries for inventory, orders, sales, reports, and checklists</li>
  <li><strong>Infrastructure:</strong> Guided device setup for IoT sensors and control equipment</li>
  <li><strong>Marketing:</strong> Lead scoring, outreach drafts, SEO content, conversion analytics</li>
  <li><strong>Monitoring:</strong> Environmental status, zone alerts, automation overview</li>
  <li><strong>Admin:</strong> Cross-farm summaries, SLA risk reports, alert triage</li>
</ul>
<p>All agent actions requiring changes go through a human approval step before execution. Destructive actions require explicit confirmation. A full audit log tracks every recommendation and outcome.</p>

<h3>Wholesale Marketplace Integration</h3>
<p>Farm Server inventory is automatically published to the GreenReach Wholesale Marketplace. As you harvest and scan trays, available product updates in real time. Buyers on the marketplace — restaurants, grocers, institutions — see accurate availability and can place orders without you manually updating a spreadsheet or sending emails.</p>
<p>The POS system handles on-farm sales. The online store handles direct consumer orders. The wholesale portal handles B2B. All three update from the same inventory source.</p>

<h3>Hardware Compatibility</h3>
<p>The Farm Server works with commodity hardware via open protocols. No proprietary equipment required:</p>
<ul>
  <li><strong>Lighting:</strong> DMX512, PWM, SwitchBot, TP-Link Kasa</li>
  <li><strong>Sensors:</strong> SwitchBot Meter, MQTT-compatible sensors, Modbus</li>
  <li><strong>Controllers:</strong> Tasmota, generic MQTT, Modbus RTU/TCP</li>
  <li><strong>Networking:</strong> Ethernet and WiFi, offline-capable with sync on reconnect</li>
</ul>

<h2>Edge vs. Cloud: Which Is Right for You?</h2>

<table>
  <thead>
    <tr>
      <th>Feature</th>
      <th>Farm Server (Edge)</th>
      <th>Light Engine Cloud</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Environmental automation</td>
      <td>✅ Full (lighting, climate, irrigation)</td>
      <td>Monitoring only</td>
    </tr>
    <tr>
      <td>ML predictions (local)</td>
      <td>✅ Harvest, anomaly, temperature</td>
      <td>Cloud-synced recommendations</td>
    </tr>
    <tr>
      <td>QR tray tracking</td>
      <td>✅ Full seed-to-sale</td>
      <td>✅ Full seed-to-sale</td>
    </tr>
    <tr>
      <td>Inventory and POS</td>
      <td>✅ Included</td>
      <td>✅ Included</td>
    </tr>
    <tr>
      <td>Wholesale marketplace</td>
      <td>✅ Included</td>
      <td>✅ Included</td>
    </tr>
    <tr>
      <td>AI agent system</td>
      <td>✅ Full (11 agent classes)</td>
      <td>✅ Full</td>
    </tr>
    <tr>
      <td>Internet dependency</td>
      <td>Optional (syncs when available)</td>
      <td>Required</td>
    </tr>
    <tr>
      <td>Deployment</td>
      <td>On-premise hardware</td>
      <td>Cloud + desktop app</td>
    </tr>
    <tr>
      <td>Availability</td>
      <td>April 22, 2026</td>
      <td>Available now</td>
    </tr>
    <tr>
      <td>Starting price</td>
      <td>Contact for pricing</td>
      <td>$1/month</td>
    </tr>
  </tbody>
</table>

<h2>Who Is the Farm Server For?</h2>

<p>The Farm Server is designed for farms that are running real automation infrastructure — dedicated grow rooms with environmental controls, multiple growing groups, commercial output volume.</p>

<p>If you're automating lighting and climate on a significant scale, the edge architecture gives you local control without cloud dependency. If your internet connection is unreliable, the Farm Server keeps running and syncs when connectivity is restored. If you need food safety traceability for wholesale accounts, the QR-based chain of custody is built in from day one.</p>

<p>The Cloud platform is a better fit if you're earlier in your journey — managing inventory, selling through the marketplace, and tracking crops without full environmental automation. At $1/month, it's designed to be the entry point that grows with your operation.</p>

<h2>What Happens on April 22?</h2>

<p>April 22 is the public availability date for Farm Server. Early access customers are being onboarded now through a schedule call with the GreenReach team — these are hands-on setup sessions to get your farm's device configured, hardware connected, and first crop recipe running.</p>

<p>If you're planning a grow operation that launches in spring or summer 2026, the timing works well. Schedule your setup call now to get in the queue before the April 22 general release.</p>

<p><a href="/purchase.html">Compare Farm Server and Cloud plans</a> or <a href="https://calendly.com/greenreachfarms">schedule a call</a> to discuss your farm's specific setup.</p>
`;
