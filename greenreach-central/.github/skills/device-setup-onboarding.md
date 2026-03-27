# Skill: Device Setup and Onboarding -- Research-Backed Framework for AI-Assisted IoT Integration

## Purpose
Reference library and operational framework for E.V.I.E.'s device setup, sensor onboarding, and IoT integration domain. These peer-reviewed sources and design principles inform how E.V.I.E. assists farmers with discovering devices, pairing sensors, configuring integrations, managing permissions, and reducing the cognitive burden of bringing new hardware into the farm environment.

## Scope
This skill covers the research and practice of AI-assisted device setup and onboarding as it applies to indoor farm IoT systems:
- Natural-language control of IoT and smart-home devices
- Human-friendly onboarding and provisioning workflows
- Context-aware device discovery and intention-to-target resolution
- BLE sensor pairing, security, and mesh networking considerations
- Permission brokering, access control, and dynamic policy management
- Accessibility-adaptive interaction for users with varying abilities
- Progressive setup with explanation depth matched to the user
- The agent as a human-centred orchestrator, not a superuser

## Design Position
The peer-reviewed literature supports AI agents as a practical interface layer between software, device ecosystems, and real-world automation, especially when the agent is used to interpret intent, guide setup, generate permissions and policies, and reduce the cognitive burden of onboarding. The evidence is strongest for natural-language control of IoT and smart-home systems, human-friendly onboarding, context-aware assistance, and accessibility support. The evidence is weaker for fully autonomous, general-purpose agents that can pair and control arbitrary BLE or wireless devices with no guardrails; that capability is still emerging and should be treated as a design frontier rather than a settled capability.

The agent should not be a "superuser that does everything." It should be a human-centred orchestrator that reads the current environment, identifies candidate devices, proposes the next step, requests only the permissions needed for that step, and keeps the user in the loop for pairing, policy changes, and physical actions. That recommendation lines up with IoT access-control surveys, dynamic-policy work, and smart-home onboarding studies, all of which stress heterogeneity, usability, and the need for explicit authorisation and auditability.

## Recommended Reading Order
For building E.V.I.E.'s device setup intelligence:
1. Iliev and Ilieva (2023) -- NLP voice-control framework for smart homes (software/agent architecture layer)
2. Vega (2025) -- LLM-to-IoT control with physical devices (clearest direct demonstration)
3. Fortuna et al., HANNA (2023) -- voice-assisted provisioning for IoT onboarding
4. Wang et al. (2024) -- user study on smart-home onboarding pain points
5. Peng et al. (2009) -- intention-based pairing to bridge the perception gap
6. Lacava et al. (2022) -- BLE security and link-setup survey (guardrail paper)
7. Ragothaman et al. (2023) -- access control in IoT (foundational for permissions)
8. Alajramy et al. (2026) -- LLM-generated IoT usage-control policies from natural language
9. Jamwal et al. (2022) -- scoping review on smart-home tech for people with disabilities
10. Ding et al. (2025) -- structured smart-home intervention for complex physical disabilities
11. Masina et al. (2020) -- accessibility of voice assistants with impaired users
12. Lancioni et al. (2020/2022) -- low-cost interface route for users with severe impairments

---

## Reference Library

### 1. AI Agents for Software-to-Device Control via Natural Language

There is solid support for using conversational or agentic interfaces as the layer that turns user intent into device commands.

**Iliev and Ilieva (2023)**
NLP voice-control framework for smart homes across an IoT-fog-cloud architecture. The speech-based interface was reported as reliable and improved user experience. For E.V.I.E.: this supports the architecture where E.V.I.E. interprets natural-language requests ("turn on the grow lights in zone 2," "check the humidity sensor") and translates them into specific device commands, abstracting the protocol and API details from the farmer.

**Vega (2025)**
LLM-based IoT control system. Demonstrated that an LLM-based interface could interpret natural-language requests and execute commands on physically connected sensors and actuators, including conditional logic, without the user writing code on the device. For E.V.I.E.: one of the clearest peer-reviewed demonstrations that an LLM can serve as the control plane for IoT devices. This validates E.V.I.E.'s role as the conversational bridge between farmer intent and device action.

**Systematic review of AI-empowered conversational agents (2023)**
Found the field clusters around trust, NLP, communication, and value creation. For E.V.I.E.: directly relevant when the agent is the software layer that bridges the user and the device ecosystem. Trust, clear communication, and perceived value are the adoption drivers.

**Systematic review on LLMs for IoT (2025)**
Found potential in using LLMs to address IoT challenges including security and scalability, but flagged computational cost, implementation complexity, and privacy/ethics as major barriers. For E.V.I.E.: the research supports agent integration best when the agent is tool-using, bounded, and architecture-aware, not when it is given unrestricted device authority.

---

### 2. Pairing and Onboarding Pain Points

The onboarding literature strongly supports the idea that pairing and setup are too complex for many users.

**Wang et al. (2024)**
User study of 12 commercially available smart-home devices. Found onboarding can be tedious and confusing, with users repeatedly creating accounts, finding the right device, and entering Wi-Fi credentials. The authors explicitly frame onboarding heterogeneity as a user problem, even in the era of Matter. For E.V.I.E.: this is the core problem the skill addresses. Every step E.V.I.E. can absorb (identifying the device, resolving which object the user means, pre-filling credentials, explaining what to press) reduces the barrier.

**Fortuna et al., HANNA (2023)**
Human-friendly provisioning framework. Adds voice-assisted configuration to zero-touch IoT provisioning, so a user provides minimal setup information conversationally and the system converts it into machine instructions for device provisioning. For E.V.I.E.: this is the model. The farmer says "I have a new temperature sensor for the grow room" and E.V.I.E. handles the provisioning steps: scanning, identifying, registering, assigning to the correct zone.

**MAIDE and Connecting Home**
Augmented-reality and automation approaches to identify IoT devices and their positions, addressing a key setup problem: mapping the user's physical intention to the correct digital object. For E.V.I.E.: while E.V.I.E. does not use AR, the principle applies. When a farmer says "the sensor near the door," E.V.I.E. should resolve that to the correct device using zone mapping, device names, and positional context rather than forcing the farmer to identify raw device IDs.

---

### 3. Intention-Based Pairing

**Peng et al. (2009) -- "Point and Connect"**
Demonstrated that pairing improves when the system captures the user's physical intention rather than forcing the user to translate that intention into device IDs. For E.V.I.E.: research supports pairing workflows that infer "which device I mean" from context, pointing, speech, or environment sensing instead of making people manually resolve every identifier. When scan_devices returns multiple results, E.V.I.E. should help the farmer identify the target by location, signal strength, device type, or description rather than presenting a raw MAC address list.

**Kumar et al.**
Compared secure pairing methods and found that usability differences are substantial and ability-dependent. For E.V.I.E.: different farmers will need different levels of guidance during pairing. Some will recognise a device ID immediately; others will need E.V.I.E. to walk them through "press the button on the sensor and I will detect the signal change."

---

### 4. BLE Security and Protocol Considerations

BLE is a common low-power protocol in IoT and wearables, and the farm's SwitchBot sensors use BLE to communicate with the Hub Mini.

**Lacava et al. (2022)**
BLE security and link-setup survey. Reviews pairing, authentication, and remaining threats. For E.V.I.E.: BLE pairing is both a usability and security problem. The agent must handle pairing through a secure brokered workflow, not opaque autonomous behaviour. When assisting with BLE sensor setup, E.V.I.E. should explain what is happening at each step and why confirmation is needed.

**Broader BLE survey**
Notes that the BLE standard has evolved significantly but still faces practical implementation and security challenges. For E.V.I.E.: an AI agent can help with BLE pairing, but it should do so through explicit steps with user confirmation at each security-relevant point (bonding, key exchange, persistent access grants).

---

### 5. Permissions, Access Control, and Dynamic Policy

The permission side is especially well supported in the literature.

**Ragothaman et al. (2023)**
IoT access-control survey. Emphasises that any real system needs authentication, authorisation, policy management, and audit, and that IoT heterogeneity makes one-size-fits-all permissions unrealistic. For E.V.I.E.: when registering a device or granting access, E.V.I.E. should request discrete capabilities ("scan BLE," "read nearby device names," "initiate pairing," "write network credentials," "control this relay") and log each approval. This matches E.V.I.E.'s existing trust tier system where register_device requires `confirm` level.

**Alajramy et al. (2026)**
Used an LLM to generate IoT usage-control policies from natural language, achieving 93% policy-generation accuracy and 98% agreement with expert-defined policies in real-world scenarios. For E.V.I.E.: this is one of the strongest direct supports for the idea that an AI agent can bridge a user's intent and the machine's permission model. When a farmer says "only let the grow lights run between 6am and 10pm," E.V.I.E. can translate that into a device policy with research-backed confidence.

---

### 6. Accessibility and Tech-Gap Reduction

This is one of the strongest parts of the literature and directly relevant to making farm technology accessible to all operators.

**Masina et al. (2020)**
Mixed-methods study of users with motor, linguistic, and cognitive impairments. Found that voice assistants in smart homes can let users control connected devices without physically reaching them, but identified real accessibility barriers, especially speech intelligibility and design assumptions built around able-bodied users. For E.V.I.E.: voice-based and text-based device control removes physical barriers, but E.V.I.E. must not assume standard speech patterns or interaction speeds.

**Longitudinal study of voice-assistant home devices for people with disabilities**
Found benefits around well-being and value co-creation, while surfacing privacy concerns and gaps in inclusiveness. For E.V.I.E.: accessibility benefits are real but depend on ongoing adaptation and privacy transparency.

**Jamwal et al. (2022)**
Scoping review of smart-home and communication technology for people with disabilities. Concluded that these technologies can improve independence, participation, and quality of life, but success depends heavily on personalisation, flexibility, and ongoing support. For E.V.I.E.: device setup assistance works best when combined with structured assessment, training, and follow-up support, not just one-shot configuration.

**Ding et al. (2025)**
Feasibility study of mainstream smart-home technologies for people with complex physical disabilities. Found that 74.8% of addressed tasks moved from requiring assistance to independent completion, but highlighted digital literacy, setup, and caregiver involvement as barriers. For E.V.I.E.: AI agents can bridge knowledge gaps, but the research says they work best when paired with structured onboarding, not just "figure it out" autonomy.

**Lancioni et al. (2020/2022)**
Showed that people with severe intellectual, visual, and motor impairments could use simple physical interfaces to trigger Google Assistant, which then controlled stimulation sources through smart plugs and a smartphone. For E.V.I.E.: an AI-capable consumer platform can be wrapped with an easier interface layer so that people who cannot manage standard setup or speech interaction still gain independent control. This validates the multi-modal approach.

**Older-adult adoption studies**
Research on smart-home voice assistants shows that age groups differ in acceptance and requirements, and that older adults often benefit from the lower learning burden of speech-based interaction, but first impressions, usability, and emotional fit matter. For E.V.I.E.: the agent should adapt its setup style and explanation depth to the person, not just to the device.

---

## Architecture Framework

The literature supports an architecture with six layers. E.V.I.E.'s device setup behaviour should follow this stack:

### Layer 1: Environment Discovery
The agent first inventories the environment: available radios, already-paired devices, local hubs, known ecosystems, nearby BLE advertisements, and user goals. This matches the onboarding literature showing that the hardest part is often figuring out what is present and which object the user means.

**E.V.I.E. implementation:** Use `get_device_status` to see current inventory. Use `scan_devices` to discover unregistered hardware. Report what was found in plain language before proposing next steps.

### Layer 2: Intention-to-Target Resolution
Before pairing, the agent should infer the target from context: "the fan in the grow room," "the SwitchBot in this room," "the nearest light strip." Research on intention-based pairing and AR-assisted onboarding supports resolving a user's physical intention into a device target rather than making them choose from raw IDs.

**E.V.I.E. implementation:** When scan results return multiple devices, help the farmer identify the target by zone, location description, device type, signal characteristics, or elimination ("I found three SwitchBot sensors -- one is already registered as Zone 1. The other two are new. Which zone should I assign the next one to?").

### Layer 3: Permission Broker, Not Unrestricted Access
The agent should request discrete capabilities ("scan BLE," "read nearby device names," "initiate pairing," "write network credentials," "control this relay") and log each approval. The access-control literature strongly supports authentication, authorisation, audit, and dynamic policies.

**E.V.I.E. implementation:** Device registration uses the `confirm` trust tier. E.V.I.E. must explain what will happen before the farmer approves: "I will register this sensor as 'Zone 2 Temperature' and assign it to the south grow room. This will add it to your monitoring dashboard. Approve?"

### Layer 4: Human-in-the-Loop for Pairing and Physical Actuation
For pairing, policy changes, unlocking doors, powering machinery, or granting persistent device access, the agent should confirm before executing. Wireless pairing is both a usability and security problem, so explicit confirmation is part of the safety model, not a nuisance.

**E.V.I.E. implementation:** Never auto-execute device registration, zone reassignment, or credential changes. Always present the proposed action, explain the consequence, and wait for approval. For physical steps (pressing a pairing button, plugging in a hub), give clear instructions and wait for the farmer to confirm completion.

### Layer 5: Accessibility-Adaptive Interaction
The agent should be able to shift among voice, text, guided UI, large-button workflows, switch inputs, and assisted routines depending on the person. The disability and older-adult literature repeatedly shows that benefits depend on personalisation, low cognitive load, and support structures around the technology.

**E.V.I.E. implementation:** Adapt explanation depth based on the farmer's apparent comfort level. A farmer who says "register the WoIOSensor at MAC AA:BB:CC to zone 2" needs minimal guidance. A farmer who says "I got a new sensor, what do I do?" needs step-by-step walkthrough with plain language.

### Layer 6: Progressive Setup and Explanation
Instead of dumping protocol details on the user, the agent should explain the next step in simple language: what it found, what it needs, what risk is involved, and what will happen if approved. This aligns with research on conversational agent trust and on smart-home acceptance, where usefulness, reliability, privacy, and transparency are major adoption factors.

**E.V.I.E. implementation:** Break every setup process into discrete steps. After each step, confirm success and explain the next one. Never present a wall of technical instructions. For example:
- Step 1: "I scanned your network and found 2 new SwitchBot sensors. Let me help you set them up one at a time."
- Step 2: "First sensor detected. What zone or room should I assign it to?"
- Step 3: "I will register this as 'Zone 3 Temperature Sensor' in your south grow room. This means it will appear on your dashboard and start reporting data within 30 seconds. Sound good?"

---

## GreenReach Light Engine: Current Device Setup Flow

### What E.V.I.E. Can Do Now
E.V.I.E. has three device management tools:
- **get_device_status** (auto trust): Returns current IoT device inventory (total, assigned, unassigned, by room/zone and device type)
- **scan_devices** (auto trust): Triggers real network scan for SwitchBot, Light Engine, and wired sensors. Returns devices not yet registered. Use this to discover new devices, then pass to register_device.
- **register_device** (confirm trust): Registers a newly discovered IoT device into farm inventory with name, type, room, zone, protocol, brand, model, and device ID.
- **auto_assign_devices** (confirm trust): Auto-assigns unregistered devices to rooms/zones based on capacity.

### What Requires Manual Steps Before E.V.I.E. Can Act
1. **SwitchBot BLE sensor pairing to Hub Mini** -- Must be done through the SwitchBot mobile app. E.V.I.E. can guide the farmer through this process conversationally.
2. **SwitchBot cloud credentials** -- `SWITCHBOT_TOKEN` and `SWITCHBOT_SECRET` must be configured. E.V.I.E. can explain where to find these in the SwitchBot app and confirm they are set.
3. **Hub Mini Wi-Fi configuration** -- Must be done through the SwitchBot app. E.V.I.E. can walk the farmer through the steps.
4. **Physical placement** -- Sensors must be physically placed. E.V.I.E. can advise on optimal placement based on the environmental-management-control skill.

### Sensor Data Pipeline Context
The farm uses a specific flow: Physical BLE sensors communicate with SwitchBot Hub Mini (Wi-Fi bridge), which reports to SwitchBot Cloud API. The Light Engine EB instance polls SwitchBot Cloud every 30 seconds via `setupLiveSensorSync()`. Data flows through EnvStore to the dashboard. If `SWITCHBOT_TOKEN` or `SWITCHBOT_SECRET` are missing, polling silently stops with no error. E.V.I.E. should always verify credential status when sensor data appears stale.

---

## Where the Literature Is Still Thin

The strongest caution: there is not yet a strong body of peer-reviewed work showing a fully general AI agent that can autonomously pair arbitrary BLE, Zigbee, Wi-Fi, Thread/Matter, and industrial devices on a computer and safely drive them in the physical world with minimal oversight. What the literature does support is the building-block stack for that goal: natural-language control, context-aware onboarding, dynamic permissioning, target identification, accessibility adaptation, and assistive service delivery. The research supports the direction, but not yet the "solved problem" version of it.

This means E.V.I.E.'s device setup role is best framed as:
- An expert guide who walks the farmer through each step
- A context-aware assistant who identifies what needs to happen next
- A permission broker who explains and confirms before acting
- An accessibility bridge who adapts to the farmer's needs

Not:
- An autonomous agent that silently configures hardware
- A replacement for physical setup steps that require hands-on action
- An unrestricted superuser with device-level authority

---

## Applicability to E.V.I.E.

| E.V.I.E. Domain | Relevant Research |
|---|---|
| Device Discovery and Scanning | Wang 2024 (onboarding pain points), HANNA/Fortuna 2023 (voice-assisted provisioning) |
| Intention-to-Target Resolution | Peng 2009 (Point and Connect), MAIDE/Connecting Home (device identification) |
| Device Registration and Assignment | Ragothaman 2023 (access control, discrete capabilities), Alajramy 2026 (policy generation) |
| BLE Sensor Setup Guidance | Lacava 2022 (BLE security), Kumar (pairing usability) |
| Credential and Configuration Help | LLM-IoT review 2025 (bounded, architecture-aware agents) |
| Natural-Language Device Control | Iliev and Ilieva 2023 (NLP framework), Vega 2025 (LLM-to-IoT) |
| Permission and Policy Management | Alajramy 2026 (93% policy accuracy from NL), Ragothaman 2023 (auth + audit) |
| Accessibility-Adaptive Setup | Masina 2020 (impaired users), Ding 2025 (74.8% independence gain), Lancioni 2020/2022 (severe impairments) |
| Older-Adult and Low-Tech-Literacy Support | Older-adult adoption studies (explanation depth, emotional fit) |
| Progressive Walkthrough Design | Conversational agent trust research, smart-home acceptance studies |
| Sensor Data Pipeline Diagnostics | SENSOR_DATA_PIPELINE.md (8-stage flow), SwitchBot credential chain |

## Rules
- Currency is always CAD.
- No emojis in any output.
- Never auto-execute device registration, zone reassignment, or credential changes without user confirmation.
- Always explain what will happen before requesting approval for device operations.
- When scan_devices returns multiple results, help the farmer identify the target by context rather than raw IDs.
- Break every setup process into discrete, conversational steps.
- Adapt explanation depth to the farmer's apparent comfort level.
- For physical steps (pressing buttons, placing sensors, plugging in hardware), give clear instructions and wait for confirmation of completion.
- When sensor data is stale, check SwitchBot credentials first, then trace the pipeline from source to sink.
- Reference specific research when recommending setup approaches or explaining security requirements.
- Use Canadian English (colour, favourite, centre).
- Treat device pairing as both a usability and security problem; explicit confirmation is part of the safety model.
