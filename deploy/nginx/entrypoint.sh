#!/bin/sh

# Path to the certs
CERT_SRC="/etc/nginx/certs/cert.pem"
KEY_SRC="/etc/nginx/certs/key.pem"
CONF_FILE="/etc/nginx/conf.d/default.conf"
SSL_ENABLED="/etc/nginx/conf.d/ssl.conf"

if [ -f "$CERT_SRC" ] && [ -f "$KEY_SRC" ]; then
    echo "Certificates found. Enabling HTTPS."
    # Dockerfile installs ssl.conf.template as ssl.conf, already included by nginx.
    # Ensure redirect is enabled in map
    sed -i 's/default 0;/default 1;/g' "$CONF_FILE"
    sed -i 's/"~^http:.*$" 0;/"~^http:.*$" 1;/g' "$CONF_FILE"
else
    echo "Certificates NOT found. Running on HTTP only."
    # Disable HTTPS by creating an empty included file
    rm -f "$SSL_ENABLED"
    sed -i '/include \/etc\/nginx\/conf.d\/ssl.conf;/d' "$CONF_FILE"
    # Disable redirect in map (both the regex and the default)
    sed -i 's/default 1;/default 0;/g' "$CONF_FILE"
    sed -i 's/"~^http:.*$" 1;/"~^http:.*$" 0;/g' "$CONF_FILE"
fi

exec "$@"
