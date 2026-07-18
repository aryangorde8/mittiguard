# Deployment notes

MittiGuard Relay is a self-contained jury-demo prototype. These notes make its
runtime boundary reproducible without treating the local JSON ledger as a
production database.

## Keep runtime state out of Git

`data/demo-store.json` is a versioned fixture for **Load clean jury demo**.
`data/store.json` is deliberately ignored because the server mutates it. In a
container, set `MITTIGUARD_STORE_PATH=/var/lib/mittiguard/store.json` and mount
only that runtime directory:

```bash
mkdir -p /opt/mittiguard/runtime
docker run -d --name mittiguard --restart unless-stopped \
  --env-file /etc/mittiguard.env \
  -p 127.0.0.1:8080:8080 \
  -v /opt/mittiguard/runtime:/var/lib/mittiguard \
  mittiguard:latest
```

Do not mount over `/app/data`; the container needs its bundled demo fixture.
If an earlier deployment used `/opt/mittiguard/data/store.json`, make a backup
and **copy** that file into `/opt/mittiguard/runtime/store.json` before the
first V4.3 start. Never commit either file.

## Required server environment

```env
PORT=8080
MITTIGUARD_STORE_PATH=/var/lib/mittiguard/store.json
MITTIGUARD_AUDIT_SECRET=<a stable 64-hex-character secret>
MITTIGUARD_MODE=jury-demo
MITTIGUARD_PUBLIC_BASE_URL=https://mittiguard.example.com
MODEL_PROVIDER=nova
AWS_REGION=us-east-1
NOVA_MODEL_ID=amazon.nova-pro-v1:0
AWS_BEARER_TOKEN_BEDROCK=<Bedrock bearer token>
```

Generate the audit secret once with `openssl rand -hex 32`. Set it before the
first V4.3 relay event and keep it stable: changing it invalidates verification
of earlier HMAC ledger entries. Store the environment file with mode `600`.
The Human Review Attestation deliberately refuses to run without this seal.
If the existing demo ledger predates the secret or the current sealed-audit
format, restart with the secret and use **Load clean jury demo** once before
recording: older entries cannot be retroactively given the current anchor.

The public hackathon instance should stay in `jury-demo` mode and must use
only the bundled synthetic data. For any real operation, set
`MITTIGUARD_MODE=operations`, configure `MITTIGUARD_OPERATOR_KEY`, and replace
the local JSON store with an authenticated multi-user data service.

`MITTIGUARD_PUBLIC_BASE_URL` should be the exact public HTTPS origin (with no
query string or fragment). The server uses it when it creates one-time Field
Capture links, rather than trusting an incoming `Host` header. Verify that
`/api/health` reports `fieldCapturePublicBaseUrlConfigured: true` before
recording the mobile-capture portion of the demo.

## Reverse proxy

Expose only HTTPS through Caddy or another reverse proxy. Keep the Node
container on `127.0.0.1:8080`:

```caddyfile
mittiguard.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

After deployment, open `/api/health`, then run one jury case and confirm
`/api/ledger/verify` returns `valid: true`. With an audit secret and a newly
created production ledger, it should also return `sealed: true`.

For the mobile Field Capture demo, create a link from a pending Field Capture
task and confirm that it begins with your public `https://` domain and opens on
a phone. The one-time capability is kept after `#` in the URL fragment, so it
is not sent to Caddy or ordinary access logs. The page sends that capability
only to the narrow same-origin Field Capture endpoints; it cannot release a
sale. Do not use a hosted QR-code service for this link because that would
expose the capability to a third party.

## AWS Lightsail without Docker

This is the shortest repeatable path for a small Ubuntu Lightsail instance.
It keeps the application on localhost and does not depend on Docker or Caddy.
Replace `mittiguard.example.com` with the subdomain whose DNS A record points
to the instance's **static** IP.

Install Node 22, Nginx, and Certbot once:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx git
```

Clone the public repository and make a runtime directory that Git never
touches:

```bash
sudo mkdir -p /opt/mittiguard /var/lib/mittiguard
sudo chown -R "$USER":"$USER" /opt/mittiguard /var/lib/mittiguard
git clone https://github.com/aryangorde8/mittiguard.git /opt/mittiguard
```

Create `/etc/mittiguard.env` with mode `600`. Use fresh credentials; never
paste a token into the repository or terminal recording:

```env
PORT=8080
MITTIGUARD_STORE_PATH=/var/lib/mittiguard/store.json
MITTIGUARD_AUDIT_SECRET=<stable-secret-from-openssl-rand-hex-32>
MITTIGUARD_MODE=jury-demo
MITTIGUARD_PUBLIC_BASE_URL=https://mittiguard.example.com
MODEL_PROVIDER=nova
AWS_REGION=us-east-1
NOVA_MODEL_ID=amazon.nova-pro-v1:0
AWS_BEARER_TOKEN_BEDROCK=<fresh-bedrock-token>
```

Create `/etc/systemd/system/mittiguard.service`:

```ini
[Unit]
Description=MittiGuard Relay jury demo
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/mittiguard
EnvironmentFile=/etc/mittiguard.env
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Start the service and make its local health endpoint pass before exposing it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mittiguard
curl http://127.0.0.1:8080/api/health
```

Then create `/etc/nginx/sites-available/mittiguard`:

```nginx
server {
    listen 80;
    server_name mittiguard.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable TLS after the DNS record resolves:

```bash
sudo ln -sf /etc/nginx/sites-available/mittiguard /etc/nginx/sites-enabled/mittiguard
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d mittiguard.example.com
```

To update the jury demo to a verified GitHub commit, run:

```bash
cd /opt/mittiguard
git pull --ff-only origin main
sudo systemctl restart mittiguard
curl -fsS https://mittiguard.example.com/api/health
```

Before sharing the URL, confirm the health response has
`liveProviderEnabled: true`, `fieldCapturePublicBaseUrlConfigured: true`, and
a verified, sealed audit ledger. Then run `npm run smoke:model` and
`npm run eval:intake:nova -- --json` on the server, reset the jury ledger once,
and record the demo.

If the credential lives only in `/etc/mittiguard.env`, run the checks without
printing that file or its values:

```bash
sudo bash -c 'set -a; . /etc/mittiguard.env; set +a; cd /opt/mittiguard; npm run smoke:model; npm run eval:intake:nova -- --json'
```

Keep the unedited evaluation output only if it passes, label it as a synthetic
intake-contract evaluation, and never present it as agronomic validation.
