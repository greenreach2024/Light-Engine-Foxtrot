#!/bin/bash
set -x

# Force restart of the web process
echo "Restarting web process..."
sudo systemctl restart web.service || sudo service web restart || killall -HUP node
echo "Web process restart command sent"
