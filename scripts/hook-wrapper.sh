#!/bin/bash

# Hook wrapper for CodeAgentSwarm
# This script ensures the terminal ID is properly captured

# Get arguments
EVENT_TYPE=$1
PORT=$2
TOOL=$3

# Force capture the terminal ID from environment
# If not set, try to detect from process tree or default to 0
TERMINAL_ID=${CODEAGENTSWARM_CURRENT_QUADRANT:-0}

# Debug logging
echo "[Hook Wrapper] Terminal ID: $TERMINAL_ID, Event: $EVENT_TYPE" >&2

# Build JSON payload
if [ "$EVENT_TYPE" = "confirmation_needed" ]; then
    JSON_DATA="{\"type\":\"$EVENT_TYPE\",\"terminalId\":\"$TERMINAL_ID\",\"tool\":\"$TOOL\"}"
else
    JSON_DATA="{\"type\":\"$EVENT_TYPE\",\"terminalId\":\"$TERMINAL_ID\"}"
fi

# Send webhook with explicit terminal ID
curl -X POST "http://localhost:$PORT/webhook" \
     -H "Content-Type: application/json" \
     -d "$JSON_DATA" \
     --silent \
     --fail \
     2>/dev/null || true