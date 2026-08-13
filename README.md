# HTTP/HTTPS Server from scratch

## Run

```
node src/server.js        → http://localhost:3000
node src/https-server.js  → https://localhost:3443
```

## Generate self-signed certificate

Run this once before starting the HTTPS server:

```
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "//CN=localhost"
```

## Debug session

```
openssl s_client -connect localhost:3443 -servername localhost
```

Output:

```
depth=0 CN=localhost
verify error:num=18
verify return:1
...
Verify return code: 18 (self-signed certificate)
```

**Error code 18** — the certificate was signed by itself and is not trusted by any certificate authority.
