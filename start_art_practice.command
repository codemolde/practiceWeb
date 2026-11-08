#!/bin/bash
cd "$(dirname "$0")"

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js to run this app."
    exit 1
fi

# Start the server in the background
node server.js &
SERVER_PID=$!

echo "Starting Art Practice server (PID: $SERVER_PID)..."
sleep 1

# Open in default browser
open  -a "Firefox" http://localhost:3000

echo "Close this terminal window to stop the server."
wait $SERVER_PID
