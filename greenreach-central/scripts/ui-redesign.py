#!/usr/bin/env python3
"""
Tesla-inspired UI redesign for E.V.I.E. and F.A.Y.E. panels.
Wider panels, glassmorphism, SVG icons, futuristic approval buttons.
"""
import os
import sys

BASE = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/greenreach-central/public'

# ── SVG Icons ────────────────────────────────────────────────────────────
ICONS = {
    'send':     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    'close':    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    'observe':  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    'advise':   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>',
    'chat':     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    'farm':     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
    'act':      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    'explain':  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    'learn':    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    'escalate': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    'confirm':  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',
    'cancel':   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
}

def safe_replace(content, old, new, label, count=1):
    """Replace with verification."""
    found = content.count(old)
    if found == 0:
        print(f'  WARNING: "{label}" not found')
        return content
    if found > count:
        print(f'  WARNING: "{label}" found {found} times, expected {count}')
    result = content.replace(old, new, count)
    print(f'  OK: {label}')
    return result

# ═══════════════════════════════════════════════════════════════════════
# 1. PATCH evie-core.css
# ═══════════════════════════════════════════════════════════════════════
def patch_evie_css():
    path = f'{BASE}/styles/evie-core.css'
    with open(path, 'r') as f:
        css = f.read()

    # A) Panel width 400px -> 580px
    css = safe_replace(css,
        'width: 400px;',
        'width: 580px;',
        'evie panel width')

    # B) Panel glassmorphism
    css = safe_replace(css,
        '  background: var(--evie-bg-panel);\n  border-left: 1px solid var(--evie-border);\n  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.4);',
        '  background: rgba(18, 29, 46, 0.88);\n  border-left: 1px solid rgba(16, 185, 129, 0.1);\n  box-shadow: -12px 0 48px rgba(0, 0, 0, 0.5);\n  backdrop-filter: blur(24px) saturate(180%);',
        'evie panel glass')

    # C) Mode tabs → pill style
    css = safe_replace(css,
        '.evie-mode-tabs {\n  display: flex;\n  padding: 0 20px;\n  border-bottom: 1px solid var(--evie-border);\n  flex-shrink: 0;\n}',
        '.evie-mode-tabs {\n  display: flex;\n  padding: 8px 16px;\n  gap: 6px;\n  border-bottom: 1px solid var(--evie-border);\n  flex-shrink: 0;\n}',
        'evie mode tabs container')

    css = safe_replace(css,
        """.evie-mode-tab {
  flex: 1;
  padding: 10px 0;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--evie-text-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  transition: color 0.2s, border-color 0.2s;
  text-align: center;
}""",
        """.evie-mode-tab {
  flex: 1;
  padding: 8px 4px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--evie-text-muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  transition: all 0.25s ease;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}""",
        'evie mode tab pill')

    css = safe_replace(css,
        """.evie-mode-tab:hover {
  color: var(--evie-text-secondary);
}
.evie-mode-tab.active {
  color: var(--evie-text-accent);
  border-bottom-color: var(--evie-vitality);
}""",
        """.evie-mode-tab:hover {
  color: var(--evie-text-secondary);
  background: rgba(255, 255, 255, 0.06);
}
.evie-mode-tab.active {
  color: var(--evie-text-accent);
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(16, 185, 129, 0.2);
}""",
        'evie mode tab states')

    # D) Header enhancement
    css = safe_replace(css,
        """.evie-intel-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--evie-border);
  flex-shrink: 0;
}""",
        """.evie-intel-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(16, 185, 129, 0.1);
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.15);
}""",
        'evie header bg')

    # E) Close button enhancement
    css = safe_replace(css,
        """.evie-intel-close {
  background: none;
  border: 1px solid var(--evie-border);
  color: var(--evie-text-secondary);
  width: 32px; height: 32px;
  border-radius: 8px;""",
        """.evie-intel-close {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--evie-text-secondary);
  width: 36px; height: 36px;
  border-radius: 10px;""",
        'evie close btn')

    # F) Signal cards enhancement
    css = safe_replace(css,
        """.evie-signal-card {
  background: var(--evie-bg-card);
  border: 1px solid var(--evie-border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
  border-left: 3px solid var(--evie-vitality);
  transition: background 0.2s;
}
.evie-signal-card:hover {
  background: var(--evie-bg-card-hover);
}""",
        """.evie-signal-card {
  background: rgba(24, 37, 53, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 8px;
  border-left: 3px solid var(--evie-vitality);
  transition: all 0.25s ease;
  backdrop-filter: blur(8px);
}
.evie-signal-card:hover {
  background: rgba(30, 48, 68, 0.8);
  border-color: rgba(255, 255, 255, 0.1);
  transform: translateX(-2px);
}""",
        'evie signal cards')

    # G) Stat cards enhancement
    css = safe_replace(css,
        """.evie-stat {
  flex: 1;
  min-width: 80px;
  background: var(--evie-bg-card);
  border: 1px solid var(--evie-border);
  border-radius: 8px;
  padding: 10px 12px;
  text-align: center;
}""",
        """.evie-stat {
  flex: 1;
  min-width: 80px;
  background: rgba(24, 37, 53, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 12px 14px;
  text-align: center;
  backdrop-filter: blur(8px);
  transition: border-color 0.25s ease;
}
.evie-stat:hover {
  border-color: rgba(16, 185, 129, 0.2);
}""",
        'evie stat cards')

    # H) Chat input enhancement
    css = safe_replace(css,
        """.evie-conv-input {
  flex: 1;
  background: var(--evie-bg-input);
  border: 1px solid var(--evie-border);
  border-radius: 8px;
  padding: 10px 14px;
  color: var(--evie-text);
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
}""",
        """.evie-conv-input {
  flex: 1;
  background: rgba(26, 42, 61, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 12px 16px;
  color: var(--evie-text);
  font-size: 13px;
  outline: none;
  transition: all 0.25s ease;
  backdrop-filter: blur(8px);
}""",
        'evie chat input')

    # I) Send button enhancement
    css = safe_replace(css,
        """.evie-conv-send {
  background: var(--evie-vitality);
  border: none;
  border-radius: 8px;
  color: #fff;
  width: 38px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.2s;
}
.evie-conv-send:hover { opacity: 0.85; }
.evie-conv-send:disabled { opacity: 0.4; cursor: default; }""",
        """.evie-conv-send {
  background: linear-gradient(135deg, var(--evie-vitality), #059669);
  border: none;
  border-radius: 12px;
  color: #fff;
  width: 48px;
  min-width: 48px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s ease;
  box-shadow: 0 2px 12px rgba(16, 185, 129, 0.3);
}
.evie-conv-send:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 20px rgba(16, 185, 129, 0.4);
}
.evie-conv-send:disabled { opacity: 0.4; cursor: default; transform: none; box-shadow: none; }""",
        'evie send btn')

    # J) Conversation message bubbles
    css = safe_replace(css,
        """.evie-conv-msg {
  padding: 8px 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--evie-text);
}
.evie-conv-msg.user {
  color: var(--evie-sensing);
}
.evie-conv-msg.system {
  color: var(--evie-text-muted);
  font-style: italic;
  font-size: 12px;
}""",
        """.evie-conv-msg {
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--evie-text);
  border-radius: 10px;
  margin-bottom: 6px;
}
.evie-conv-msg.user {
  color: var(--evie-sensing);
  background: rgba(6, 182, 212, 0.08);
}
.evie-conv-msg.assistant {
  background: rgba(24, 37, 53, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.04);
}
.evie-conv-msg.system {
  color: var(--evie-text-muted);
  font-style: italic;
  font-size: 12px;
  background: none;
  text-align: center;
  padding: 6px 0;
}""",
        'evie conv msgs')

    # K) Append new utility classes before RESPONSIVE section
    new_classes = """
/* -- Mode Tab Icons ---------------------------------------------------- */

.evie-mode-tab-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
  transition: opacity 0.25s;
}
.evie-mode-tab.active .evie-mode-tab-icon {
  opacity: 1;
}
.evie-mode-tab-icon svg {
  display: block;
}

/* -- Panel Grid Overlay ----------------------------------------------- */

.evie-intel-panel::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background:
    repeating-linear-gradient(0deg, transparent, transparent 59px, rgba(16, 185, 129, 0.025) 59px, rgba(16, 185, 129, 0.025) 60px),
    repeating-linear-gradient(90deg, transparent, transparent 59px, rgba(16, 185, 129, 0.025) 59px, rgba(16, 185, 129, 0.025) 60px);
  pointer-events: none;
  z-index: 0;
}

.evie-intel-panel > * {
  position: relative;
  z-index: 1;
}

/* -- Enhanced Scrollbar ------------------------------------------------ */

.evie-intel-body::-webkit-scrollbar {
  width: 4px;
}
.evie-intel-body::-webkit-scrollbar-track {
  background: transparent;
}
.evie-intel-body::-webkit-scrollbar-thumb {
  background: rgba(16, 185, 129, 0.2);
  border-radius: 2px;
}
.evie-intel-body::-webkit-scrollbar-thumb:hover {
  background: rgba(16, 185, 129, 0.35);
}

/* -- Section Header Icon ---------------------------------------------- */

.evie-section-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  background: rgba(16, 185, 129, 0.1);
  flex-shrink: 0;
}
.evie-section-icon svg {
  display: block;
}

"""

    css = safe_replace(css,
        '/* ======================================================================\n   RESPONSIVE\n   ======================================================================',
        new_classes + '/* ======================================================================\n   RESPONSIVE\n   ======================================================================',
        'evie append classes')

    with open(path, 'w') as f:
        f.write(css)
    print(f'  Wrote {path}')
    return True


# ═══════════════════════════════════════════════════════════════════════
# 2. PATCH faye-core.css
# ═══════════════════════════════════════════════════════════════════════
def patch_faye_css():
    path = f'{BASE}/styles/faye-core.css'
    with open(path, 'r') as f:
        css = f.read()

    # A) Panel width 420px -> 580px
    css = safe_replace(css,
        'width: 420px;',
        'width: 580px;',
        'faye panel width')

    # B) Panel border enhancement
    css = safe_replace(css,
        '  border-left: 1px solid var(--faye-border);\n  z-index: 10002;',
        '  border-left: 1px solid rgba(16, 185, 129, 0.1);\n  z-index: 10002;',
        'faye panel border')

    # C) Header enhancement
    css = safe_replace(css,
        """.faye-intel-header {
  padding: 16px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--faye-border);
  flex-shrink: 0;
}""",
        """.faye-intel-header {
  padding: 18px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid rgba(16, 185, 129, 0.1);
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.15);
}""",
        'faye header bg')

    # D) Close button enhancement
    css = safe_replace(css,
        """.faye-intel-close {
  width: 28px; height: 28px;
  border-radius: 6px;
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: var(--faye-text-muted);
  cursor: pointer;
  font-size: 14px;""",
        """.faye-intel-close {
  width: 36px; height: 36px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: var(--faye-text-muted);
  cursor: pointer;
  font-size: 14px;""",
        'faye close btn')

    # E) Mode tabs → icon-ready pills
    css = safe_replace(css,
        """.faye-mode-tabs {
  display: flex;
  gap: 2px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  padding: 3px;
}
.faye-mode-tab {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--faye-text-muted);
  cursor: pointer;
  transition: all 0.2s;
  border: none;
  background: none;
  white-space: nowrap;
}
.faye-mode-tab:hover { color: var(--faye-text-secondary); background: rgba(255, 255, 255, 0.04); }
.faye-mode-tab.active { color: var(--faye-text); background: var(--faye-bg-card); }""",
        """.faye-mode-tabs {
  display: flex;
  gap: 4px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  padding: 6px;
  flex-wrap: wrap;
}
.faye-mode-tab {
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  color: var(--faye-text-muted);
  cursor: pointer;
  transition: all 0.25s ease;
  border: 1px solid transparent;
  background: none;
  white-space: nowrap;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  flex: 1;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.faye-mode-tab:hover { color: var(--faye-text-secondary); background: rgba(255, 255, 255, 0.06); }
.faye-mode-tab.active { color: var(--faye-text); background: var(--faye-bg-card); border-color: rgba(16, 185, 129, 0.15); }""",
        'faye mode tabs')

    # F) Chat input enhancement
    css = safe_replace(css,
        """.faye-intel-chat-input textarea {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--faye-bg-input);
  border: 1px solid var(--faye-border);
  color: var(--faye-text);
  font-size: 13px;
  font-family: inherit;
  resize: none;
  outline: none;
  min-height: 36px;
  max-height: 80px;
  line-height: 1.4;
}""",
        """.faye-intel-chat-input textarea {
  flex: 1;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(26, 42, 61, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--faye-text);
  font-size: 13px;
  font-family: inherit;
  resize: none;
  outline: none;
  min-height: 36px;
  max-height: 80px;
  line-height: 1.4;
  backdrop-filter: blur(8px);
}""",
        'faye chat input')

    # G) Send button enhancement
    css = safe_replace(css,
        """.faye-intel-send {
  width: 36px; height: 36px;
  border-radius: 8px;
  border: none;
  background: var(--faye-confident);
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
  flex-shrink: 0;
}
.faye-intel-send:hover { background: #059669; }
.faye-intel-send:disabled { background: #374151; cursor: not-allowed; }""",
        """.faye-intel-send {
  width: 48px; height: 48px;
  border-radius: 12px;
  border: none;
  background: linear-gradient(135deg, var(--faye-confident), #059669);
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s ease;
  flex-shrink: 0;
  box-shadow: 0 2px 12px rgba(16, 185, 129, 0.3);
}
.faye-intel-send:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 20px rgba(16, 185, 129, 0.4);
}
.faye-intel-send:disabled { background: #374151; cursor: not-allowed; transform: none; box-shadow: none; }""",
        'faye send btn')

    # H) Footer enhancement
    css = safe_replace(css,
        """.faye-intel-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--faye-border);
  flex-shrink: 0;
}""",
        """.faye-intel-footer {
  padding: 14px 16px;
  border-top: 1px solid rgba(16, 185, 129, 0.1);
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.1);
}""",
        'faye footer')

    # I) Append new classes before Responsive section
    new_classes = """
/* -- Mode Tab Icons --------------------------------------------------- */

.faye-mode-tab-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
  transition: opacity 0.25s;
}
.faye-mode-tab.active .faye-mode-tab-icon {
  opacity: 1;
}
.faye-mode-tab-icon svg {
  display: block;
}

/* -- Futuristic Confirmation Buttons ---------------------------------- */

.faye-confirm-row {
  display: flex;
  gap: 12px;
  padding: 16px 4px;
  align-items: center;
}

.faye-confirm-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  padding: 6px 12px;
  border-radius: 6px;
  flex-shrink: 0;
}
.faye-confirm-label.critical {
  background: rgba(239, 68, 68, 0.15);
  color: #fca5a5;
}
.faye-confirm-label.approval {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
}

.faye-confirm-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 24px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  cursor: pointer;
  transition: all 0.25s ease;
  border: none;
  min-width: 120px;
}
.faye-confirm-btn svg {
  flex-shrink: 0;
}

.faye-confirm-btn.confirm {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(5, 150, 105, 0.35));
  color: #6ee7b7;
  border: 1px solid rgba(16, 185, 129, 0.3);
  box-shadow: 0 2px 16px rgba(16, 185, 129, 0.2);
}
.faye-confirm-btn.confirm:hover {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.35), rgba(5, 150, 105, 0.45));
  transform: translateY(-1px);
  box-shadow: 0 4px 24px rgba(16, 185, 129, 0.3);
}

.faye-confirm-btn.cancel {
  background: rgba(255, 255, 255, 0.06);
  color: var(--faye-text-secondary);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.faye-confirm-btn.cancel:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.25);
}

/* -- Panel Grid Overlay ----------------------------------------------- */

.faye-intel-panel::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background:
    repeating-linear-gradient(0deg, transparent, transparent 59px, rgba(16, 185, 129, 0.02) 59px, rgba(16, 185, 129, 0.02) 60px),
    repeating-linear-gradient(90deg, transparent, transparent 59px, rgba(16, 185, 129, 0.02) 59px, rgba(16, 185, 129, 0.02) 60px);
  pointer-events: none;
  z-index: 0;
}

.faye-intel-panel > * {
  position: relative;
  z-index: 1;
}

/* -- Enhanced Scrollbar ------------------------------------------------ */

.faye-scroll::-webkit-scrollbar {
  width: 4px;
}
.faye-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.faye-scroll::-webkit-scrollbar-thumb {
  background: rgba(16, 185, 129, 0.2);
  border-radius: 2px;
}
.faye-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(16, 185, 129, 0.35);
}

"""

    css = safe_replace(css,
        '/* Responsive */\n@media (max-width: 768px)',
        new_classes + '/* Responsive */\n@media (max-width: 768px)',
        'faye append classes')

    with open(path, 'w') as f:
        f.write(css)
    print(f'  Wrote {path}')
    return True


# ═══════════════════════════════════════════════════════════════════════
# 3. PATCH evie-presence.js
# ═══════════════════════════════════════════════════════════════════════
def patch_evie_js():
    path = f'{BASE}/js/evie-presence.js'
    with open(path, 'r') as f:
        js = f.read()

    # A) Close button: Unicode × → SVG
    js = safe_replace(js,
        "closeBtn.textContent = '\\u00D7';",
        "closeBtn.innerHTML = '" + ICONS['close'] + "';",
        'evie close svg')

    # B) Send button: &#8593; → SVG
    js = safe_replace(js,
        "'  <button class=\"evie-conv-send\" id=\"evie-conv-send\">&#8593;</button>'",
        "'  <button class=\"evie-conv-send\" id=\"evie-conv-send\">" + ICONS['send'] + "</button>'",
        'evie send svg')

    # C) Mode tabs: add SVG icons
    evie_mode_icons = {
        'observe': ICONS['observe'],
        'advise': ICONS['advise'],
        'converse': ICONS['chat'],
        'learn': ICONS['farm']
    }

    # Replace the tab creation loop to include icons
    js = safe_replace(js,
        """  modes.forEach(function (m) {
    var btn = document.createElement('button');
    btn.className = 'evie-mode-tab' + (m.key === activeMode ? ' active' : '');
    btn.dataset.mode = m.key;
    btn.textContent = m.label;
    btn.addEventListener('click', function () { switchMode(m.key); });
    tabBar.appendChild(btn);
  });""",
        """  var modeIcons = {
    observe: '""" + ICONS['observe'] + """',
    advise: '""" + ICONS['advise'] + """',
    converse: '""" + ICONS['chat'] + """',
    learn: '""" + ICONS['farm'] + """'
  };
  modes.forEach(function (m) {
    var btn = document.createElement('button');
    btn.className = 'evie-mode-tab' + (m.key === activeMode ? ' active' : '');
    btn.dataset.mode = m.key;
    btn.innerHTML = '<span class="evie-mode-tab-icon">' + (modeIcons[m.key] || '') + '</span>' + m.label;
    btn.addEventListener('click', function () { switchMode(m.key); });
    tabBar.appendChild(btn);
  });""",
        'evie tab icons')

    with open(path, 'w') as f:
        f.write(js)
    print(f'  Wrote {path}')
    return True


# ═══════════════════════════════════════════════════════════════════════
# 4. PATCH faye-presence.js
# ═══════════════════════════════════════════════════════════════════════
def patch_faye_js():
    path = f'{BASE}/js/faye-presence.js'
    with open(path, 'r') as f:
        js = f.read()

    faye_mode_icons = {
        'observe': ICONS['observe'],
        'advise': ICONS['advise'],
        'act': ICONS['act'],
        'explain': ICONS['explain'],
        'learn': ICONS['learn'],
        'escalate': ICONS['escalate']
    }

    # A) Close button SVG
    js = safe_replace(js,
        '<button class="faye-intel-close" id="faye-panel-close" title="Close">&times;</button>',
        '<button class="faye-intel-close" id="faye-panel-close" title="Close">' + ICONS['close'] + '</button>',
        'faye close svg')

    # B) Send button SVG
    js = safe_replace(js,
        '<button class="faye-intel-send" id="faye-panel-send" title="Send">&#9654;</button>',
        '<button class="faye-intel-send" id="faye-panel-send" title="Send">' + ICONS['send'] + '</button>',
        'faye send svg')

    # C) Mode tabs with icons
    for mode, icon in faye_mode_icons.items():
        label = mode.capitalize()
        old = f'<button class="faye-mode-tab" data-mode="{mode}">{label}</button>'
        new = f'<button class="faye-mode-tab" data-mode="{mode}"><span class="faye-mode-tab-icon">{icon}</span>{label}</button>'

        # Handle the active observe tab
        if mode == 'observe':
            old_active = '<button class="faye-mode-tab active" data-mode="observe">Observe</button>'
            new_active = '<button class="faye-mode-tab active" data-mode="observe"><span class="faye-mode-tab-icon">' + ICONS['observe'] + '</span>Observe</button>'
            js = safe_replace(js, old_active, new_active, f'faye tab icon {mode} (active)')
        else:
            js = safe_replace(js, old, new, f'faye tab icon {mode}')

    # D) Redesign showConfirmBar with futuristic buttons
    js = safe_replace(js,
        """  function showConfirmBar(pending) {
    var existing = document.getElementById('faye-confirm-row');
    if (existing) existing.remove();

    var bar = document.createElement('div');
    bar.id = 'faye-confirm-row';
    bar.style.cssText = 'display:flex;gap:8px;padding:4px 8px;align-self:flex-start;align-items:center';

    var label = document.createElement('span');
    label.className = 'faye-action-approval requires-approval';
    label.textContent = pending.tier === 'admin' ? 'CRITICAL' : 'Approval needed';

    var yesBtn = document.createElement('button');
    yesBtn.className = 'faye-mode-tab';
    yesBtn.style.cssText = 'background:rgba(16,185,129,0.2);color:#6ee7b7;cursor:pointer';
    yesBtn.textContent = 'Confirm';
    yesBtn.addEventListener('click', function () { bar.remove(); sendChat('yes'); });

    var noBtn = document.createElement('button');
    noBtn.className = 'faye-mode-tab';
    noBtn.style.cssText = 'cursor:pointer';
    noBtn.textContent = 'Cancel';
    noBtn.addEventListener('click', function () { bar.remove(); sendChat('cancel'); });

    bar.appendChild(label);
    bar.appendChild(yesBtn);
    bar.appendChild(noBtn);
    var container = getActiveConvMessages();
    container.appendChild(bar);
    container.scrollTop = container.scrollHeight;
  }""",
        """  function showConfirmBar(pending) {
    var existing = document.getElementById('faye-confirm-row');
    if (existing) existing.remove();

    var bar = document.createElement('div');
    bar.id = 'faye-confirm-row';
    bar.className = 'faye-confirm-row';

    var label = document.createElement('span');
    label.className = 'faye-confirm-label ' + (pending.tier === 'admin' ? 'critical' : 'approval');
    label.textContent = pending.tier === 'admin' ? 'CRITICAL' : 'Approval needed';

    var yesBtn = document.createElement('button');
    yesBtn.className = 'faye-confirm-btn confirm';
    yesBtn.innerHTML = '""" + ICONS['confirm'] + """ Approve';
    yesBtn.addEventListener('click', function () { bar.remove(); sendChat('yes'); });

    var noBtn = document.createElement('button');
    noBtn.className = 'faye-confirm-btn cancel';
    noBtn.innerHTML = '""" + ICONS['cancel'] + """ Decline';
    noBtn.addEventListener('click', function () { bar.remove(); sendChat('cancel'); });

    bar.appendChild(label);
    bar.appendChild(yesBtn);
    bar.appendChild(noBtn);
    var container = getActiveConvMessages();
    container.appendChild(bar);
    container.scrollTop = container.scrollHeight;
  }""",
        'faye confirm bar redesign')

    with open(path, 'w') as f:
        f.write(js)
    print(f'  Wrote {path}')
    return True


# ═══════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════
if __name__ == '__main__':
    print('--- E.V.I.E. & F.A.Y.E. Tesla Dashboard Redesign ---\n')

    print('[1/4] Patching evie-core.css...')
    patch_evie_css()

    print('\n[2/4] Patching faye-core.css...')
    patch_faye_css()

    print('\n[3/4] Patching evie-presence.js...')
    patch_evie_js()

    print('\n[4/4] Patching faye-presence.js...')
    patch_faye_js()

    print('\n--- Done ---')
