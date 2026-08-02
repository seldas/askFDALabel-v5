FROM nginx:stable-alpine

RUN apk add --no-cache curl

RUN mkdir -p /etc/nginx/certs
COPY default.conf /etc/nginx/conf.d/default.conf
COPY ssl.conf.template /etc/nginx/conf.d/ssl.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && sed -i 's/\r//' /entrypoint.sh

# Use wildcard COPY with a sentinel file (default.conf) to avoid failure if .pem files don't exist
# cert.pem and key.pem will be in /etc/nginx/certs/ if they exist in build context
COPY default.conf cert.pem* key.pem* /etc/nginx/certs/

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
