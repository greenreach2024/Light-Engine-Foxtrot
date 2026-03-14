export const vpdGuideContent = `
<p>If you've been growing indoors for more than a season, you've probably heard about VPD. You may have a chart pinned somewhere. You may have adjusted your humidity a few times based on it. But most growers — even experienced ones — aren't using VPD the way it's actually designed to work.</p>

<p>This guide covers what VPD is, why it matters more than temperature or humidity alone, what the right targets are for each growth stage, and the mistakes that cost growers yield without them ever realizing why.</p>

<h2>What Is VPD?</h2>

<p>VPD stands for Vapor Pressure Deficit. It's the difference between how much moisture the air <em>could</em> hold at a given temperature and how much it's <em>actually</em> holding.</p>

<p>The unit is kilopascals (kPa). A VPD of 0 means the air is fully saturated — 100% relative humidity. A VPD of 2.0 kPa means the air is very dry and plants are under significant transpiration stress.</p>

<p>Here's why this matters: plants don't respond to temperature or humidity independently. They respond to the <em>combination</em> of both, which is what VPD captures. Two grow rooms can have identical humidity readings but completely different VPD values depending on their temperatures — and they'll produce very different results.</p>

<h2>Why VPD Controls Growth Rate</h2>

<p>Transpiration is how plants move water and nutrients from roots to leaves. The driving force behind transpiration is the vapor pressure gradient between the inside of a leaf (nearly saturated with water vapor) and the surrounding air.</p>

<p>When VPD is too low (air too humid), that gradient collapses. Plants can't transpire efficiently. Nutrient uptake slows. Growth stalls. Disease pressure from botrytis and powdery mildew climbs sharply.</p>

<p>When VPD is too high (air too dry), the gradient is too steep. Plants close their stomata defensively to prevent wilting. Photosynthesis slows. In severe cases, you get tip burn on lettuce and other leafy crops — the first sign that calcium isn't moving fast enough to the leaf margins.</p>

<p>The right VPD keeps stomata open and transpiration running at a rate the root zone can support. That's what drives consistent yields.</p>

<h2>VPD Targets by Growth Stage</h2>

<p>The right VPD range isn't fixed — it changes as your crop matures. Seedlings need more moisture in the air. Finishing plants need more stress to drive nutrient density and dry down properly before harvest.</p>

<table>
  <thead>
    <tr>
      <th>Growth Stage</th>
      <th>VPD Range (kPa)</th>
      <th>Target (kPa)</th>
      <th>Notes</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Propagation</td>
      <td>0.4 – 0.8</td>
      <td>0.6</td>
      <td>Young roots can't keep up with high transpiration demand. Keep humidity high to reduce leaf stress while roots establish.</td>
    </tr>
    <tr>
      <td>Vegetative</td>
      <td>0.6 – 1.0</td>
      <td>0.8</td>
      <td>Roots are established. Open stomata and drive nutrient uptake. This is where most of your growth happens.</td>
    </tr>
    <tr>
      <td>Finishing</td>
      <td>0.8 – 1.2</td>
      <td>1.0</td>
      <td>Higher VPD concentrates flavors and reduces post-harvest rot. Reduce humidity progressively in the final days.</td>
    </tr>
    <tr>
      <td>Pre-Harvest</td>
      <td>1.0 – 1.5</td>
      <td>1.2</td>
      <td>Dry the crop down. Reduces water weight and extends shelf life. Don't exceed 1.5 kPa or you'll stress the plant.</td>
    </tr>
  </tbody>
</table>

<h2>How to Calculate VPD</h2>

<p>You don't need to calculate this manually — any decent controller or software does it automatically. But understanding the math helps you interpret what you're seeing.</p>

<p>VPD = SVP × (1 – RH/100)</p>

<p>Where SVP (Saturated Vapor Pressure) is a function of temperature. At 22°C, SVP is approximately 2.64 kPa. At 26°C it's 3.36 kPa.</p>

<p>This is why temperature changes affect VPD dramatically. Raise your room temperature by 4°C without adjusting humidity, and VPD climbs by nearly 0.7 kPa — enough to shift from vegetative targets to finishing targets accidentally.</p>

<h2>The Most Common VPD Mistakes</h2>

<h3>Mistake 1: Managing humidity without accounting for temperature</h3>
<p>You set your humidity to 65% because that's what you read somewhere. But your room runs at 24°C on hot days and 19°C at night. Your VPD swings from 0.63 kPa to 1.14 kPa across a single day — a range that spans three growth stages. Plants don't know what to do with that signal.</p>
<p>Fix: Target VPD directly, not humidity. Let temperature changes drive corresponding humidity adjustments to hold VPD steady.</p>

<h3>Mistake 2: Running the same VPD from seed to harvest</h3>
<p>Many growers pick a VPD target — say, 0.85 kPa — and run it throughout the crop cycle. This is significantly better than ignoring VPD entirely, but it leaves yield on the table at both ends. Seedlings need lower VPD to establish roots. Finishing crops need higher VPD to concentrate and dry down.</p>
<p>Fix: Transition VPD targets as crops move through growth stages. A 6-hour ramp between stages avoids shocking plants.</p>

<h3>Mistake 3: Ignoring canopy temperature vs. ambient temperature</h3>
<p>Your sensor reads the air temperature. Your leaf surface can be 2–4°C cooler than ambient under high light intensity. Actual leaf-level VPD can be meaningfully different from what your sensor reports — especially in dense canopies under high PPFD.</p>
<p>Fix: Position sensors at canopy level when possible. Under high-intensity lighting, adjust your ambient temperature target upward slightly to compensate.</p>

<h3>Mistake 4: Dropping humidity too fast during finishing</h3>
<p>Aggressive humidity reduction in the final week causes rapid VPD spikes. Plants respond by closing stomata — the opposite of what you want at finishing when you're trying to drive nutrient movement and flavor concentration.</p>
<p>Fix: Reduce humidity progressively over 5–7 days before harvest, not abruptly.</p>

<h3>Mistake 5: Not accounting for cultivar variation</h3>
<p>Butterhead lettuce wants cooler, higher-humidity finishing conditions than basil. Kale tolerates a wider VPD range than most leafy greens. Microgreens should stay in propagation-like conditions for their entire short cycle. A single VPD profile doesn't work across diverse crops.</p>
<p>Fix: Adjust VPD targets per crop. Research-validated crop recipes — like those built into Light Engine — handle this automatically.</p>

<h2>What Good VPD Management Looks Like in Practice</h2>

<p>A well-run indoor farm transitions its VPD targets through growth stages with controlled ramps. The system monitors actual air temperature and humidity continuously, computes real-time VPD, and adjusts HVAC setpoints to hold the target within a tight band.</p>

<p>When the crop moves from vegetative to finishing — say, on day 14 of a 21-day lettuce cycle — VPD ramps up over 6 hours from 0.8 kPa to 1.0 kPa. The transition is gradual enough that plants don't experience it as a stress event. Stomata stay open. Nutrient transport continues. The crop finishes clean with better texture and longer shelf life.</p>

<p>This is what automated VPD management gives you: the targets are right, the transitions are smooth, and you're not manually watching sensors and adjusting equipment throughout the day.</p>

<h2>VPD and Energy Costs</h2>

<p>There's a practical cost argument for tight VPD management that doesn't get talked about enough. Humidity control is expensive. Running dehumidifiers continuously because your room is chronically over-humidified wastes energy. Conversely, running humidifiers hard to compensate for excessive heat also burns money.</p>

<p>When you target VPD by coordinating temperature and humidity together — instead of managing them independently — you often find that equipment runs less. Tighter control means less corrective cycling. Some growers see meaningful energy reductions just from switching to VPD-based control logic.</p>

<h2>Safe Limits to Know</h2>

<p>Regardless of growth stage or crop variety, these absolute bounds apply to most indoor leafy green operations:</p>

<ul>
  <li><strong>Temperature:</strong> 14°C minimum, 26°C maximum. Below 14°C significantly slows growth; above 26°C increases disease risk and respiration losses.</li>
  <li><strong>Relative Humidity:</strong> 45% minimum, 95% maximum. Below 45% causes excessive transpiration stress; above 95% creates condensation and disease risk.</li>
  <li><strong>VPD:</strong> 0.3 kPa minimum, 1.5 kPa maximum. Outside this range, most crops show stress symptoms within 24–48 hours.</li>
</ul>

<h2>Automating VPD With Light Engine</h2>

<p>Managing VPD manually across multiple grow rooms and crop cycles is genuinely difficult. The math is straightforward, but the execution — adjusting setpoints as crops transition, holding targets while ambient conditions change, responding to sensor drift — requires constant attention.</p>

<p>Light Engine handles VPD automation as a core feature. When you assign a crop recipe to a growing group, the system sets the appropriate VPD targets for each growth stage and transitions between them automatically. Sensors feed back real-time temperature and humidity readings, and the system adjusts HVAC setpoints to hold the target band.</p>

<p>The stage transitions use a 6-hour ramp by default — fast enough to keep the crop on its optimal trajectory, gradual enough to avoid stress events. If your farm grows multiple crops in separate zones, each zone tracks its own crop's growth stage and VPD target independently.</p>

<p>The result is consistent environmental conditions across your whole crop cycle without manual intervention. That consistency is what drives predictable yields.</p>

<p><a href="/landing-cloud.html">Start with Light Engine Cloud</a> — available now for $1/month — or <a href="/purchase.html">explore the full Farm Server platform</a> launching April 22.</p>
`;
