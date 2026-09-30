FROM nginx:stable-alpine

RUN apk add --no-cache curl

RUN mkdir -p /etc/nginx/certs
COPY default.conf /etc/nginx/conf.d/default.conf
COPY ssl.conf.template /etc/nginx/conf.d/ssl.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && sed -i 's/\r//' /entrypoint.sh

# TLS certificates are selected per environment and mounted at runtime.

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
