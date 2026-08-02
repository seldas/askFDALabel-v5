# Configuring Existing Nginx Server

To host our application on the target server using the existing Nginx server, follow these steps:

1. **Create a new configuration file**: On the target server, create a new file in the Nginx configuration directory (usually `/etc/nginx/conf.d/` or `/etc/nginx/sites-available/`). Name it `askfdalabel.conf`.

2. **Add the configuration**: Add the following configuration to the `askfdalabel.conf` file:

```nginx
location /askfdalabel {
    proxy_pass http://localhost:8841/askfdalabel;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /askfdalabel_api {
    proxy_pass http://localhost:8842;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

3. **Adjust the ports**: Ensure that the ports used in the `proxy_pass` directives (8841 and 8842) match the ports exposed by our application's containers.

4. **Enable the configuration**: If you created the file in `/etc/nginx/sites-available/`, create a symbolic link to it in `/etc/nginx/sites-enabled/`. For example:
   ```bash
   sudo ln -s /etc/nginx/sites-available/askfdalabel.conf /etc/nginx/sites-enabled/
   ```

5. **Test and reload Nginx**: Test the Nginx configuration for syntax errors:
   ```bash
   sudo nginx -t
   ```
   If the test is successful, reload Nginx to apply the new configuration:
   ```bash
   sudo nginx -s reload
   ```

6. **Verify the application**: Access the application at `https://askfdalabel-nctr.preprod.fda.gov/askfdalabel/` or `https://askfdalabel-nctr.preprod.fda.gov/askfdalabel_api/` to verify that it's working correctly.

By following these steps, you should be able to configure the existing Nginx server on the target server to host our application.