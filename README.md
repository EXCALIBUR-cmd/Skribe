# Skribe

> A real-time collaborative infinite whiteboard for teams to think, sketch, and build together.

Skribe is a full-stack collaborative whiteboard application designed for real-time visual collaboration. It combines an infinite Fabric.js canvas with persistent boards, authentication, real-time collaboration through Socket.IO, multi-user presence, synchronized canvas interactions, and a modern responsive interface.

Users can create and manage boards, draw freely, add shapes and notes, use interactive canvas tools, and collaborate with other users in the same board in real time.

---

## ✨ Features

### 🎨 Infinite Whiteboard

- Infinite canvas workspace
- Freehand drawing with smooth vector strokes
- Shapes and interactive canvas objects
- Sticky notes and text elements
- Eraser with partial object erasing
- Laser pointer
- Canvas pan and zoom
- Undo / redo
- Custom drawing tools and controls

### 👥 Real-Time Collaboration

Skribe supports multiple users working on the same board simultaneously.

- Real-time board rooms using Socket.IO
- Authenticated socket connections
- Board-level authorization
- Real-time object synchronization
- Real-time freehand drawing synchronization
- Real-time eraser synchronization
- Real-time laser pointer synchronization
- Multi-user presence
- Join / leave events
- Automatic disconnect handling
- Reconnection support
- Duplicate event prevention

### 🔐 Authentication & Authorization

- User registration
- User login
- Secure logout
- JWT-based authentication
- HTTP-only authentication cookies
- Current-user authentication
- Protected routes
- Board ownership authorization
- Collaborator access control
- Google OAuth support

### 📋 Board Management

- Create boards
- Rename boards
- Delete boards
- Board ownership
- Collaborator management
- Board-specific authorization
- Persistent board canvas state

### 💾 Canvas Persistence

Canvas data is persisted to MongoDB.

- Debounced autosave
- Canvas state restoration
- Persistent board data
- Save-on-unmount handling
- Page unload persistence
- REST API based persistence

### 🖥️ Modern Interface

- Responsive whiteboard interface
- Floating navigation
- Custom toolbars
- Tool panels
- Property inspectors
- Color picker
- Stroke controls
- Animated interactions
- Responsive split-screen canvas layout

---

## 🛠️ Tech Stack

### Frontend

- React
- Vite
- Fabric.js
- Tailwind CSS
- GSAP
- Anime.js
- Socket.IO Client

### Backend

- Node.js
- Express.js
- Socket.IO
- MongoDB
- Mongoose
- JWT
- Passport.js

### Development

- JavaScript
- REST APIs
- WebSockets
- Git
- GitHub
- MongoDB Atlas

---

## 🏗️ Architecture

Skribe follows a client-server architecture with REST APIs for persistent application data and Socket.IO for real-time collaboration.

```text
                    ┌─────────────────────┐
                    │      React Client   │
                    │                     │
                    │  Fabric.js Canvas   │
                    │  Board UI           │
                    │  Auth State         │
                    └──────────┬──────────┘
                               │
                    REST API   │   Socket.IO
                               │
                ┌──────────────┴──────────────┐
                │                             │
                ▼                             ▼
       ┌─────────────────┐          ┌─────────────────┐
       │ Express Server  │          │ Socket.IO       │
       │                 │          │ Server          │
       │ REST APIs       │          │                 │
       │ Authentication  │          │ Board Rooms     │
       │ Board CRUD      │          │ Presence        │
       │ Authorization   │          │ Collaboration   │
       └────────┬────────┘          └────────┬────────┘
                │                            │
                └────────────┬───────────────┘
                             ▼
                    ┌─────────────────┐
                    │ MongoDB Atlas   │
                    │                 │
                    │ Users           │
                    │ Boards          │
                    │ Canvas State    │
                    └─────────────────┘
