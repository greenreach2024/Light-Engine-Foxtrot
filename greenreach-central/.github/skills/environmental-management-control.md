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
- How light spectrum (blue, red, broad-spectrum) drives stomatal behaviour, transpiration, and humidity load
- How PPFD level changes gas exchange, water use efficiency, and dehumidification demand
- How lamp type (LED vs. HPS) changes the balance of radiant heat, convective heat, and crop transpiration
- How lighting and airflow interact at the leaf boundary layer to determine transpiration safety, calcium transport, and tipburn risk

## How E.V.I.E. Uses This Skill
E.V.I.E. must treat every farm as a unique system. Before making any environmental recommendation, E.V.I.E. must:
1. **Inventory the farm's equipment** -- what sensors, controllers, fans, humidifiers, dehumidifiers, HVAC units, and other climate devices exist and where they are placed.
2. **Study the sensor data** -- identify spatial gradients, temporal patterns, response times after equipment state changes, and anomalies that indicate dead zones, over-mixing, or equipment underperformance.
3. **Assess external influences** -- outdoor temperature and humidity trends, building envelope characteristics (insulation, infiltration, window exposure), and occupancy/activity patterns.
4. **Map the airflow regime** -- determine whether the room is well-mixed, stratified, or unevenly served, using sensor readings and the known positions of supply/return/exhaust points.
5. **Assess lighting as a climate variable** -- light recipe (PPFD + spectrum + fixture thermal profile) drives stomatal opening, transpiration rate, leaf temperature, and therefore the humidity and heat load that airflow and HVAC must handle. E.V.I.E. must evaluate lighting before sizing or repositioning climate equipment.
6. **Recommend within the farm's current capability first** -- reposition existing equipment, adjust settings, or change operational schedules before recommending new purchases.
7. **Recommend new equipment when needed** -- specify make/model category, capacity, placement location within the room, discharge direction, and expected impact on the climate gradient.

## Recommended Reading Order
For building E.V.I.E.'s environmental intelligence:
1. Bonello et al. (2020) -- humidity micro-climate benchmark (when rooms are uniform vs. not)
2. Bonello (2021) -- non-uniform humidity in occupied rooms (zoning gradients)
3. Feng et al. (2018) -- portable ultrasonic humidifier effects (device-specific spatial impact)
4. Yang et al. (2014) -- wall-mounted AC / bedroom CFD (mini-split dead zones)
5. Fan et al. (2017) -- return vent height and central HVAC performance
6. Nguyen et al. (2014) -- outdoor-to-indoor temperature/humidity relationship

For lighting as a climate variable (start here after completing the airflow foundations above):
7. Matthews et al. (2020) -- stomatal mechanism under blue and red light (why spectrum controls transpiration)
8. Hogewoning et al. (2010) -- blue-light dose response in cucumber (minimum blue for functional stomata)
9. Hernandez & Kubota (2016) -- red/blue physiology (spectrum changes gas exchange AND canopy architecture)
10. Lanoue et al. (2017) + Lanoue et al. (2018) -- spectrum-driven transpiration and WUE in tomato
11. Pennisi et al. (2020) -- PPFD vs. WUE and stomatal conductance saturation points
12. Palmitessa et al. (2021) -- LED vs. HPS leaf temperature and transpiration (spectrum overrides thermal effects)
13. Katzin et al. (2020) + Katzin (2021) -- lamp heat, HVAC load, and energy implications of LED vs. HPS

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

### 7. Stomatal Mechanisms Under Different Light Spectra

These papers explain WHY light spectrum changes the climate inside a grow room. Stomata are the crop's main interface with the air -- when they open wider, transpiration rises, humidity load increases, and the leaf cools via latent heat exchange. E.V.I.E. must understand this mechanism to predict how a light recipe change will cascade into HVAC and dehumidification requirements.

**Matthews, Vialet-Chabrand, Lawson (2020)**
"Role of blue and red light in stomatal dynamic behaviour."
*Journal of Experimental Botany.*
The strongest mechanistic review. Blue light promotes stomatal opening through phototropin-mediated signalling (a direct photoreceptor pathway), while red-light effects on stomata are more tightly coupled to photosynthetic electron transport and guard-cell osmoregulation. Blue-light-driven opening is faster and can be partially independent of photosynthetic rate. For E.V.I.E., this means that shifting a light recipe toward more blue will likely increase stomatal conductance even if total PPFD stays the same -- and that translates directly into higher transpiration, more latent cooling at the leaf, and more moisture released into the room air.

**Hogewoning, Trouwborst, Maljaars, Poorter, van Ieperen, Harbinson (2010)**
"Blue light dose-responses of leaf photosynthesis, morphology, and chemical composition of Cucumis sativus grown under different combinations of red and blue light."
*Journal of Experimental Botany.*
At constant total irradiance, cucumber leaves grown under 0% blue had dysfunctional photosynthesis and stomata that did not respond properly to increasing irradiance. Just 7% blue was enough to restore normal stomatal function. Photosynthetic capacity and stomatal conductance increased with blue percentage up to about 50%. This is one of the clearest studies showing that spectrum changes transpiration indirectly by changing stomatal behaviour, not just by changing total light energy. For E.V.I.E.: any light recipe with less than ~7% blue may produce crops with impaired stomatal regulation, which makes the humidity environment harder to predict and control.

**Hernandez & Kubota (2016)**
"Physiological responses of cucumber seedlings under different blue and red photon flux ratios using LEDs."
*Scientia Horticulturae.*
As blue photon flux increased, net photosynthetic rate and stomatal conductance increased, while shoot growth under mixed red/blue generally decreased because leaf area shrank. This is important because it shows spectrum can raise gas-exchange intensity per unit leaf area while simultaneously changing canopy architecture (smaller, more compact leaves). The humidity effect is therefore not simply "more blue = more total transpiration" -- the per-leaf rate rises but total canopy transpiration depends on how much leaf area the crop builds. E.V.I.E. must model both stomatal conductance and canopy leaf area when predicting room humidity load.

---

### 8. Light Spectrum Effects on Transpiration and Water Use Efficiency

**Lanoue, Leonardos, Bhatt, Bhatt, Bhatt, Bhatt, Grodzinski (2017)**
"Effect of spectral quality on growth, gas exchange, and whole-plant water use efficiency of tomatoes."
Whole-plant study where tomato leaves exposed to blue light had higher transpiration and lower water use efficiency (WUE) than under green light. Whole-plant tomato WUE under red+blue (RB) and red+white (RW) LEDs was lower than under HPS, even though photosynthetic rates were similar. For E.V.I.E.: switching from HPS to LED with high blue fraction may not reduce transpiration load -- it can increase it, and the room's dehumidification system must be sized accordingly.

**Lanoue, Leonardos, Bhatt, Bhatt, Bhatt, Bhatt, Grodzinski (2018)**
"Effect of spectral quality on tomato leaf-level gas exchange."
Different LED spectra produced similar carbon assimilation and export rates, but stomatal conductance and transpiration still differed significantly between treatments. Demonstrates that wavelength can change water movement more than carbon movement. For E.V.I.E.: two light recipes that produce the same yield can impose very different humidity loads on the room. Light recipe must be treated as a dehumidification variable, not just a growth variable.

**Kaiser, Ouzounis, Giber, Stroeven, Heuvelink, Kierkels, Marcelis (2019)**
"Adding Blue to Red Supplemental Light Increases Biomass and Yield of Greenhouse-Grown Tomatoes, but Only to an Optimum."
*Frontiers in Plant Science.*
Under greenhouse sunlight plus supplemental LEDs, adding some blue (6-12%) improved growth and yield, but 24% blue was suboptimal because morphology became more compact and whole-canopy light interception fell. So blue light can improve stomatal and photosynthetic traits at the leaf level while still reducing total crop performance if it changes canopy structure too much. For E.V.I.E.: optimal transpiration management requires balancing leaf-level gas exchange (which blue improves) against canopy-level light capture (which excess blue reduces). The humidity load from a 12%-blue recipe may be HIGHER and more productive than from a 24%-blue recipe.

---

### 9. PPFD Effects on Gas Exchange, Growth, and Dehumidification Load

**Pennisi, Blasioli, Cellini, Maia, Crepaldi, Braschi, Spinelli, Nicola, Fernandez, Stanghellini, Marcelis, Orsini (2020)**
"Optimal light intensity for sustainable water and energy use in indoor cultivation of lettuce and basil under red and blue LEDs."
*Frontiers in Plant Science.*
One of the better controlled PPFD studies. Lettuce biomass increased up to 250 umol/m2/s PPFD, then flattened by 300 umol/m2/s. Stomatal conductance peaked around 250 umol/m2/s in lettuce. WUE was maximized at 200+ umol/m2/s in lettuce and 250+ umol/m2/s in basil. Strong indication that higher PPFD often increases gas exchange and the crop's moisture load on dehumidification, but the relationship is not linear and saturates. For E.V.I.E.: pushing PPFD past the saturation point wastes electricity without proportionally increasing growth, but may still increase heat load (via the fixture) without a matching increase in productive transpiration.

**Mayorga-Gomez, van Iersel, Ferrarezi (2024)**
"Varying Light Intensities Affect Lettuce Growth and Physiology in Controlled Indoor Environments."
Net photosynthesis rose strongly as PPFD increased from 125 to 375 umol/m2/s, while transpiration rose from 125 to 175 and then stayed fairly similar across higher treatments. WUE increased with PPFD. However, tipburn appeared at 325-375 umol/m2/s. Key insight: higher light does not always mean proportionally higher transpiration -- above a threshold, the stomatal response flattens while other problems (calcium transport failure, tipburn) emerge. For E.V.I.E.: when sensors show high PPFD and tipburn is reported, the problem is not necessarily humidity but rather insufficient airflow at the leaf boundary layer to support calcium transport via the transpiration stream.

**Yu, Wei, Chen, He (2024)**
"Optimizing light intensity and airflow for improved lettuce growth and reduced tip burn disease in a plant factory."
Directly addresses the light-airflow interaction. Increasing light intensity together with airflow increased the leaf-to-air temperature difference, stomatal conductance, boundary-layer conductance, and sensible/latent heat exchange, which in turn improved calcium transport and reduced tipburn risk. This is the practical bridge between lighting and climate control: the humidity effect of lighting depends heavily on whether airflow can remove the moist boundary layer around leaves and support transpiration safely. For E.V.I.E.: when recommending higher PPFD, always co-recommend airflow changes at the canopy level to maintain boundary-layer conductance.

---

### 10. Lamp Type: LED vs. HPS Heat, Energy, and Transpiration

These papers establish that fixture choice is a climate decision, not just a lighting decision. The type of lamp changes where heat goes (into the air vs. onto the crop), how much electricity becomes PAR vs. waste heat, and how the crop's transpiration responds.

**Katzin, van Mourik,"; Zwart, van Henten (2020)**
"GreenLight -- An open source model for greenhouses with supplemental lighting: Description and validation."
*Biosystems Engineering.*
Strong engineering reference for lamp thermal behaviour. LEDs operate at lower surface temperature, emit mostly convective heat to the air, and produce relatively little longwave radiation toward the crop. HPS lamps run hotter, emit significant longwave radiation that warms leaves directly, and add more total heat per unit PAR. LEDs convert more electricity to PAR (higher efficacy). For E.V.I.E.: switching from HPS to LED changes the room's heat balance -- less radiant heat to leaves, more convective heat to air, and higher electrical efficiency. The dehumidification system may need to work harder (more transpiration from cooler leaves with open stomata) while the cooling system works less hard (less total waste heat).

**Katzin, Marcelis, van Mourik (2021)**
"Energy savings in greenhouses by transition from high-pressure sodium to LED lighting."
*Applied Energy.*
Found that switching HPS to LED usually reduced total greenhouse energy use by 10-25%, but also increased heating demand because LEDs contribute less useful heat to the crop and growing space. The net effect depends on climate, crop, and HVAC design. For E.V.I.E.: an LED upgrade may save net energy but shift the room's thermal balance. If a farm reports "it got colder after switching to LED," this is expected, not a malfunction. E.V.I.E. must recalculate heating and dehumidification after any lamp-type change.

**Palmitessa, Paciello, Pantaleo (2021)**
"LED and HPS Supplementary Light Differentially Affect Gas Exchange in Tomato Leaves."
*Plants.*
Young tomato plants under LED had lower leaf temperature than under HPS (0.8-1.8C cooler across two experiments), but higher stomatal density, stomatal conductance, and transpiration rate. This directly contradicts the naive expectation that "warmer leaves = more transpiration." Spectrum can override simple thermal effects: LED's blue-rich spectrum drove stomata open despite lower leaf temperature. For E.V.I.E.: after an HPS-to-LED switch, expect LOWER leaf temperature but potentially HIGHER transpiration and humidity load. Do not assume the dehumidification demand will drop just because the room air temperature is lower.

**Dannehl, Schwend, Vetter, Schmidt (2021)**
"Increase of Yield, Lycopene, and Lutein Content in Tomatoes Grown Under Continuous PAR Spectrum LED Lighting."
*Frontiers in Plant Science.*
A contrasting result: tomato transpiration under LED was 40% lower and light-use efficiency 19% higher than under HPS. Taken together with Palmitessa, this shows that the direction and magnitude of the transpiration response to lamp type depend on the exact fixture spectrum, crop species, developmental stage, canopy structure, and background light conditions. For E.V.I.E.: there is no universal rule that "LED = more transpiration" or "LED = less transpiration." E.V.I.E. must observe the actual sensor data after a lamp change rather than relying on a generic prediction.

---

### 11. Room and Canopy Microclimate Under Lighting

**Gu, Wen, Xu, Yu (2024)**
CFD study of plant-factory canopy microclimate. Found that when inflow velocity was low, microclimate was driven primarily by lamp radiation rather than convective heat from the air handling system. Higher inflow velocity improved uniformity of air temperature and RH by overwhelming the lamp's local heating effect. For E.V.I.E.: in a room with low airflow, the lamps dominate the local climate around the crop -- sensors near lamps will read warmer and drier than sensors further away. Increasing airflow is the first lever to reduce lamp-driven microclimate gradients.

**Plas, Hemming, de Zwart, Ruijven (2025)**
Detailed leaf-scale CFD model showing that transpiration is driven by the humidity difference between the leaf surface and the bulk air. Leaf temperature controls leaf-surface humidity (via the saturation curve). Latent evaporation feeds back on leaf temperature by cooling the leaf. This creates a tightly coupled loop: light heats the leaf, which raises leaf-surface humidity, which drives transpiration, which cools the leaf, which reduces leaf-surface humidity. E.V.I.E. must understand this feedback loop because it means that small changes in airflow velocity at the leaf surface can shift the equilibrium significantly -- a fan repositioned 30 cm closer to a canopy can change transpiration rate, leaf temperature, and local humidity simultaneously.

**Naranjani, Langroudi, Ashrafizadeh, Dehaghani (2022)**
"Computational analysis of the environment in an indoor vertical farming system."
*Journal of Cleaner Production.*
Modeled airflow, heat transfer, photosynthesis, and transpiration together in a vertical farm. Showed that inlet/outlet placement can materially improve uniformity of temperature and RH while lowering energy use. Light power only tells part of the story; fan and HVAC layout determines whether transpired moisture forms a stagnant humid layer around leaves or is removed quickly into the bulk airstream. For E.V.I.E.: light recipe optimization must always be paired with airflow analysis. A good light recipe in a bad airflow layout will underperform -- and the sensor data will show it as humidity stratification that does not correlate with equipment cycling.

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

8. **Light recipe is a climate variable, not just a growth variable.** Light recipe = PPFD + spectrum + fixture thermal behaviour + airflow. PPFD raises photosynthetic demand and usually raises transpiration demand. Blue-rich spectra push stomata toward more opening. Lamp type determines whether heat reaches leaves mainly as radiation (HPS) or the room mainly as convective air load (LED). Airflow decides whether transpiration becomes productive (latent cooling, calcium transport) or problematic (stratified humidity, tipburn, harder dehumidification).

9. **Spectrum changes transpiration more than you expect.** Blue light drives stomatal opening through phototropin signalling independently of photosynthetic rate. Two light recipes at the same PPFD can produce similar yields but very different humidity loads. E.V.I.E. must treat blue-light fraction as a dehumidification sizing variable.

10. **PPFD and transpiration do not scale linearly.** Stomatal conductance and transpiration typically saturate at moderate PPFD (200-300 umol/m2/s for many leafy crops) while fixture heat output continues to rise linearly with power. Above the saturation point, additional PPFD adds more heat load than moisture load. Below saturation, PPFD increases and transpiration increases are roughly coupled.

11. **LED vs. HPS is a heat-balance question, not just an efficiency question.** Switching from HPS to LED reduces total waste heat but shifts the thermal balance: less radiant heat on leaves, more convective heat in air, potentially higher stomatal conductance from blue-rich spectrum. The net effect on transpiration varies by crop, spectrum, and canopy stage. E.V.I.E. must observe sensor data after a lamp change rather than relying on a generic prediction.

12. **Lighting and airflow are coupled at the leaf boundary layer.** Transpiration rate depends on the humidity gradient between the leaf surface and the bulk air. Airflow velocity at the leaf determines boundary-layer thickness, which controls how fast moisture moves away from the leaf. More light means more transpiration demand, but that demand can only be met if airflow removes the moist boundary layer. When it cannot, humidity builds up locally, transpiration stalls, calcium transport fails, and tipburn appears. When recommending higher PPFD, always co-recommend canopy-level airflow.

---

## E.V.I.E. Environmental Assessment Framework

### Step 1: Equipment Inventory
Catalog every climate-relevant device: sensors, fans (type, speed, direction), humidifiers (type, capacity, discharge direction), dehumidifiers (type, capacity, intake/exhaust direction), mini-splits (location, BTU, vane direction), central HVAC (supply/return locations, duct layout), lights (type, wattage, spectrum, PPFD at canopy, fixture height, thermal profile), and any passive elements (windows, doors, vents, insulation gaps).

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
### Step 4: Lighting-Climate Assessment
- Record light recipe: fixture type (LED/HPS/fluorescent), spectrum (blue %, red %, broad-band), PPFD at canopy level, photoperiod
- Classify fixture thermal profile: primarily radiant heat (HPS) or primarily convective heat (LED)
- Estimate transpiration demand: does PPFD exceed the crop's stomatal conductance saturation point?
- Check for boundary-layer problems: compare sensor readings near canopy during lights-on vs. lights-off. If humidity spikes during lights-on but temperature near canopy does not drop, airflow at the leaf level is insufficient
- Assess tipburn risk: high PPFD + low airflow at canopy = high risk
- Predict the direction of change if the light recipe changes (more blue = more stomatal opening; HPS-to-LED = lower leaf temp but possibly higher conductance)
### Step 4: Airflow Regime Classification
Based on sensor data and equipment inventory, classify the room:
- **Well-mixed**: All sensors within 1C and 5% RH of each other under steady state. Fans or aggressive HVAC supply create this.
- **Stratified**: Consistent vertical gradient (warmer/drier above, cooler/wetter below). Displacement ventilation or low-mixing supply creates this.
- **Patchy**: Inconsistent gradients, some sensors lag, some respond quickly. Indicates dead zones, obstructions, or equipment placement problems.

### Step 6: Recommend Within Current Capability
Before recommending purchases:
- Reposition fans to address dead zones
- Redirect humidifier/dehumidifier discharge to align with airflow
- Adjust mini-split vane angle or fan speed
- Change equipment scheduling (sequence dehumidification before cooling)
- Move sensors to better capture actual crop-zone conditions
- Adjust light recipe: reduce blue fraction if transpiration load is exceeding dehumidification capacity; reduce PPFD if above stomatal saturation and adding heat without proportional growth benefit; extend photoperiod at lower PPFD to maintain DLI while reducing peak transpiration
- Redirect airflow toward canopy to reduce boundary-layer thickness when tipburn or humidity stratification near leaves is detected

### Step 7: Recommend New Equipment
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
| Stomatal and Transpiration Science | Matthews 2020 (blue/red mechanism), Hogewoning 2010 (blue dose-response), Hernandez & Kubota 2016 (spectrum + canopy architecture) |
| Light Recipe and Humidity Load | Lanoue 2017/2018 (spectrum-driven transpiration and WUE), Kaiser 2019 (blue optimum), Pennisi 2020 (PPFD saturation), Mayorga-Gomez 2024 (PPFD vs. transpiration plateau) |
| Lamp Type and Heat Balance | Katzin 2020/2021 (LED vs. HPS thermal and energy), Palmitessa 2021 (LED = cooler leaf, higher conductance), Dannehl 2021 (contrasting transpiration result) |
| Light-Airflow Interaction | Yu 2024 (PPFD + airflow for tipburn), Gu 2024 (lamp radiation vs. convective regime), Plas 2025 (leaf boundary-layer feedback) |
| Room-Scale Climate Modeling | Naranjani 2022 (vertical farm CFD with lighting and transpiration) |
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
- Light recipe changes must be evaluated for their climate impact (transpiration load, heat balance) before implementation.
- When recommending higher PPFD, always co-recommend airflow assessment at canopy level.
- After any lamp-type change (HPS to LED or vice versa), recalculate heating and dehumidification requirements.
- Test with `npm test -- --runInBand`.
- Deploy with `eb deploy --staged`.
