# Skill: Environmental Management Control -- AI for Indoor Farm Climate

## Purpose
Reference library and operational framework for E.V.I.E.'s environmental management domain. These peer-reviewed sources and design principles inform how E.V.I.E. assesses a farm's current climate control capabilities, interprets sensor data in the context of room-scale physics, recommends equipment changes (additions, repositioning, replacements), and manages growing environments through the equipment each farm actually has.

## Scope
This skill covers the physical science and engineering of indoor climate control as it applies to controlled-environment agriculture:
- How heat and humidity move through an enclosed room
- How fans, humidifiers, dehumidifiers, mini-splits, and central HVAC alter airflow and climate gradients
- How to create and maintain distinct climate zones within a single room
- How outdoor conditions propagate into indoor growing spaces
- How to read sensor data and infer equipment performance, placement problems, and missing capabilities
- How to recommend specific equipment, placement, and control strategies for a given farm layout

## How E.V.I.E. Uses This Skill
E.V.I.E. must treat every farm as a unique system. Before making any environmental recommendation, E.V.I.E. must:
1. **Inventory the farm's equipment** -- what sensors, controllers, fans, humidifiers, dehumidifiers, HVAC units, and other climate devices exist and where they are placed.
2. **Study the sensor data** -- identify spatial gradients, temporal patterns, response times after equipment state changes, and anomalies that indicate dead zones, over-mixing, or equipment underperformance.
3. **Assess external influences** -- outdoor temperature and humidity trends, building envelope characteristics (insulation, infiltration, window exposure), and occupancy/activity patterns.
4. **Map the airflow regime** -- determine whether the room is well-mixed, stratified, or unevenly served, using sensor readings and the known positions of supply/return/exhaust points.
5. **Recommend within the farm's current capability first** -- reposition existing equipment, adjust settings, or change operational schedules before recommending new purchases.
6. **Recommend new equipment when needed** -- specify make/model category, capacity, placement location within the room, discharge direction, and expected impact on the climate gradient.

## Recommended Reading Order
For building E.V.I.E.'s environmental intelligence:
1. Bonello et al. (2020) -- humidity micro-climate benchmark (when rooms are uniform vs. not)
2. Bonello (2021) -- non-uniform humidity in occupied rooms (zoning gradients)
3. Feng et al. (2018) -- portable ultrasonic humidifier effects (device-specific spatial impact)
4. Yang et al. (2014) -- wall-mounted AC / bedroom CFD (mini-split dead zones)
5. Fan et al. (2017) -- return vent height and central HVAC performance
6. Nguyen et al. (2014) -- outdoor-to-indoor temperature/humidity relationship

---

## Reference Library

### 1. Heat and Humidity Transport in Enclosed Rooms

These papers establish the physics of how temperature and moisture fields behave at room scale. E.V.I.E. needs this foundation to interpret sensor readings and predict how equipment changes will propagate through a space.

**Bonello, Micallef, Borg (2020)**
"Humidity micro-climate characterisation in indoor environments: A benchmark study."
*Journal of Building Engineering.*
Combined chamber measurements with validated CFD. Found that under conventional indoor conditions, humidity approached homogeneity after the initial transient, but small gradients still followed convection and shear in the airflow. Useful for understanding when a room behaves "well mixed" versus when it does not. This is the baseline: if a farm's sensors show persistent humidity gradients under steady-state conditions, the room is NOT well mixed and airflow intervention is required.

**Bonello (2021)**
"Humidity Distribution in High-Occupancy Indoor Micro-Climates."
*Energies.*
Especially relevant to zoning and uneven conditions. In a high-occupancy case, the model found a 31% difference between the lowest and highest locations in humid air exposure. Demonstrates that humidity can become strongly non-uniform when sources and airflow patterns interact. For E.V.I.E., this means plant canopy density and transpiration rates create the same "occupancy" effect -- dense crop zones will always trend wetter unless airflow is designed to compensate.

**Zhang & Ryu (2021)**
"Simulation Study on Indoor Air Distribution and Indoor Humidity Distribution of Three Ventilation Patterns Using CFD."
*Sustainability.*
Directly compares ventilation patterns and shows that airflow organization changes temperature, humidity, and condensation risk. Key takeaway: humidity distribution depends strongly on supply/return configuration, not just on how much moisture is added or removed. E.V.I.E. must consider ventilation pattern as a first-order variable, not an afterthought.

**Xi et al. (2025)**
"Study of thermal and humidity environment and prediction model in impinging jet ventilation rooms based on thermal and moisture coupling."
*Building and Environment.*
Explicitly models coupled temperature and humidity fields. Found a meaningful correlation between them in impinging-jet ventilation rooms. Supports the principle that when airflow pattern changes, the heat field and humidity field change together -- E.V.I.E. cannot adjust one without affecting the other.

**Xia et al. (2023)**
"Impact of coupled heat and moisture transfer on indoor comfort and energy demand for residential buildings in hot-humid regions."
*Energy and Buildings.*
Extends the room problem into the building envelope. Shows that ignoring coupled heat-and-moisture transfer through walls can miss real indoor climate and energy effects, especially in hot-humid climates. E.V.I.E. must consider envelope effects when outdoor conditions are extreme or when the grow room shares walls with unconditioned spaces.

---

### 2. Fan Effects on Heat and Humidity Flow

**Omrani et al. (2021)**
"Ceiling fans as ventilation assisting devices in buildings: A critical review."
*Building and Environment.*
Best review to start with for fan effects. Concludes that ceiling fans change indoor air distribution, raise local air speed, improve thermal comfort, and can reduce cooling demand, but IAQ effects are less studied. In practical terms: fans increase mixing and convective cooling, which reduces stratification but can destroy intentional climate zones. E.V.I.E. must recognize that adding or repositioning fans trades zoning capability for uniformity.

**Shan et al. (2016)**
"Comparing mixing and displacement ventilation in tutorial rooms."
*Building and Environment.*
Demonstrates the spectrum between mixing and stratified airflow. Mixing ventilation created more overall draft, while displacement ventilation created different vertical profiles. Fans push a room toward mixing. E.V.I.E. should use this to reason about whether a farm needs more mixing (to eliminate hot spots) or less mixing (to preserve vertical temperature gradients useful for certain crops).

---

### 3. Humidifier Effects on Room Conditions

**Feng et al. (2018)**
"Impacts of humidification process on indoor thermal comfort and air quality using portable ultrasonic humidifier."
*Building and Environment.*
One of the clearest device-specific studies. Found that a portable ultrasonic humidifier increased RH and decreased air temperature simultaneously, and produced clear spatial stratification in both fields. Increasing RH from 34% to 60% reduced air temperature by 1.5C and PMV by 0.2. Strong evidence that portable humidifiers do NOT simply "raise room humidity evenly" -- they create a local plume and transient gradients. E.V.I.E. must model humidifiers as directional sources with a zone of influence, not as whole-room devices.

**Pu et al. (2014)**
"Effects of different inlet vent positions on the uniformity of humidity inside a building chamber."
*Energy and Buildings.*
Found that humidity uniformity depends strongly on inlet position, temperature, and inlet RH. Lower inlet vent positions gave worse humidity uniformity. Supports the principle that humidifier placement and discharge direction matter as much as capacity. E.V.I.E. should recommend elevated or ceiling-directed humidifier placement for uniformity, and floor-level placement only when local zone humidification is the goal.

---

### 4. Dehumidifiers, Mini-Splits, and Central HVAC Effects

#### Mini-Splits and Wall-Mounted AC

**Yang, Ye, He (2014)**
"CFD simulation research on residential indoor air quality."
*Science of the Total Environment.*
Modeled a bedroom with a wall-hanging air conditioner (close proxy for mini-split indoor head). Found the unit could handle the heat load and provide acceptable thermal comfort, but local areas remained without effective ventilation -- stagnant zones exist even when the room feels cool. E.V.I.E. must never assume a mini-split provides uniform coverage; sensors in dead zones will reveal temperature/humidity lag compared to sensor positions in the direct airflow path.

**Gao, Lee, Hua (2009)**
"Locating room air-conditioners at floor level for energy saving in residential buildings."
*Energy Conversion and Management.*
Compared high-level versus floor-level room AC placement and evaluated draft discomfort, stratification, and energy use. Unit placement changes the airflow regime, which changes both comfort and energy consumption. E.V.I.E. should consider recommending mini-split relocation when sensors show persistent stratification that the current position cannot address.

#### Central HVAC and Supply/Return Layout

**Cao et al. (2014)**
"A review of the performance of different ventilation and airflow distribution systems in buildings."
*Building and Environment.*
Reviews eight room-air-distribution methods. Establishes that supply/return method is a first-order design decision, not a small detail. E.V.I.E. must evaluate a farm's duct/vent layout before recommending equipment changes -- sometimes the problem is airflow path, not equipment capacity.

**Fan et al. (2017)**
"Overall performance evaluation of underfloor air distribution system with different heights of return vents."
*Energy and Buildings.*
Found that return vent height changes thermal comfort, IAQ, and energy performance in different directions. Lower return locations improved energy efficiency, but contaminant dispersion and removal were highly sensitive to return position relative to sources. E.V.I.E. should flag return vent height as a variable when troubleshooting humidity or temperature dead zones near floor-level crop trays.

#### Dehumidification Strategy

**Zhang & Niu (2003)**
"Indoor humidity behaviors associated with decoupled cooling in hot and humid climates."
*Building and Environment.*
Classic paper for dehumidification strategy. Found that dehumidification and ventilation before cooling-panel operation were required to reduce condensation risk, and that infiltration and air-change ratios materially changed humidity behavior. E.V.I.E. must consider sequencing: in humid environments, dehumidify first, then cool, to avoid condensation on cold surfaces and crop damage.

**Yan et al. (2024)**
"Enhancing Dehumidification in the Cable Room of a Ring Main Unit through CFD-EMAG Coupling Simulation and Experimental Verification."
*Applied Sciences.*
Changing the ventilation layout to upward supply and downward suction reduced RH at measurement points by up to 10.6% and lowered dew point by 2.61C. Practical illustration that dehumidification performance depends on airflow path, not just the dehumidifier's rated capacity. E.V.I.E. should recommend dehumidifier placement that works WITH the room's airflow direction, not against it.

---

### 5. Creating Distinct Climate Zones in a Single Room

The literature supports zoning but only if the room avoids over-mixing.

**Consistent findings across the reviewed papers:**

- **Mixing systems and fans tend to erase zones.** Ceiling fans and aggressive supply jets spread heat and moisture more uniformly, which is good for eliminating hot spots but bad for maintaining distinct sub-zones.
- **Stratified or low-mixing systems preserve zones.** Displacement ventilation, underfloor air distribution, impinging jet ventilation, and personalized ventilation can maintain meaningful vertical or local differences.
- **Supply and return geometry matters.** Return height, inlet height, jet direction, and local obstacles (benches, racks, equipment) preserve or destroy a zone.
- **Local source placement matters.** Plants, humidifiers, wet surfaces, electronics, windows, and sunlit walls all create local plumes and gradients.
- **Multi-point control is a control problem, not just an equipment problem.** Different climate targets at different points can be computed and regulated, but this requires careful supply parameter control and per-zone sensing, not just "put a humidifier in one corner."

**Research-backed answer for E.V.I.E.:**
Yes, distinct zones can be created in a single room, but the approach requires low-mixing airflow, separated supply/return paths, physical layout control, local sensing per zone, and closed-loop control at each zone. Fans alone usually work against this goal. E.V.I.E. must evaluate whether a farm operator wants uniformity (simpler, more fans, fewer sensors) or distinct zones (more complex, stratified airflow, per-zone sensors and controllers).

---

### 6. Outdoor Conditions Affecting Indoor Growing Spaces

**Nguyen et al. (2014)**
"The relationship between indoor and outdoor temperature, apparent temperature, relative humidity, and absolute humidity."
*Indoor Air.*
Found that indoor and outdoor absolute humidity were very strongly correlated year-round (r = 0.96), but indoor and outdoor temperature only tracked well when it was warm outdoors. Outdoor RH was a poor predictor of indoor RH compared with absolute humidity. E.V.I.E. must track absolute humidity (vapor pressure or mixing ratio), not just RH, to correctly predict how outdoor weather will affect growing conditions. This is especially important for dehumidifier sizing and scheduling.

**Tamerius et al. (2013)**
"Socioeconomic and Outdoor Meteorological Determinants of Indoor Temperature and Humidity in New York City Dwellings."
*American Journal of Public Health.*
Dwellings exposed to the same outdoor weather can behave very differently indoors. In cool seasons, indoor temperatures varied by more than 10C between dwellings despite similar outdoor conditions. Building type, floor level, and local factors mattered. E.V.I.E. must never assume two farms in the same city will respond identically to outdoor weather -- building characteristics dominate.

**Psomas et al. (2021)**
"Indoor humidity of dwellings and association with building characteristics, behaviors and health in a northern climate."
*Building and Environment.*
Found low RH was more common in dwellings with higher indoor temperature, smaller volume, higher ventilation rate, frequent airing, fewer occupants, and in colder regions. Reminder that envelope, ventilation rate, and operational behavior shape indoor humidity as much as outdoor weather. E.V.I.E. should build a per-farm model of how the building responds to outdoor conditions, rather than using a generic outdoor-to-indoor transfer function.

---

## Practical Design Principles for E.V.I.E.

Across the reviewed literature, the most defensible conclusions are:

1. **A room is rarely truly uniform.** Temperature and humidity form gradients near sources, plants, windows, returns, and supply jets. Sensor placement determines what E.V.I.E. can see. Dead zones between sensors are invisible without inference.

2. **Fans mostly increase mixing.** Good for eliminating hot spots, bad for maintaining distinct climate zones. E.V.I.E. should recommend fans for uniformity goals and recommend repositioning or removing fans for zoning goals.

3. **Humidifiers and dehumidifiers are flow devices as much as moisture devices.** Their location, discharge direction, and interaction with existing airflow determine whether they create a local zone or change the whole room. E.V.I.E. must reason about placement, not just capacity.

4. **Mini-splits and wall AC units can cool a room while leaving dead zones.** Thermal comfort at the sensor is not the same as uniform airflow. E.V.I.E. must look for temperature/humidity lag at different sensor positions to detect unserved areas.

5. **Central HVAC layout matters enormously.** Supply style, return height, and distribution strategy change comfort, humidity, contamination transport, and energy use. E.V.I.E. should evaluate ductwork before recommending additional equipment.

6. **Outdoor weather strongly affects indoor moisture content, but not always indoor RH in a simple way.** Absolute humidity is the better variable to track. E.V.I.E. should convert sensor RH readings to absolute humidity for trend analysis and outdoor correlation.

7. **If you want distinct zones in one room, design for stratification and local control, not just more airflow.** Low-mixing supply, separated return paths, per-zone sensors, and closed-loop control at each zone.

---

## E.V.I.E. Environmental Assessment Framework

### Step 1: Equipment Inventory
Catalog every climate-relevant device: sensors, fans (type, speed, direction), humidifiers (type, capacity, discharge direction), dehumidifiers (type, capacity, intake/exhaust direction), mini-splits (location, BTU, vane direction), central HVAC (supply/return locations, duct layout), lights (heat output), and any passive elements (windows, doors, vents, insulation gaps).

### Step 2: Sensor Data Analysis
- Read all sensor positions and current values
- Compute spatial gradients (temperature delta, RH delta, absolute humidity delta between sensors)
- Identify temporal patterns (do gradients increase during lights-on? After watering? When outdoor temp changes?)
- Measure response time: how quickly does a sensor respond when equipment turns on/off?
- Flag anomalies: stagnant readings (dead zone), oscillating readings (control hunting), diverging sensors (airflow barrier)

### Step 3: External Influence Assessment
- Correlate indoor absolute humidity with outdoor weather data
- Identify building envelope weak points (sensors near exterior walls vs. interior walls)
- Assess seasonal patterns and predict upcoming climate challenges
- Factor in activity patterns (watering schedules, door openings, harvest activity)

### Step 4: Airflow Regime Classification
Based on sensor data and equipment inventory, classify the room:
- **Well-mixed**: All sensors within 1C and 5% RH of each other under steady state. Fans or aggressive HVAC supply create this.
- **Stratified**: Consistent vertical gradient (warmer/drier above, cooler/wetter below). Displacement ventilation or low-mixing supply creates this.
- **Patchy**: Inconsistent gradients, some sensors lag, some respond quickly. Indicates dead zones, obstructions, or equipment placement problems.

### Step 5: Recommend Within Current Capability
Before recommending purchases:
- Reposition fans to address dead zones
- Redirect humidifier/dehumidifier discharge to align with airflow
- Adjust mini-split vane angle or fan speed
- Change equipment scheduling (sequence dehumidification before cooling)
- Move sensors to better capture actual crop-zone conditions

### Step 6: Recommend New Equipment
When current equipment cannot achieve the target conditions:
- Specify the equipment category (e.g., "oscillating tower fan", "portable ultrasonic humidifier", "standalone dehumidifier with top-discharge")
- Specify capacity requirements based on room volume, moisture load, and heat load
- Specify placement: location in room (e.g., "north wall, 2m height, angled toward center"), discharge direction, and distance from nearest sensor
- Predict the expected impact on sensor readings at each position
- Explain the tradeoff (e.g., "adding a fan here will reduce the temperature gradient from 4C to 1C, but it will also reduce the humidity difference between zones A and B")

---

## Applicability to E.V.I.E.

| E.V.I.E. Domain | Relevant Research Areas |
|---|---|
| Sensor Data Interpretation | Bonello 2020/2021 (when gradients are normal vs. problematic) |
| Fan Placement Decisions | Omrani 2021 (mixing effects), Shan 2016 (mixing vs. displacement) |
| Humidifier Management | Feng 2018 (local plume effects), Pu 2014 (placement and uniformity) |
| Mini-Split Optimization | Yang 2014 (dead zones), Gao 2009 (unit height and stratification) |
| HVAC Layout Assessment | Cao 2014 (distribution methods), Fan 2017 (return vent height) |
| Dehumidification Strategy | Zhang & Niu 2003 (sequencing), Yan 2024 (airflow-dependent performance) |
| Climate Zoning Design | Section 5 synthesis (stratification, local control, multi-sensor) |
| Outdoor Influence Modeling | Nguyen 2014 (absolute humidity tracking), Tamerius 2013 (building variation), Psomas 2021 (envelope and behavior) |
| Equipment Recommendation | Full framework: inventory, analyze, classify, recommend |
| Future Farm Design Tool | Assessment framework as reusable template for new farm builds |

## Rules
- Currency is always CAD.
- No emojis in any output.
- No fabricated equipment specifications -- only recommend equipment categories and general capacity ranges, not specific brands, unless data supports the recommendation.
- Always study sensor data before recommending changes.
- Always recommend repositioning existing equipment before recommending new purchases.
- Track absolute humidity, not just RH, for outdoor correlation and trend analysis.
- Sequence environmental changes: dehumidify before cooling in humid conditions.
- Every recommendation must include expected impact on sensor readings.
- Test with `npm test -- --runInBand`.
- Deploy with `eb deploy --staged`.
