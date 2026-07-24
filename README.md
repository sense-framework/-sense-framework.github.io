# SENSE Unified Workspace

SENSE is an installable company workspace that combines an intranet, social profiles and feed, team spaces, cloud files, messaging, project and issue tracking, calendar operations, administration, GitHub synchronization, and a company-aware AI workspace.

## Client modules

- Home dashboard and global activity
- Company social feed, comments, reactions, and announcements
- Direct messages and team channels
- Employee profiles, skills, roles, and departments
- Team spaces and membership
- File and folder workspace with upload-ready controls
- Projects, repository views, issue board, and GitHub integration surface
- SENSE AI conversations and workspace context
- Company calendar, agenda, and tasks
- Administration, roles, suspension, broadcasts, and audit history
- Unified search, notifications, mobile navigation, offline shell, and PWA installation

The static client runs immediately in temporary local administrator preview mode. Browser-local changes are for interface evaluation only.

## Production backend

The `backend/` directory contains the MongoDB-backed Node API. It includes accounts, profiles, feed data, conversations, GridFS file storage, teams, projects, issues, events, notifications, AI threads, optional OpenAI Responses API access, optional GitHub organization synchronization, moderation, and audit logging.

Configure the backend environment from `backend/.env.example`. Secrets belong only in the backend host, never in GitHub Pages or browser code.
