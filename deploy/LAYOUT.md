# VPS layout — tools do not share a tree

**Host:** one machine. **Rule:** one product = one directory = one compose project = one or more origins. No shared Postgres, no shared Redis, no shared document root.

```text
/srv/netzwerkpunkt/
├── hub/www                      netzwerkpunkt.de          static hub
├── 4allpass/
│   ├── landing                  4allpass.netzwerkpunkt.de static HTML only
│   └── vault/                   vault.4allpass.netzwerkpunkt.de
│       ├── compose.yml          this repo: deploy/compose.yml
│       ├── .env                 secrets, never in git
│       └── data/                compose named volume (or bind)
├── tollgate/
│   ├── landing                  tollgate.netzwerkpunkt.de
│   └── app/                     later; ports 81xx
└── gnom-hub-v1/
    ├── landing                  gnom-hub-v1.netzwerkpunkt.de
    └── app/                     later; ports 82xx
```

## Origins (4AllPass)

| Origin | May serve | Must not |
|---|---|---|
| `netzwerkpunkt.de` | Hub index | Vault blobs, 4AllPass `/api` |
| `4allpass.netzwerkpunkt.de` | Product landing | `/api`, Postgres, Redis, PWA with session |
| `vault.4allpass.netzwerkpunkt.de` | PWA + `/api/v1` ciphertext | Marketing HTML from another product |

Landing and vault are **different TLS names**. XSS on the landing page must not see `4allpass.session`.

## Loopback ports (this host)

Do not publish these on `0.0.0.0`. Nginx terminates TLS.

| Product | API | Web |
|---|---|---|
| 4AllPass vault | `127.0.0.1:8000` | `127.0.0.1:8080` |
| Tollgate (reserved) | `127.0.0.1:8100` | `127.0.0.1:8180` |
| Gnom-Hub-V1 (reserved) | `127.0.0.1:8200` | `127.0.0.1:8280` |

Compose project name for this vault: `4allpass-vault`. Never `default`.

## Nginx

- One file per origin under `/etc/nginx/sites-enabled/`.
- `deploy/nginx-landing.conf` — static, `location /api { return 404; }`
- `deploy/nginx-vault.conf` — proxy to 8000/8080 only

## Init on the host

```sh
sudo bash deploy/init-tree.sh
```

Then copy landing HTML into `/srv/netzwerkpunkt/4allpass/landing`, copy this `deploy/` dir into `/srv/netzwerkpunkt/4allpass/vault`, add DNS `vault.4allpass` A/AAAA to the VPS, Certbot, `docker compose --project-name 4allpass-vault up -d`.
