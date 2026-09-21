# Findstuff 1.13.1

Signing in now works when Findstuff is embedded in another site, such as an
iframe card on a Home Assistant dashboard. No database changes: upgrading from
1.13.0 needs no migration.

## Signing in inside a frame

Findstuff keeps its session in a `SameSite=Strict` cookie. A browser refuses that
cookie when Findstuff is framed by a page on a different address, so a correct
password was accepted and the very next request arrived without a session. The
sign-in form then reported `Authentication required` even though nothing was
wrong with the credentials.

- When a sign-in succeeds but the follow-up request is still unauthenticated,
  the tab now carries the session as an `Authorization: Bearer` header instead.
  The token is held in that tab's `sessionStorage` and ends with the tab.
  Ordinary tabs keep using the cookie exactly as before.
- Photos, documents, QR codes, labels and project files are loaded by the
  browser itself and cannot carry a header. A framed tab loads them with a
  separate **media token** in the query string. It is read-only, opens only GET
  requests to those file routes, and expires after 24 hours, so one recorded in
  an access log cannot change the inventory. Label pages pass it on to the QR
  image they embed.
- The token's scope is part of its signature: a media token cannot be relabelled
  into a session token, and neither kind is accepted in the other's place.
  Changing the admin password still invalidates every issued token.
- Signing out clears the tab's header session.

The header path is immune to cross-site request forgery, since another site
cannot attach the header. The trade-off is that scripts running on the page can
read the token, which the HttpOnly cookie hid; it applies only to framed tabs.

## API

- `POST /api/v1/auth/login` also returns `session_token`.
- `GET /api/v1/auth/media-token` issues a media token; it requires a full session.
- Requests may authenticate with `Authorization: Bearer <session_token>`.
