# Task Management System - Frontend

Modern React/Next.js frontend for the Task Management System.

## Features

- 🎨 **Modern UI** - Built with Next.js 14, React, and Tailwind CSS
- 🔄 **Real-time Updates** - WebSocket integration for live notifications
- 📱 **Responsive Design** - Works seamlessly on desktop, tablet, and mobile
- 🌙 **Dark Mode** - Full dark mode support
- ⚡ **Fast & Optimized** - Server-side rendering and optimized bundle size
- 🔐 **Secure Authentication** - JWT-based auth with automatic token refresh
- 📊 **Dashboard** - Beautiful analytics and task visualization
- 🎯 **Type-Safe** - Full TypeScript support

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Data Fetching**: TanStack Query (React Query)
- **Forms**: React Hook Form + Zod validation
- **HTTP Client**: Axios
- **WebSocket**: Native WebSocket API
- **Icons**: Lucide React
- **Charts**: Recharts
- **Animations**: Framer Motion
- **Notifications**: Sonner

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn or pnpm

### Installation

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local

# Update .env.local with your backend URL
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080

# Run development server
npm run dev
```

The application will be available at http://localhost:3000

### Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
frontend/
├── src/
│   ├── app/                    # Next.js app router pages
│   │   ├── (auth)/            # Auth pages (login, register)
│   │   ├── (dashboard)/       # Dashboard pages
│   │   ├── layout.tsx         # Root layout
│   │   └── page.tsx           # Home page
│   ├── components/            # React components
│   │   ├── ui/               # Reusable UI components
│   │   ├── layout/           # Layout components
│   │   ├── tasks/            # Task-specific components
│   │   └── providers.tsx     # App providers
│   ├── lib/                   # Utilities and configs
│   │   ├── api/              # API client and endpoints
│   │   └── utils.ts          # Helper functions
│   ├── store/                 # Zustand stores
│   └── hooks/                 # Custom React hooks
├── public/                    # Static assets
├── next.config.mjs           # Next.js configuration
├── tailwind.config.js        # Tailwind CSS configuration
├── tsconfig.json             # TypeScript configuration
└── package.json              # Dependencies

```

## API Integration

The frontend communicates with the backend via:

1. **REST API** - HTTP endpoints for CRUD operations
2. **WebSocket** - Real-time updates for tasks and notifications

### API Client

The API client is fully typed and includes:
- Automatic JWT token management
- Token refresh on expiration
- Request/response interceptors
- Error handling

```typescript
import { api } from '@/lib/api';

// Login
const response = await api.auth.login({
  email: 'user@example.com',
  password: 'password',
});

// Create task
const task = await api.tasks.createTask({
  title: 'New Task',
  description: 'Task description',
  priority: 'HIGH',
});

// Get user notifications
const notifications = await api.notifications.getUserNotifications(userId);
```

### WebSocket Client

Real-time updates via WebSocket:

```typescript
import { wsClient } from '@/lib/api/websocket';

// Connect
wsClient.connect(accessToken);

// Listen for task updates
wsClient.on('task.created', (message) => {
  console.log('New task:', message.data);
});

// Listen for notifications
wsClient.on('notification.new', (message) => {
  showNotification(message.data);
});

// Disconnect
wsClient.disconnect();
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript compiler check

## Environment Variables

Create a `.env.local` file:

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

## Features Overview

### Authentication
- User registration
- Login with email/password
- JWT-based authentication
- Automatic token refresh
- Protected routes

### Dashboard
- Task statistics
- Charts and analytics
- Recent activity
- Quick actions

### Task Management
- Create, read, update, delete tasks
- Task assignment
- Priority levels (LOW, MEDIUM, HIGH, URGENT)
- Status tracking (TODO, IN_PROGRESS, DONE)
- Due dates
- Filtering and sorting

### Real-time Features
- Live task updates
- Instant notifications
- Online user presence
- Collaborative editing

### User Experience
- Responsive design
- Dark mode
- Keyboard shortcuts
- Toast notifications
- Loading states
- Error handling

## Customization

### Themes

Edit `tailwind.config.js` to customize colors, fonts, and styles.

### Components

All UI components are in `src/components/ui/` and can be customized or replaced.

## Using as a Standalone Frontend

This frontend is designed to work with any backend that implements the same API contract. To use with your own backend:

1. Update `NEXT_PUBLIC_API_URL` in `.env.local`
2. Ensure your backend implements the same endpoints (see API documentation)
3. Implement WebSocket support for real-time features (optional)

### API Requirements

Your backend must implement:
- POST `/api/v1/auth/register` - User registration
- POST `/api/v1/auth/login` - User login
- GET `/api/v1/users/{id}` - Get user profile
- GET `/api/v1/tasks` - List tasks
- POST `/api/v1/tasks` - Create task
- PUT `/api/v1/tasks/{id}` - Update task
- DELETE `/api/v1/tasks/{id}` - Delete task
- GET `/api/v1/notifications/user/{userId}` - Get notifications

See full API documentation in the main README.

## Deployment

### Vercel (Recommended)

```bash
npm install -g vercel
vercel
```

### Docker

```bash
docker build -t task-frontend .
docker run -p 3000:3000 task-frontend
```

### Static Export

```bash
npm run build
# Deploy the `out/` directory to any static hosting
```

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see LICENSE file for details
