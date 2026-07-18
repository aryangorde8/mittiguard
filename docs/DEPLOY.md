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
first V4 start. Never commit either file.

## Required server environment

```env
PORT=8080
MITTIGUARD_STORE_PATH=/var/lib/mittiguard/store.json
MITTIGUARD_AUDIT_SECRET=<a stable 64-hex-character secret>
MITTIGUARD_MODE=jury-demo
MODEL_PROVIDER=nova
AWS_REGION=us-east-1
NOVA_MODEL_ID=amazon.nova-pro-v1:0
AWS_BEARER_TOKEN_BEDROCK=<Bedrock bearer token>
```

Generate the audit secret once with `openssl rand -hex 32`. Set it before the
first V4 relay event and keep it stable: changing it invalidates verification
of earlier HMAC ledger entries. Store the environment file with mode `600`.
The Human Review Attestation deliberately refuses to run without this seal.
If the existing demo ledger predates the secret or the current sealed-audit
format, restart with the secret and use **Load clean jury demo** once before
recording: older entries cannot be retroactively given the current anchor.

The public hackathon instance should stay in `jury-demo` mode and must use
only the bundled synthetic data. For any real operation, set
`MITTIGUARD_MODE=operations`, configure `MITTIGUARD_OPERATOR_KEY`, and replace
the local JSON store with an authenticated multi-user data service.

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
