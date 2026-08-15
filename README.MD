# hw-05 — Dockerized Express + Postgres service

Minimal Express API (`GET /health`, `GET /users`) backed by Postgres, containerized with a
multi-stage `Dockerfile`, non-root runtime user, healthcheck, and a `docker-compose.yml` +
`docker-compose.override.yml` split so the base stack stays CI-safe while local dev gets
hot-reload.

## Running it

Production/CI (base file only, no source bind-mount, no hot-reload):

```
docker compose -f docker-compose.yml up -d
```

Local dev (auto-merges `docker-compose.override.yml` — bind-mounts `src/`, runs `nodemon`,
publishes port 3000):

```
docker compose up -d
```

Either way, once it's up:

```
curl http://localhost:3000/health
curl http://localhost:3000/users
```

Tear down (keeps the Postgres data volume):

```
docker compose down
```

Tear down and wipe the database too:

```
docker compose down -v
```

## Image size: multi-stage vs single-stage

| Build | Image | Size |
|---|---|---|
| Multi-stage (`Dockerfile`, this repo) | `nodejspro-api` | **234 MB** |
| Single-stage, "the lazy way" (`node:22` full base, `npm install`, one stage) | `hw5-api-naive` | **1.14 GB** |

The multi-stage build is about **4.9x smaller** (234 MB vs 1.14 GB): the naive build uses the
full `node:22` base image (~1.1 GB before any app code) and `npm install` with no `--omit=dev`,
while the multi-stage build runs on `node:22-slim` and installs only production dependencies in
a clean final stage that never sees `devDependencies`, source-control files, or the builder's
`node_modules`.

## Verifying Postgres data survives a restart

```
docker compose exec postgres psql -U appuser -d appdb -c "INSERT INTO users (name, email) VALUES ('Persistence Test', 'persist@example.com');"
docker compose exec postgres psql -U appuser -d appdb -c "SELECT * FROM users;"
docker compose down
docker compose up -d
docker compose exec postgres psql -U appuser -d appdb -c "SELECT * FROM users;"
```

Verified: after `down` (no `-v`) and `up -d`, the final `SELECT` still returned both rows,
including `Persistence Test` — confirming the data survived the restart.

The `postgres` service stores its data in the named volume `pgdata`, mounted at
`/var/lib/postgresql/data`. Since `docker compose down` (without `-v`) removes containers but
not volumes, the `Persistence Test` row inserted before the restart is still present after
`docker compose up -d` brings the stack back.
