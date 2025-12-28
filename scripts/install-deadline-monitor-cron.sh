#!/bin/bash
# Install deadline monitor as a cron job

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "Installing deadline monitor cron job..."
echo "Project root: $PROJECT_ROOT"

# Create cron entry
CRON_ENTRY="*/5 * * * * cd $PROJECT_ROOT && node scripts/run-deadline-monitor.js >> logs/deadline-monitor.log 2>&1"

# Check if cron entry already exists
if crontab -l 2>/dev/null | grep -q "run-deadline-monitor.js"; then
    echo "⚠️  Deadline monitor cron job already installed"
    echo ""
    echo "Current cron jobs:"
    crontab -l | grep "run-deadline-monitor.js"
else
    # Add to crontab
    (crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -
    echo "✅ Deadline monitor installed as cron job"
    echo ""
    echo "Schedule: Every 5 minutes"
    echo "Log file: $PROJECT_ROOT/logs/deadline-monitor.log"
fi

echo ""
echo "To view all cron jobs:"
echo "  crontab -l"
echo ""
echo "To remove the cron job:"
echo "  crontab -e"
echo "  (Delete the line containing 'run-deadline-monitor.js')"
