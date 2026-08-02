#!/bin/sh

# Path to the certs
CERT_SRC="/etc/nginx/certs/cert.pem"
KEY_SRC="/etc/nginx/certs/key.pem"
CERT_DEST="/etc/nginx/certs/askfdalabel.crt"
KEY_DEST="/etc/nginx/certs/askfdalabel.key"
CONF_FILE="/etc/nginx/conf.d/default.conf"
SSL_TEMPLATE="/etc/nginx/conf.d/ssl.conf.template"
SSL_ENABLED="/etc/nginx/conf.d/ssl_enabled.conf"

if [ -f "$CERT_SRC" ] && [ -f "$KEY_SRC" ]; then
    echo "Certificates found. Enabling HTTPS."
    cp "$CERT_SRC" "$CERT_DEST"
    cp "$KEY_SRC" "$KEY_DEST"
    # Enable HTTPS by copying the template to the included file
    cp "$SSL_TEMPLATE" "$SSL_ENABLED"
    # Ensure redirect is enabled in map
    sed -i 's/default 0;/default 1;/g' "$CONF_FILE"
    sed -i 's/"~^http:.*$" 0;/"~^http:.*$" 1;/g' "$CONF_FILE"
else
    echo "Certificates NOT found. Running on HTTP only."
    # Disable HTTPS by creating an empty included file
    echo "# SSL disabled" > "$SSL_ENABLED"
    # Disable redirect in map (both the regex and the default)
    sed -i 's/default 1;/default 0;/g' "$CONF_FILE"
    sed -i 's/"~^http:.*$" 1;/"~^http:.*$" 0;/g' "$CONF_FILE"
fi

exec "$@"
