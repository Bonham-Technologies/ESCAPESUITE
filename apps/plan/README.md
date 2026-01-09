# ESCAPEPLAN

Parent shell site for the ESCAPE Suite - a collection of client-side media creation tools.

## Overview

ESCAPEPLAN serves as the authentication and subscription gateway for:
- **ESCAPECRAFT** - Browser-based screen and webcam recorder
- **ESCAPEARTIST** - Client-side video editor with WebCodecs

## Features

- Clerk-based authentication
- Protected dashboard with tool launchers
- Subscription management (coming soon)
- Dark theme consistent with CRAFT/ARTIST apps

## Development

```bash
# Install dependencies
npm install

# Create .env.local with your Clerk key
cp .env.example .env.local
# Edit .env.local with your VITE_CLERK_PUBLISHABLE_KEY

# Start development server
npm run dev

# Build for production
npm run build
```

## Tech Stack

- React 19 + TypeScript + Vite
- React Router for routing
- Clerk for authentication
- CSS Modules for styling
