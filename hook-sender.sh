#!/bin/bash

# Hook sender script for CodeAgentSwarm
# Usage: hook-sender.sh <event_type> <port> [tool]

EVENT_TYPE=$1
PORT=$2
TOOL=$3

# Get terminal ID from environment, default to 0
TERMINAL_ID=${CODEAGENTSWARM_CURRENT_QUADRANT:-0}

# Build JSON payload
if [ "$EVENT_TYPE" = "confirmation_needed" ]; then
    JSON_DATA="{\"type\":\"$EVENT_TYPE\",\"terminalId\":\"$TERMINAL_ID\",\"tool\":\"$TOOL\"}"
else
    JSON_DATA="{\"type\":\"$EVENT_TYPE\",\"terminalId\":\"$TERMINAL_ID\"}"
fi

# Send webhook
curl -X POST "http://localhost:$PORT/webhook" \
     -H "Content-Type: application/json" \
     -d "$JSON_DATA" \
     --silent \
     --fail \
     2>/dev/null || true