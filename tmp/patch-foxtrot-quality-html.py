#!/usr/bin/env python3
"""Patch Foxtrot public/LE-farm-admin.html — replace quality control section with new two-tab layout."""
import sys

TARGET = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/public/LE-farm-admin.html'

with open(TARGET, 'r') as f:
    content = f.read()

# Find section-quality start
start_marker = '<!-- Quality Control Section -->'
end_marker = '<!-- Other sections would be loaded here dynamically -->'

start_idx = content.find(start_marker)
if start_idx == -1:
    print('ERROR: Could not find quality section start marker')
    sys.exit(1)

end_idx = content.find(end_marker, start_idx)
if end_idx == -1:
    print('ERROR: Could not find quality section end marker')
    sys.exit(1)

NEW_HTML = '''<!-- Quality Control Section -->
            <div id="section-quality" class="content-section" style="display: none;">
                <div class="header">
                    <h1>Quality Control</h1>
                    <div class="header-actions">
                        <button class="btn" onclick="exportQualityReport()">Export Report</button>
                    </div>
                </div>

                <!-- Quality Metrics Overview (wired to API) -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 30px;">
                    <div class="card" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.05) 100%); border-left: 4px solid var(--accent-green);">
                        <h3 style="font-size: 14px; color: var(--text-secondary); margin-bottom: 8px;">Pass Rate (30 Days)</h3>
                        <div style="font-size: 32px; font-weight: bold; color: var(--accent-green);" id="quality-pass-rate">--</div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">From QA checkpoints</div>
                    </div>
                    <div class="card" style="background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(37, 99, 235, 0.05) 100%); border-left: 4px solid var(--accent-blue);">
                        <h3 style="font-size: 14px; color: var(--text-secondary); margin-bottom: 8px;">Total Inspections</h3>
                        <div style="font-size: 32px; font-weight: bold; color: var(--accent-blue);" id="tests-completed">0</div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">Last 30 days</div>
                    </div>
                    <div class="card" style="background: linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(217, 119, 6, 0.05) 100%); border-left: 4px solid var(--accent-yellow);">
                        <h3 style="font-size: 14px; color: var(--text-secondary); margin-bottom: 8px;">Pending Review</h3>
                        <div style="font-size: 32px; font-weight: bold; color: var(--accent-yellow);" id="pending-review">0</div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">Requires attention</div>
                    </div>
                    <div class="card" style="background: linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(220, 38, 38, 0.05) 100%); border-left: 4px solid var(--accent-red);">
                        <h3 style="font-size: 14px; color: var(--text-secondary); margin-bottom: 8px;">Failed</h3>
                        <div style="font-size: 32px; font-weight: bold; color: var(--accent-red);" id="failed-tests">0</div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">Last 30 days</div>
                    </div>
                </div>

                <!-- Quality Tabs -->
                <div style="display: flex; gap: 0; margin-bottom: 0; border-bottom: 2px solid var(--border);">
                    <button id="qa-tab-inspections" class="btn" onclick="switchQualityTab('inspections')" style="border-radius: 8px 8px 0 0; border: 2px solid var(--accent-green); border-bottom: none; background: var(--accent-green); color: white; padding: 10px 24px; font-weight: 600; margin-bottom: -2px;">QA Inspections</button>
                    <button id="qa-tab-labreports" class="btn" onclick="switchQualityTab('labreports')" style="border-radius: 8px 8px 0 0; border: 2px solid var(--border); border-bottom: none; background: var(--bg-card); color: var(--text-secondary); padding: 10px 24px; font-weight: 500; margin-bottom: -2px; margin-left: 4px;">Lab Reports</button>
                </div>

                <!-- Tab 1: QA Inspections (from Activity Hub / Foxtrot) -->
                <div id="qa-panel-inspections" class="card" style="border-top: none; border-radius: 0 8px 8px 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h2>QA Checkpoint Inspections</h2>
                        <div style="display: flex; gap: 12px;">
                            <select id="quality-type-filter" onchange="filterQualityCheckpoints()" style="padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-primary);">
                                <option value="all">All Types</option>
                                <option value="pre_harvest">Pre-Harvest</option>
                                <option value="post_harvest">Post-Harvest</option>
                                <option value="packaging">Packaging</option>
                                <option value="storage">Storage</option>
                            </select>
                            <select id="quality-result-filter" onchange="filterQualityCheckpoints()" style="padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-primary);">
                                <option value="all">All Results</option>
                                <option value="pass">Passed</option>
                                <option value="fail">Failed</option>
                                <option value="pending">Pending</option>
                            </select>
                        </div>
                    </div>
                    <p style="color: var(--text-secondary); margin-bottom: 16px; font-size: 14px;">
                        Inspections are recorded from the Activity Hub during harvest and packaging workflows.
                    </p>
                    <div class="table-container">
                        <table id="quality-tests-table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Date</th>
                                    <th>Batch</th>
                                    <th>Type</th>
                                    <th>Inspector</th>
                                    <th>Result</th>
                                    <th>Notes</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
                                        Loading QA inspections...
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Tab 2: Lab Reports -->
                <div id="qa-panel-labreports" class="card" style="display: none; border-top: none; border-radius: 0 8px 8px 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h2>Lab Reports</h2>
                        <button class="btn" onclick="openLabReportModal()" style="background: var(--accent-blue); color: white;">+ Record Lab Report</button>
                    </div>
                    <p style="color: var(--text-secondary); margin-bottom: 16px; font-size: 14px;">
                        Record results from third-party lab testing (microbial, GAP audits, nutrient analysis, water quality, etc.)
                    </p>
                    <div class="table-container">
                        <table id="lab-reports-table">
                            <thead>
                                <tr>
                                    <th>Report ID</th>
                                    <th>Date</th>
                                    <th>Type</th>
                                    <th>Lab Name</th>
                                    <th>Lot / Batch</th>
                                    <th>Result</th>
                                    <th>Notes</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="lab-reports-tbody">
                                <tr>
                                    <td colspan="8" style="text-align: center; padding: 40px; color: var(--text-muted);">
                                        Loading lab reports...
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Lab Report Modal -->
            <div id="labReportModal" class="modal" style="display: none;">
                <div class="modal-content" style="max-width: 560px;">
                    <div class="modal-header">
                        <h2>Record Lab Report</h2>
                        <button class="modal-close" onclick="closeLabReportModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="lab-report-form" onsubmit="submitLabReport(event)">
                            <div style="display: flex; flex-direction: column; gap: 16px;">
                                <div>
                                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: var(--text-secondary);">Report Type *</label>
                                    <select id="lr-report-type" required style="width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-primary);">
                                        <option value="">Select type...</option>
                                        <option value="microbial">Microbial Testing</option>
                                        <option value="gap_audit">GAP Audit</option>
                                        <option value="nutrient">Nutrient Analysis</option>
                                        <option value="pesticide">Pesticide Residue</option>
                                        <option value="water">Water Quality</option>
                                        <option value="other">Other</option>
                                    </select>
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: var(--text-secondary);">Test Date *</label>
                                    <input type="date" id="lr-test-date" required style="width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-primary);">
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: var(--text-secondary);">Lab Name</label>
                                    <input type="text" id="lr-lab-name" placeholder="e.g., SafeFood Labs" style="width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-primary);">
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: var(--text-secondary);">Lot / Batch Code</label>
                                    <input type="text" id="lr-lot-code" placeholder="e.g., LOT-2026-042" style="width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-primary);">
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: var(--text-secondary);">Result *</label>
                                    <select id="lr-result" required style="width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-primary);">
                                        <option value="pass">Pass</option>
                                        <option value="fail">Fail</option>
                                        <option value="pending">Pending</option>
                                    </select>
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: 6px; font-weight: 500; color: var(--text-secondary);">Notes</label>
                                    <textarea id="lr-notes" rows="3" placeholder="Summary of results, certificate number, etc." style="width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-primary); resize: vertical;"></textarea>
                                </div>
                                <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 8px;">
                                    <button type="button" class="btn" onclick="closeLabReportModal()" style="background: var(--bg-secondary); color: var(--text-primary);">Cancel</button>
                                    <button type="submit" class="btn" style="background: var(--accent-green); color: white;">Save Report</button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Other sections would be loaded here dynamically -->
'''

content = content[:start_idx] + NEW_HTML + content[end_idx:]

with open(TARGET, 'w') as f:
    f.write(content)

print(f'OK — patched Foxtrot LE-farm-admin.html quality section ({len(NEW_HTML)} chars)')
