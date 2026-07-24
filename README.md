# SENSE Web OS

An installable, mobile-first Web OS client deployed through GitHub Pages, with a separate MongoDB-backed Node API for accounts, messaging, administration, announcements, moderation, sessions, and audit history.

## Release structure

GitHub Actions expands the verified client release parts in `_bundle/` and deploys the resulting static application to Pages. The backend release archive is expanded by the API build command before dependency installation.

## Backend deployment

Deploy `backend/render.yaml`, then configure `MONGODB_URI`, `ADMIN_EMAIL`, and the generated `JWT_SECRET`. The account matching `ADMIN_EMAIL` receives administrator privileges at registration. MongoDB collections and indexes are created automatically when the API starts.

Never place MongoDB credentials or JWT secrets in the client, repository, or GitHub Pages settings. After deployment, enter the API address in SENSE under System → API.
