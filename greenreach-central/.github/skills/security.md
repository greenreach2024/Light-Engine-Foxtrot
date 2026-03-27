# Skill: Security -- AI for Cybersecurity

## Purpose
Reference library for F.A.Y.E.'s security intelligence domain. These peer-reviewed sources inform threat detection, insider-threat monitoring, attribution, threat intelligence, and explainability decisions across the GreenReach platform.

## Scope
This skill covers AI/ML applications to cybersecurity operations relevant to F.A.Y.E.:
- Anomaly-based intrusion detection (network, IoT, edge)
- Phishing and malware detection
- Insider-threat and user-behavior analysis
- Threat attribution and source determination
- Cyber threat intelligence extraction (NLP, LLM)
- Explainability and operational trust in security decisions

## Recommended Reading Order
For building an in-app AI system for operations support:
1. Kaur et al. (2023) -- broad AI-in-cybersecurity framing
2. Yang et al. (2022) -- anomaly-based network intrusion detection
3. Safi et al. (2023) -- phishing detection techniques
4. Gaber et al. (2024) -- malware detection with AI
5. Kamatchi et al. (2025) -- insider-threat behavioral detection
6. Prasad et al. (2025) -- cyber threat attribution
7. Irshad et al. (2023) -- attribution from unstructured CTI reports
8. Chen et al. (2024) -- LLMs for cyber threat detection
9. Sharma et al. (2025) -- explainable AI in cybersecurity

---

## Reference Library

### Broad Surveys (Start Here)

**Kaur, Gabrijelcic, Klobucar (2023)**
"Artificial intelligence for cybersecurity: Literature review and future research directions."
Systematic review: screened 2,395 studies, retained 236 primary studies, organized AI use cases across cybersecurity functions. Best first paper for the big picture.

**Apruzzese et al. (2023)**
"The Role of Machine Learning in Cybersecurity."
Broad peer-reviewed survey on where ML helps across the cybersecurity workflow, including tasks beyond raw detection. Good for understanding where AI fits operationally.

**Mohamed et al. (2025)**
"Artificial intelligence and machine learning in cybersecurity."
Up-to-date review covering intrusion detection, malware classification, behavioral analysis, and threat intelligence, with stronger recent focus than older broad surveys.

---

### Threat Identification and Detection

**Yang et al. (2022)**
"A systematic literature review of methods and datasets for anomaly-based network intrusion detection."
Surveys 119 top-cited papers comparing methods, preprocessing, metrics, and datasets. Useful for detecting unknown or novel threats from traffic patterns rather than signatures.

**Manivannan et al. (2024)**
"Recent endeavors in machine learning-powered intrusion detection systems for the Internet of Things."
Relevant to edge devices, sensors, smart farms, and operational technology environments. Reviews ML-based IDS across medical IoT, agricultural IoT, industrial IoT, edge/fog IoT, smart homes, and transportation.

**Shyaa et al. (2024)**
"A comprehensive survey on concept drift and feature drift in intrusion detection systems."
Important because real-world threat detection models degrade as attacker behavior changes. Focuses on drift, adaptability, and underexplored gaps in keeping IDS effective over time.

**Hernandez-Ramos et al. (2025)**
"Intrusion Detection Based on Federated Learning."
Systematic review of federated-learning IDS research. Useful for AI-based threat detection across multiple sites or farms without centralizing all raw data.

**Safi et al. (2023)**
"A systematic literature review on phishing website detection techniques."
Focused review of phishing detection using lists, visual similarity, heuristics, ML, and DL. ML was the most-used approach in the surveyed studies.

**Gopinath & Sethuraman (2023)**
"A comprehensive survey on deep learning based malware detection techniques."
Overview of DL-based malware detection across Windows, mobile, IoT, ransomware, and APT-related work.

**Gaber, Ahmed, Janicke (2024)**
"Malware Detection with Artificial Intelligence: A Systematic Literature Review."
ACM Computing Surveys review for malware detection scope.

**Deldar et al. (2023)**
"Deep Learning for Zero-Day Malware Detection and Classification: A Survey."
Useful for understanding how AI is being used against previously unseen malware families.

**Cen et al. (2024)**
"A zero-day ransomware early detection method based on zero-shot learning."
Representative empirical paper for newer AI methods being tested for early-stage detection of unknown ransomware.

---

### Insider Threats and User-Behavior Monitoring

**Kamatchi et al. (2025)**
"Insights into user behavioral-based insider threat detection."
Systematic review of 101 influential papers focused on behavior-based insider threat detection. Useful for AI systems that monitor unusual operator actions, privilege abuse, or account misuse.

**Gheyas & Abdallah (2016)**
"Detection and prediction of insider threats to cyber security."
Older but foundational systematic review on insider-threat detection and prediction. Good for understanding model families and recurring challenges.

---

### Tracing, Source Determination, and Attribution

**Prasad et al. (2025)**
"A survey of cyber threat attribution: Challenges, techniques, and future directions."
One of the clearest overview papers on attribution. Explicitly describes the shift toward data-driven and AI/ML-assisted attribution methods.

**Irshad et al. (2023)**
"Cyber threat attribution using unstructured reports in cyber threat intelligence."
Tracing likely threat actors from CTI reports using NLP and ML. Extracts features such as TTPs, tools, malware, targets, and applications from unstructured reports using domain-specific embeddings.

**Irshad & Siddiqui (2024)**
"Context-aware cyber-threat attribution based on hybrid features."
Combines technical features with behavioral features to improve actor determination. Directly relevant to whether AI can help trace a threat toward its likely source.

**Basnet et al. (2025)**
"Advanced Persistent Threats (APT) Attribution Using Deep Reinforcement Learning."
Specialized paper on attributing malware/APT activity to specific groups using DRL. Frontier of automated attribution research.

**"A comprehensive survey of automated Advanced Persistent Threat attribution" (2025)**
Strong survey on automated APT attribution, including datasets, artifacts, methods, and current limitations. Useful for end-to-end attribution workflows.

---

### Threat Intelligence, Logs, and LLM-Era Research

**Arazzi et al. (2025)**
"NLP-based techniques for Cyber Threat Intelligence."
Useful for extracting indicators, tactics, entities, and patterns from text-heavy sources such as reports, alerts, and analyst notes.

**Chen et al. (2024)**
"A survey of large language models for cyber threat detection."
Addresses whether LLMs can help with log analysis, phishing detection, CTI, and threat prediction. Framed specifically around defender use cases.

**Balasubramanian et al. (2025)**
"Generative AI for cyber threat intelligence: applications, challenges, and analysis of real-world case studies."
Where GenAI is being proposed in CTI, phishing detection, network traffic analysis, threat actor attribution, and social-engineering defense.

---

### Prevention and Operational Trust

**Sharma et al. (2025)**
"A comprehensive review of explainable AI in cybersecurity: Decoding the black box."
Focuses on explainability for malware, phishing, and network intrusion decisions. Critical when humans must trust and act on the model's alerts.

**Pawlicki et al. (2024)**
"The survey on the dual nature of xAI challenges in intrusion detection."
Where explainability helps and where it introduces new tradeoffs in IDS.

---

## Applicability to F.A.Y.E.

| F.A.Y.E. Domain | Relevant Research Areas |
|---|---|
| Alert Triage | Anomaly detection (Yang, Shyaa), concept drift awareness |
| Farm Health Monitoring | IoT IDS (Manivannan), federated learning (Hernandez-Ramos) |
| Order Oversight | Phishing detection (Safi), insider threat (Kamatchi) |
| Payment Processing | Fraud detection via behavioral analysis (Mohamed) |
| Network Management | Intrusion detection, malware detection (Gaber, Gopinath) |
| Decision Explainability | xAI (Sharma, Pawlicki) -- required for F.A.Y.E. trust tiers |
| Threat Intelligence | NLP extraction (Arazzi), LLM analysis (Chen, Balasubramanian) |
| Attribution | Source tracing (Prasad, Irshad), APT attribution (Basnet) |
