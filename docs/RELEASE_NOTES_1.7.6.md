# Findstuff 1.7.6

Findstuff 1.7.6 makes localhost, trusted-LAN, and Tailscale Serve access work
together in fresh Docker installations without a machine-specific bind setting.

## Improved

- Fresh installs listen on the host's loopback and LAN interfaces by default,
  so Findstuff is available at both `http://localhost:8000` and
  `http://<machine-lan-ip>:8000`.
- Tailscale Serve continues to work with its standard
  `http://127.0.0.1:8000` proxy target and provides private HTTPS.
- Compose uses the same listener when no `.env` file is present.
- Existing installations retain their explicit `.env` bind address during an
  update instead of silently changing their network exposure.
- Deployment guidance now explains the trusted-LAN boundary, adaptive session
  cookie behavior, and the risks of router port forwarding or public cloud
  firewall exposure.

Authentication remains enabled by default. LAN access uses plain HTTP and is
intended only for trusted networks; camera, microphone, PWA installation, and
remote access should use Tailscale Serve or another trusted HTTPS endpoint.

## Verification

- Validated Compose with the generated `.env` and with no environment file.
- Verified authenticated sessions over localhost, LAN HTTP, and Tailscale
  HTTPS, including non-secure cookies on HTTP and secure cookies on HTTPS.
- Passed repository policy, backend, frontend, production-build, and Docker
  update checks before publication.
