export CORS_ALLOW_ORIGIN="http://localhost:5173;http://localhost:8080"

# Allow access from other devices on the LAN: append this machine's interface
# IPs for both the Vite dev server (5173) and the backend (8080), which also
# serves the built frontend.
for ip in $(hostname -I 2>/dev/null); do
	# Browsers send IPv6 origins bracketed, e.g. http://[fd12::1]:5173
	case $ip in
	*:*) ip="[$ip]" ;;
	esac
	CORS_ALLOW_ORIGIN="$CORS_ALLOW_ORIGIN;http://$ip:5173;http://$ip:8080"
done
export CORS_ALLOW_ORIGIN
PORT="${PORT:-8080}"
uvicorn open_webui.main:app --port $PORT --host 0.0.0.0 --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-*}" --ws-per-message-deflate "${UVICORN_WS_PER_MESSAGE_DEFLATE:-true}" --reload
