# TECHNICAL INTERVIEW PRESENTATION SCRIPT - UPDATED WITH NAVIGATION
**Complete word-for-word technical interview presentation script with file paths and navigation**
**Designed for extremely fast delivery (150-200+ words per minute average, with high density in technical sections)**

---

## SECTION 1: OPENING & SYSTEM OVERVIEW [0:00-1:30]

### [TIME: 0:00]

Good morning. Today I'll walk you through TaskFlow, an enterprise-grade, multi-tenant task management system that I've built. This platform provides comprehensive task management capabilities, designed for scalability, security, and real-time collaboration within complex organizational hierarchies.

**[NAVIGATE: Open the root directory]**

The core architecture follows a strict Microservices pattern, which I chose explicitly for independent service scaling, enhanced fault isolation, and deployment independence. 

**[NAVIGATE: Show the `services/` directory structure]**

The system consists of 4 core Go microservices:
- `services/user/` - User Service
- `services/task/` - Task Service  
- `services/org/` - Organization Service
- `services/notification/` - Notification Service

**[NAVIGATE: Show the `proto/` directory]**

And 6 critical supporting layers that I'll cover today:
1. The foundational Protocol Buffer Definitions in `proto/`
2. The reusable Shared Packages in `pkg/`
3. The central API Gateway in `gateway/`
4. The persistent Database Schema in `migrations/`
5. The Frontend API Client in `frontend/src/lib/api/`
6. The Frontend Drag & Drop Kanban feature in `frontend/src/app/tasks/`

I built this entire system using a modern, performant, and type-safe technology stack. The backend utilizes Go (Golang) 1.24+ for its native concurrency and speed, leveraging gRPC for all inter-service communication via efficient binary Protocol Buffers. 

My primary persistent data store is PostgreSQL 14+, which I chose for its ACID compliance and advanced indexing capabilities like GIN indexes and JSONB support. This is complemented by Redis 7.x, serving three distinct roles: traditional caching, Pub/Sub messaging, and durable Redis Streams for guaranteed event processing. 

**[NAVIGATE: Show the `frontend/` directory]**

The frontend is a high-performance application I built with Next.js 14 App Router and TypeScript, utilizing TanStack Query for robust server state management and Zustand for client state.

### [TIME: 1:15]

The main business problem I solved is managing complex, multi-tenant collaboration data while rigorously enforcing Row-Level Security (RLS). I addressed this critical requirement by embedding the organization ID claim directly within the JWT authentication tokens and ensuring that every service query is automatically scoped by that org_id. This scalable architecture provides highly performant task processing and facilitates real-time collaboration through dedicated WebSockets and Redis-backed events.

### [TIME: 1:30]

Now that I've established the high-level architecture and technology choices, let me dive directly into the low-level contracts and communication protocols, starting with a detailed analysis of the Protocol Buffer Definitions.

---

## SECTION 2: DETAILED CODE WALKTHROUGH [1:30-5:00]

### Section 1: Protocol Buffer Definitions [TIME: 1:30]

**[NAVIGATE: Open the `proto/` directory]**

**Opening Statement:** My architectural foundation begins with the Protocol Buffer Definitions, which serve as the single source of truth for all API contracts and inter-service data modeling, located in the `/proto` directory.

**[NAVIGATE: Open `proto/user.proto`]**

**Architecture Context:** These proto files define the exact structure of all gRPC messages and services. Critically, they also contain gRPC-Gateway annotations that automatically map these internal gRPC calls into external RESTful HTTP/JSON endpoints used by the frontend.

**[NAVIGATE: Scroll to line 11-25 showing the UserService definition]**

**Core Implementation Details:** I defined four key proto files: `user.proto`, `task.proto`, `organization.proto`, and `notification.proto`. I leverage the Proto3 syntax for compactness and speed. 

**[NAVIGATE: Scroll to line 143-149 showing the UserRole enum]**

The User message is the central entity, defining fields like role (using a defined UserRole enum). This enum starts with `0 = UNSPECIFIED`, which I intentionally make invalid to force explicit role assignment, leveraging a fundamental Proto3 design constraint.

**[NAVIGATE: Scroll back to line 14-18 showing the Register RPC with google.api.http annotation]**

I utilize the `google.api.http` annotation within the service definition to map gRPC methods like `Register` into a corresponding REST endpoint, such as `POST /api/v1/auth/register`. This API Gateway Pattern allows the performance benefits of binary gRPC internally (which is 5-10x faster than JSON), while presenting a standard HTTP/JSON REST API to browser clients.

**[NAVIGATE: Scroll to line 201-208 showing the User message definition]**

**Critical Code Segments:** "Let me highlight the concept of Field Numbers. I assigned `user_id = 1` and `email = 2`. I chose this immutable field numbering because Protocol Buffers encode data by number, not by field name. I chose this approach instead of altering existing fields because changing the field number would instantly break backward compatibility for all older clients, causing severe data corruption."

**[NAVIGATE: Scroll to line 207 showing the `google.protobuf.Timestamp created_at = 6`]**

"You'll also note that I use Timestamp types (from `google/protobuf/timestamp.proto`) for fields like `created_at` instead of native strings. This ensures time data is transmitted in a standard, language-agnostic format, enforcing consistency across Go and TypeScript clients."

**Design Decisions:** I made the explicit decision to use Protocol Buffers for all backend contracts. The reason is threefold: performance via binary encoding, strict compile-time type safety, and elegant backward compatibility achieved by never changing field numbers.

**Integration Points:** The proto definitions are consumed by the API Gateway for protocol translation. They are also imported by all four Microservices which implement the defined interfaces and leverage the generated Go structs for data handling.

**Transition:** Moving from the API contract layer, let's look at the shared infrastructure that powers all my microservices, starting with the Shared Packages.

---

### Section 2: Shared Packages (Infrastructure Foundation) [TIME: 1:51]

**[NAVIGATE: Open the `pkg/` directory, showing subdirectories]**

**Opening Statement:** The `pkg/` directory houses my Shared Packages, embodying the DRY (Don't Repeat Yourself) principle by centralizing configuration, authentication, and core infrastructure across all four microservices.

**Architecture Context:** These packages provide essential, production-ready functionality like database connectivity, caching clients, and JWT token management, ensuring consistency and maintainability.

**[NAVIGATE: Open `pkg/config/config.go`]**

**Core Implementation Details:** The `pkg/config/config.go` module loads configurations like `DB_MAX_CONNS` and `JWT_SECRET` from environment variables, promoting 12-Factor App compliance.

**[NAVIGATE: Scroll to line 60-80 showing the LoadConfig function]**

See here at line 60, I load all configurations from environment variables with sensible defaults for development.

**[NAVIGATE: Open `pkg/database/postgres.go`]**

The `pkg/database/postgres.go` module manages my PostgreSQL connection using GORM, explicitly configuring connection pooling with Max Open Connections set to 100 to prevent database overload.

**[NAVIGATE: Open `pkg/cache/redis.go`]**

The `pkg/cache/redis.go` client wrapper abstracts three distinct Redis use cases: basic data caching, Pub/Sub messaging (for real-time fan-out), and durable Redis Streams (for guaranteed event processing).

**[NAVIGATE: Open `pkg/auth/password.go`]**

The `pkg/auth/password.go` utilizes the bcrypt algorithm with a Cost Factor of 10 for intentionally slow password hashing, which is my primary defense against brute-force attacks.

**[NAVIGATE: Scroll to line 7-11 showing the HashPassword function using bcrypt.GenerateFromPassword]**

**Critical Code Segments:** "In `pkg/cache/redis.go`, I differentiate between the two message queue types. Pub/Sub is used for best-effort real-time delivery where messages are lost if the consumer is offline. Redis Streams are used for durable event processing like push notifications, guaranteeing at-least-once delivery and utilizing Consumer Groups for load balancing."

"The `pkg/auth/password.go` uses `bcrypt.GenerateFromPassword`. I ensure the hashing takes approximately 100 milliseconds on a modern CPU, making it computationally expensive for attackers attempting offline brute-force attacks by increasing the cost factor to 10."

**Design Decisions:** I chose bcrypt over Argon2 primarily because Go's standard library support for bcrypt is mature. The connection pooling configuration (max 100 connections) is a key decision I made to ensure PostgreSQL stability under high load.

**Integration Points:** Every microservice consumes the configured clients via Dependency Injection. For example, the Task Service imports `pkg/cache` to publish events, and the User Service imports `pkg/auth` for JWT generation and password hashing.

**Transition:** With the infrastructure foundation established, let's see how I implemented the core identity management in the User Service.

---

### Section 3: User Service Deep Dive (Authentication & Identity) [TIME: 2:12]

**[NAVIGATE: Open `services/user/main.go`]**

**Opening Statement:** The User Service, running on port 50051, is the dedicated domain authority for all identity, authentication, user lifecycle, and organization membership management that I built.

**Architecture Context:** It manages critical security flows, including login, token generation, and the secure invite system, interacting primarily with the User and Organization data models in PostgreSQL.

**[NAVIGATE: Scroll to line 28-88 showing the main function setup]**

**Core Implementation Details:** The service uses a Dual Server Setup I implemented in `services/user/main.go`: gRPC (50051) for inter-service communication and a separate HTTP server (8080) specifically for unauthenticated flows, like AcceptInvite.

**[NAVIGATE: Open `services/user/service/user_service.go` and scroll to the Login RPC implementation]**

The Login RPC is secured using Brute-Force Protection I implemented, tracking `FailedLoginAttempts` in the `models/user.go` and locking the account after 5 consecutive failures. Upon successful login, I generate a JWT Access Token (24h validity) and a Refresh Token (7d validity), embedding the user's role and critical org_id directly into the claims.

**[NAVIGATE: Open `services/user/models/user.go`]**

For registration, I enforce multi-tenancy by using `strings.ToLower()` to normalize the email and trigger Auto-Organization Creation if the domain is new.

**Critical Code Segments:** "In the Login implementation I built, I employ Password Timing Attack Mitigation. I chose this approach by ensuring that whether the provided email is invalid or the password is wrong, the service returns the exact same generic Unauthenticated gRPC error. This prevents external actors from enumerating valid usernames based on response timing differences."

**[NAVIGATE: Open `services/user/models/invite.go`]**

"The InviteUser RPC method I implemented generates a token using `crypto/rand` for cryptographic security. Critically, only the SHA-256 hash of that token is stored in the `models/invite.go`. This hashing prevents token theft if the database is compromised."

**Design Decisions:** I utilize JWT (Stateless Authentication) for horizontal scalability and to immediately provide org_id and role claims in the request context, eliminating a database lookup on every authenticated request.

**Integration Points:** The User Service generates the tokens that the API Gateway validates using the JWT middleware. When a new user accepts an invite, the User Service interacts with the database to update the Organization Service's membership table implicitly.

**Transition:** Identity is foundational, but the core business logic resides within the Task Service, which enforces multi-tenancy and handles complex filtering.

---

### Section 4: Task Service Deep Dive (CRUD & Filtering) [TIME: 2:33]

**[NAVIGATE: Open `services/task/` directory]**

**Opening Statement:** The Task Service I built, operating on port 50052, handles the high-volume core business functions, specifically the Task CRUD operations, assignment logic, and complex multi-tenant data retrieval.

**Architecture Context:** This service relies heavily on authorization data—the trusted user_id and org_id—extracted from the JWT claims, which is essential for enforcing Row-Level Security in every database query.

**[NAVIGATE: Open `services/task/models/task.go`]**

**Core Implementation Details:** I implemented the Task model (`services/task/models/task.go`), which includes multi-tenancy keys like `OrgID` and uses the PostgreSQL Array Type (`TEXT[]`) to store task Tags. 

**[NAVIGATE: Open `services/task/service/task_service.go` and scroll to CreateTask method]**

The CreateTask RPC method I built automatically sets the OrgID based on the user's context and immediately publishes a durable event to the Redis Stream. 

**[NAVIGATE: Scroll to the ListTasks method]**

The most complex method I implemented is ListTasks, which implements dynamic query building based on complex input filters from the `ListTasksRequest`, allowing filtering by status, priority, and array containment for tags. Crucially, I implemented RBAC (Role-Based Access Control) within the query layer itself via conditional WHERE clauses.

**Critical Code Segments:** "When a user calls GetTask, the service I built checks the user's role. For a standard Member, the WHERE clause is conditionally restricted to `WHERE org_id = ? AND (assigned_to = ? OR created_by = ?)`. I chose this conditional WHERE clause approach instead of relying on pure PostgreSQL RLS policies because it provides a fail-safe layer and allows me to return a security-conscious NotFound error for unauthorized access, obscuring the data's existence."

"The CreateTask method I implemented uses the Redis client wrapper to call `PublishEvent`. This ensures the Task Service is decoupled from the Notification Service. This is vital: task creation API latency is not impacted by downstream notification processing time, promoting performance."

**Design Decisions:** I chose Offset-Based Pagination (LIMIT/OFFSET) for ListTasks. This simplifies the UI pagination controls, accepting the trade-off that it can become slow for large offsets (>10k rows) due to database scanning.

**Integration Points:** The Task Service integrates tightly with the Redis Cache Package for event publishing. It relies on the User Service and Organization Service to validate that an assignee exists and is in the correct organizational boundaries.

**Transition:** The Task Service handles work items; next, I'll examine the hierarchical structures that organize this work in the Organization Service I built.

---

### Section 5: Organization Service Deep Dive (Hierarchy & Relationships) [TIME: 2:54]

**[NAVIGATE: Open `services/org/` directory]**

**Opening Statement:** The Organization Service I built, running on port 50054, is responsible for defining and managing the complex hierarchical relationships within a tenant, including Teams, Projects, and Groups.

**Architecture Context:** This service models the relationships used for task assignment and access control, requiring robust handling of many-to-many relationships and complex database querying.

**[NAVIGATE: Open `services/org/models/organization.go`]**

**Core Implementation Details:** I manage the Team model (lines 9-22) using a `parent_team_id` self-referencing foreign key to enable hierarchical nesting (e.g., Engineering → Backend). You can see the `ParentTeamID *uuid.UUID` field that creates this hierarchical structure.

**[NAVIGATE: Scroll to line 24-36 showing the TeamMember struct]**

The TeamMember model I built uses an `is_active` boolean field combined with a database-level `UNIQUE(team_id, user_id)` constraint. This implements a soft delete pattern for membership I designed, preserving history for audit trails while ensuring a user cannot be actively added twice.

**[NAVIGATE: Scroll to line 60-72 showing the ProjectTeam struct]**

I handle the many-to-many relationship between Project and Team using the `ProjectTeam` junction table I defined, which stores the relationship with `project_id` and `team_id` foreign keys along with assignment tracking metadata.

**[NAVIGATE: Open `services/org/service/team_service.go`]**

The AddTeamMember RPC method I implemented performs critical Org Boundary Checks. Uniquely among my Go services, this service frequently utilizes the native `database/sql` package instead of GORM. This explicit choice I made provides fine-grained control over complex SQL queries involving dynamic filtering and aggregate subqueries, specifically needed for methods like ListTeams, which uses `COUNT(DISTINCT tm.id) FILTER (WHERE tm.is_active = true)` to count only active members.

**Critical Code Segments:** "In `services/org/service/team_service.go`, for ListTeams, I use raw SQL with parameterized queries (`$1`, `$2`). I chose this approach over GORM because of the required use of complex aggregate functions like `COUNT(...) FILTER` and the need for dynamic WHERE clauses, which GORM handles poorly, leading to the N+1 query problem."

**Design Decisions:** The switch I made to `database/sql` for core read paths was a necessary trade-off: increased boilerplate (manual scanning of results) versus guaranteed performance and total control over complex JOINs and aggregations.

**Integration Points:** The Organization Service provides structural IDs that are referenced by the Task Service for task assignment. It relies on the User Service to validate the existence and role of users being added as members.

**Transition:** Having covered the core business structure, let's explore how I handle the critical requirement for real-time collaboration using the Notification Service.

---

### Section 6: Notification Service Deep Dive (Real-Time & Streams) [TIME: 3:15]

**[NAVIGATE: Open `services/notification/` directory]**

**Opening Statement:** The Notification Service I built, operating on port 50053, is the engine for all real-time communication, managing WebSocket connections and durable event processing via Redis.

**Architecture Context:** This service enables instant updates (Real-Time Path) and supports guaranteed push notifications (Durable Path), essential for an event-driven system I designed.

**[NAVIGATE: Open `services/notification/service/notification_service.go`]**

**Core Implementation Details:** I expose the SubscribeToNotifications RPC method as a Bidirectional Streaming gRPC endpoint. It uses an In-Memory Subscriber Map (`map[string][]chan *NotificationEvent`) I implemented to track active connections. For scaling across multiple instances, I use a Redis Subscriber with Pattern Subscription (`PSUBSCRIBE notifications:*`).

**[NAVIGATE: Open `services/notification/main.go` and scroll to the Worker Goroutine]**

For durable notifications, a Worker Goroutine I implemented uses the Redis Stream Consumer Group Architecture. This architecture guarantees at-least-once delivery, using `XReadGroup` for blocking reads and requiring consumers to send an `XAck` (Acknowledge) command upon successful processing. Failed messages are moved to a dedicated Dead Letter Queue (DLQ) (`notifications:dlq`) for later inspection.

**[NAVIGATE: Open `gateway/websocket/hub.go`]**

**Critical Code Segments:** "The WebSocket Hub I built (`gateway/websocket/hub.go`) runs a Single-Threaded Goroutine. All operations—registering, unregistering, broadcasting—flow through channels. I chose this Concurrency Pattern to eliminate race conditions entirely, treating the hub state as non-shareable mutable data accessed sequentially."

**[NAVIGATE: Open `gateway/websocket/client.go`]**

"The Client implementation I built in `gateway/websocket/client.go` includes a Heartbeat Mechanism. The server sends a ping every 54 seconds (9/10 of pongWait), and if the client does not respond within 60 seconds, the connection is automatically closed. This prevents dead connections from lingering and consuming resources."

**Design Decisions:** I implemented two parallel notification paths: Redis Pub/Sub for immediate, best-effort real-time delivery, and Redis Streams for durable, guaranteed delivery. The use of Consumer Groups is critical for horizontal scaling of workers while ensuring no message is processed by more than one worker.

**Integration Points:** The Notification Service receives events from the Task Service (via Redis Streams/Pub/Sub). It relies on the Device Model (`services/notification/models/device.go`) to track tokens for FCM and APNs push notification providers.

**Transition:** All these microservices are shielded and exposed to the outside world through my standardized API Gateway.

---

### Section 7: API Gateway Implementation [TIME: 3:36]

**[NAVIGATE: Open `gateway/main.go`]**

**Opening Statement:** The API Gateway I built, operating on port 8080, serves as the unified entry point for all client traffic, managing cross-cutting concerns like authentication, rate limiting, and protocol translation.

**Architecture Context:** It uses the gRPC-Gateway to transcode HTTP/JSON requests into gRPC calls and manages the crucial middleware chain before requests are forwarded to internal microservices.

**[NAVIGATE: Scroll to line 28-88 showing the main function and middleware setup]**

**Core Implementation Details:** The gateway's `gateway/main.go` sets up the middleware chain I designed. The JWT Authentication Middleware is central: it validates the token, extracts the user_id, role, and org_id claims, and injects them into the request context and as `X-User-Id` and `X-Org-Id` HTTP headers.

**[NAVIGATE: Open `gateway/middleware/ratelimit.go`]**

The Rate Limiting Middleware I implemented uses the Token Bucket Algorithm. It is configured with a rate of 100 requests per second and a burst size of 10, allowing stability while tolerating small bursts. 

**[NAVIGATE: Scroll back to `gateway/main.go` to the WebSocket handler section]**

For WebSockets, since headers cannot be set, I extract the JWT token from the URL query parameter (`?token=...`) and validate it prior to upgrading the connection.

**[NAVIGATE: Scroll to line 70-108 showing the runtime.NewServeMux configuration]**

**Critical Code Segments:** "In the gRPC-Gateway setup I built, I use a custom Metadata Function. I implemented this to ensure that identity headers set by the JWT middleware (like `X-User-Id`) are successfully converted into two gRPC metadata keys (`user-id` and `user_id`). I chose to set both because gRPC metadata is automatically lower-cased and hyphenated, ensuring cross-language compatibility."

**[NAVIGATE: Scroll to the CORS handler section in `gateway/main.go`]**

"The CORS configuration I implemented dynamically echoes the request Origin back in the `Access-Control-Allow-Origin` header. I chose this dynamic approach instead of a simple wildcard (`*`) because the frontend requires `Access-Control-Allow-Credentials: true` to handle tokens, which is incompatible with the wildcard origin setting."

**Design Decisions:** Centralizing JWT validation here simplifies backend services. I chose the Token Bucket Algorithm because it allows controlled bursts, offering a better user experience than the strict smoothing provided by a Leaky Bucket algorithm.

**Transition:** The Gateway relies entirely on the correctness of the data structure, so let's analyze the Database Schema and Integrity next.

---

### Section 8: Database Schema & Integrity [TIME: 3:57]

**[NAVIGATE: Open the `migrations/` directory]**

**Opening Statement:** My data persistence layer uses PostgreSQL 14+, defined in the `migrations/` directory, which I chose for its ACID compliance, JSONB support, and robust indexing capabilities.

**Architecture Context:** The schema I designed defines all entities and is responsible for enforcing referential integrity through Foreign Key relationships and the fundamental multi-tenancy isolation.

**[NAVIGATE: Open `migrations/000_base_schema.sql`]**

**Core Implementation Details:** All primary entities (organizations, users, tasks, teams) utilize UUID Primary Keys, generated via `gen_random_uuid()`. 

**[NAVIGATE: Scroll to the users table definition showing the JSONB columns]**

I use the JSONB data type for storing flexible data like SecurityQuestions in the users table and Settings in the organizations table. 

**[NAVIGATE: Scroll to the tasks table definition showing the TEXT[] tags column]**

The tasks table I designed uses the PostgreSQL Array Type (`TEXT[]`) to store multiple tags efficiently. 

**[NAVIGATE: Scroll to the foreign key constraints section]**

I employ different Foreign Key deletion strategies. Deleting an Organization uses `ON DELETE CASCADE` to automatically delete all associated Teams and Projects. However, deleting a User uses `ON DELETE SET NULL` for foreign keys like `tasks.assigned_to`. This preserves the task history and audit trail.

**[NAVIGATE: Scroll to the team_members table definition]**

**Critical Code Segments:** "In the Team Members table definition I created, I implement a Composite Unique Constraint on `UNIQUE(team_id, user_id)`. I chose this approach to prevent a user from being actively added to the same team twice, enforcing crucial data consistency for membership tracking."

**[NAVIGATE: Scroll to the projects table showing CHECK constraints]**

"I enforce data integrity using CHECK Constraints, such as `CHECK (progress >= 0 AND progress <= 100)` on the projects table. Violating this constraint throws an immediate database error, preventing invalid business data from entering the system."

**Design Decisions:** The mixed use of CASCADE (for hierarchical cleanup) and SET NULL (for preserving history) is deliberate. I chose UUIDs over auto-increment integers primarily for security (non-guessable IDs) and distributed ID generation.

**Integration Points:** The schema supports the Organization Service's hierarchical structures (teams referencing teams) and enforces multi-tenancy by including the org_id foreign key on virtually every application table.

**Transition:** Let's pivot to the client side and examine how the frontend application I built ensures a seamless user experience, starting with the API Client Architecture.

---

### Section 9: Frontend API Client (Axios Interceptors) [TIME: 4:18]

**[NAVIGATE: Open `frontend/src/lib/api/client.ts`]**

**Opening Statement:** The Frontend API Client Architecture I built is centered around the `frontend/src/lib/api/client.ts` file, utilizing Axios Interceptors to manage authentication, token refreshing, and server state synchronization.

**Architecture Context:** This module bridges the high-performance Next.js 14 application with our REST API endpoints exposed by the API Gateway, handling the complexity of the JWT token lifecycle transparently to the component layer.

**[NAVIGATE: Scroll to line 10-40 showing the APIClient class definition and request interceptor]**

**Core Implementation Details:** I define two critical interceptors. The Request Interceptor I built automatically reads the latest access token from the Zustand client store on every outgoing request and injects it as the `Authorization: Bearer <token>` header.

**[NAVIGATE: Scroll to line 50-120 showing the response interceptor]**

The Response Interceptor is the core of my Automatic Token Refresh Strategy. It specifically watches for a 401 Unauthorized error response. When a 401 is caught, it triggers a separate call to the refresh endpoint. Crucially, I use a global `refreshPromise` variable to implement Refresh Deduplication. If multiple components fail simultaneously, only one refresh request is executed, and all waiting requests retry with the single new token, avoiding the "thundering herd" problem.

**Critical Code Segments:** "In the responseInterceptor I implemented, when I successfully get a new token pair, I call `retryOriginalRequest`. This retry mechanism ensures the user experience is seamless; the original failed API call is automatically re-executed with the new token, allowing the application logic to proceed without ever seeing the 401 error."

**[NAVIGATE: Scroll to the refreshPromise logic section]**

"The usage of a dedicated `refreshPromise` I implemented ensures that the Refresh Deduplication logic is executed correctly. I chose this Promise-based synchronization instead of a simple lock/boolean because promises inherently handle the asynchronous waiting and resolution across multiple concurrent requests gracefully."

**Design Decisions:** I chose Axios with Interceptors specifically to abstract the complexity of token management. This allows application components to focus solely on data fetching using TanStack Query hooks (`useQuery`), treating data fetching as a simple promise without worrying about expiry or refreshing logic.

**[NAVIGATE: Open `frontend/src/lib/api/index.ts`]**

**Integration Points:** The client I built works directly with Zustand (for storing tokens securely) and TanStack Query. It communicates exclusively with the API Gateway.

**Transition:** The API client handles state synchronization, but how is that data presented and manipulated in the UI? Let's examine the dynamic Drag and Drop Kanban Board I built.

---

### Section 10: Frontend Drag & Drop Kanban (UI/UX) [TIME: 4:39]

**[NAVIGATE: Open `frontend/src/app/tasks/page.tsx`]**

**Opening Statement:** The core interaction feature of the platform is the Drag and Drop Kanban Board I implemented using the modern, accessible @dnd-kit library.

**Architecture Context:** This feature demonstrates advanced Client Component capabilities, managing local drag state, triggering server-state mutations, and leveraging Optimistic Updates to provide instant feedback.

**[NAVIGATE: Scroll to line 496-526 showing the DndContext setup]**

**Core Implementation Details:** The board I built is structured around the primary `<DndContext>` provider, multiple `<DroppableColumn>` components (representing statuses like 'TODO' or 'DONE'), and nested `<SortableTaskCard>` components using the `useSortable` hook.

**[NAVIGATE: Scroll to the handleDragEnd function]**

The entire drag process is orchestrated by the `onDragEnd` handler I implemented. When a drag ends, this handler calculates the new status and immediately triggers a TanStack Query mutation. This mutation is accompanied by an Optimistic Update: the UI instantly renders the task in its new column before the server confirms the change.

**[NAVIGATE: Scroll to line 6 showing the PointerSensor import and configuration]**

The setup I created utilizes the `PointerSensor` configured to require an 8-pixel movement before initiating a drag, preventing accidental drags during clicks or scrolls.

**[NAVIGATE: Open `frontend/src/components/tasks/sortable-task-card.tsx`]**

**Critical Code Segments:** "In the `onDragEnd` handler I built, before calling the API, I define the `onMutate` function, which is the heart of the Optimistic Update. I chose this technique to ensure that when a user drops a task, the UI updates instantly, providing zero perceived latency, which significantly improves the user experience."

**[NAVIGATE: Go back to `frontend/src/app/tasks/page.tsx` and scroll to the DragOverlay component]**

"The component uses the `<DragOverlay>` component. I chose this mechanism because it renders a semi-transparent ghost of the dragged item outside the normal DOM flow, ensuring the dragging animation is smooth and performs well, avoiding layout thrashing during the operation."

**Design Decisions:** I chose @dnd-kit over legacy libraries because it is actively maintained, built on modern React principles (like Context), and offers better performance and built-in accessibility features. The use of TanStack Query for mutations ties the optimistic updates directly into the server state management lifecycle.

**Edge Cases & Error Handling:** If the API mutation triggered by `onDragEnd` fails (e.g., due to a concurrent update or network timeout), the Optimistic Update I implemented automatically rolls back the UI state. The task snaps back to its original column, and a toast notification (Sonner library) is displayed to the user.

### [TIME: 5:00]

**Transition:** That completes the detailed walkthrough of the 10 components I built. I have successfully covered everything from the core data contract to the frontend user experience. Now, let's transition into three Technical Deep Dives focused on the most complex engineering challenges I solved.

---

## SECTION 3: TECHNICAL DEEP DIVES [5:00-8:30]

### Deep Dive 1: Automatic JWT Refresh and Deduplication [TIME: 5:00]

**[NAVIGATE: Open `frontend/src/lib/api/client.ts` and scroll to the response interceptor]**

The challenge I faced was ensuring a seamless, non-blocking authentication experience despite short-lived JWT access tokens (24 hours). If multiple simultaneous API calls fail due to an expired token, I must handle the refresh efficiently without making redundant calls or interrupting the user.

**Complex Logic (The Response Interceptor I Implemented):**

**[NAVIGATE: Scroll to line 50-65 showing the 401 detection logic]**

1. **401 Detection:** The `axiosClient.interceptors.response.use(...)` function I set up specifically catches HTTP 401 Unauthorized errors.

**[NAVIGATE: Scroll to line 68-75 showing the refreshPromise check]**

2. **Refresh Check:** Upon catching the 401, the system first checks the global `refreshPromise` variable. If `refreshPromise` is null, the current request initiates the refresh process I designed.

3. **Deduplication:** If `refreshPromise` is active, the failing request is pushed into the promise queue to wait for the ongoing refresh to complete. This is the Deduplication Strategy I implemented, preventing the "thundering herd" where multiple components flood the server with refresh requests.

**[NAVIGATE: Scroll to line 80-95 showing the refresh token call]**

4. **Token Refresh Call:** The initiating request calls the `/api/v1/auth/refresh` endpoint using the long-lived refresh token stored in Zustand.

5. **Token Update & Resolution:** If the refresh succeeds, the new access and refresh tokens are stored, and `refreshPromise` is resolved.

**[NAVIGATE: Scroll to line 100-110 showing the retryOriginalRequest function]**

6. **Retry:** All pending requests (including the initiator) then execute the `retryOriginalRequest` function I created, which uses the new token to resend the original API call.

**Algorithm Complexity Analysis:** If $N$ simultaneous requests fail, this approach I designed ensures only $O(1)$ refresh call, followed by $O(N)$ retries. This significantly reduces load on the User Service's token validation endpoint compared to $O(N)$ redundant refresh calls.

**Why This Was Challenging:** The difficulty I faced was reliably synchronizing asynchronous, concurrent requests (promises) originating from multiple React components while ensuring the original request configuration (headers, method, payload) is perfectly preserved for the retry.

**Performance Considerations:** Queuing requests via the `refreshPromise` I implemented ensures the costly refresh operation (which requires database lookup/validation of the refresh token) happens only once per expiry window, drastically minimizing API latency for the client after the first failure.

**Alternatives Considered and Rejected:** I rejected using a simple timeout lock because a promise inherently handles the waiting and resolution across all listeners elegantly. I rejected using session cookies as they sacrifice the horizontal scalability benefits inherent to stateless JWT authentication.

---

### Deep Dive 2: Redis Streams Consumer Group Architecture [TIME: 6:00]

**[NAVIGATE: Open `services/notification/main.go` and scroll to the Worker Goroutine]**

This deep dive covers the Durable Path of the Notification Service I built, specifically how I use Redis Streams to achieve at-least-once delivery and fault tolerance for critical events like push notifications and audit logging.

**Complex Logic (The Worker Goroutine I Implemented):**

**[NAVIGATE: Scroll to the initialization section]**

1. **Initialization:** The Worker Goroutine I created in `services/notification/main.go` starts by creating a Consumer Group (`notifications:workers`) if it doesn't exist, attached to the Redis Stream (`notifications:stream`).

**[NAVIGATE: Scroll to the XReadGroup section]**

2. **Blocking Read:** The worker executes a blocking read using the `XReadGroup` command. This command reads new messages, specifically looking for messages belonging to its consumer ID (hostname-pid). This prevents busy polling.

**[NAVIGATE: Scroll to the message processing section]**

3. **Message Processing & Acknowledgment:** When a message is received (e.g., `task_assigned`), the worker I built processes the event (e.g., calling the FCM Provider). If successful, the worker sends an `XAck` command back to Redis. This moves the message from the Pending Entries List (PEL), guaranteeing it won't be re-delivered.

4. **Fault Handling (PEL & XCLAIM):** If the worker crashes before sending the `XAck`, the message remains in the PEL. Another consumer in the group can `XCLAIM` and retry the pending message after a timeout, achieving the at-least-once delivery guarantee.

**[NAVIGATE: Scroll to the error handling section in `services/notification/main.go`]**

5. **Dead Letter Queue (DLQ):** If a message fails repeatedly (e.g., due to malformed data), the error handling logic I implemented moves it to a dedicated Dead Letter Queue (`notifications:dlq`).

**Algorithm Complexity Analysis:** The core `XReadGroup` operation offers approximately $O(1)$ amortized complexity, as it only reads new entries at the tail or from the typically small PEL. This efficiency is key for high-throughput queues.

**Why This Was Challenging:** Implementing distributed concurrency with guaranteed delivery required precise handling of the Consumer Group lifecycle and the complex XACK/XCLAIM logic across multiple service instances to ensure load balancing without losing critical events.

**Performance Considerations:** Using Redis Streams with Consumer Groups is essential for horizontal scaling. Adding more worker Goroutines or Notification Service instances automatically distributes the message load, ensuring push notification capacity scales linearly with event traffic.

**Alternatives Considered and Rejected:** I rejected standard Redis Pub/Sub because it is fire-and-forget and lacks durability, meaning offline users would miss notifications entirely. I opted for Redis Streams over a full message broker like Kafka initially to minimize operational overhead while achieving the required durability and Consumer Group semantics.

---

### Deep Dive 3: Multi-Tenant and RBAC Query Scoping [TIME: 7:15]

**[NAVIGATE: Open `gateway/middleware/auth.go`]**

The core security requirement is Multi-Tenancy Isolation, ensuring a user can never access data outside their organization, complemented by Role-Based Access Control (RBAC). I solved this by embedding authorization logic directly into the database queries in services like the Task Service.

**Complex Logic (Task Service's ListTasks implementation I built):**

**[NAVIGATE: Scroll to the JWT extraction and validation logic]**

1. **Authorization Extraction:** The process begins in the API Gateway middleware I built, which validates the JWT and extracts the mandatory org_id and role claims, injecting them into the request context and as `X-User-Id` and `X-Org-Id` HTTP headers.

**[NAVIGATE: Open `services/task/service/task_service.go` and scroll to the ListTasks method]**

2. **Query Initialization (Isolation):** In the Task Service's ListTasks method I implemented, the code starts with the base query: `db.Where("org_id = ?", orgID)`. This line enforces the primary multi-tenancy boundary I designed, ensuring all queries are scoped to the user's organization.

**[NAVIGATE: Scroll to the RBAC conditional logic section]**

3. **RBAC Conditional Filters:** Next, the code applies the role-based filter I implemented based on the extracted role:
   * **If the user is an Org Admin:** No further WHERE clauses regarding assignment are added; the admin is allowed to see ALL tasks within their scoped org_id.
   * **If the user is a Member:** The code dynamically adds a complex OR condition I designed: `AND (assigned_to = userID OR created_by = userID)`. This restricts the view to only tasks they are directly responsible for or created themselves.

**[NAVIGATE: Scroll to the error handling section]**

4. **Security Obfuscation:** If a user attempts to access a task outside their organization, the service I built returns a generic `NotFound` gRPC error instead of `PermissionDenied`. This prevents unauthorized users from confirming the existence of data they shouldn't access.

**[NAVIGATE: Open `migrations/000_base_schema.sql` and scroll to the indexes section]**

**Algorithm Complexity Analysis:** Query efficiency is dependent on database indexing. By ensuring that the `org_id` is the first column in almost every composite index I created (e.g., `idx_tasks_org_id_status`), the database can use an efficient index scan to filter the global dataset down to the single tenant's data first, making the remaining complexity $O(\log N_{\text{org}})$, where $N_{\text{org}}$ is the organization size, not the total database size.

**Why This Was Challenging:** The difficulty I faced was defining the conditional query generation dynamically based on role and ensuring that the org_id is never trusted from the user input, but always extracted directly from the validated, immutable JWT claims.

**Performance Considerations:** The composite indexing strategy I implemented is vital. Without it, forcing multi-tenant isolation on massive datasets would result in full table scans, destroying performance under load.

**Alternatives Considered and Rejected:** I considered using PostgreSQL's native Row-Level Security (RLS) policies. I rejected relying solely on RLS because it complicates testing, makes database migrations harder, and prevents me from returning the security-focused ambiguous NotFound error.

### [TIME: 8:15]

**Concluding Thought Metaphor:** Think of my architecture as a high-security bank vault. The API Gateway is the security checkpoint, verifying your ID (JWT). The Task Service is the vault itself. The Protocol Buffers are the standardized blueprints. But the true security isn't just at the door; it's the Multi-Tenancy Query Scoping I implemented inside, which acts like a personalized key, ensuring that even if you pass the checkpoint, your key only fits the safety deposit box that contains your organization's data, and nothing else.

### [TIME: 8:30]

---

## SECTION 4: SYSTEM INTEGRATION & DATA FLOW [8:30-9:00]

**[NAVIGATE: Open a diagram or prepare to draw the flow]**

**Exact Narration:** "Now let me show you how everything connects by tracing the Create Task request lifecycle. [PAUSE]

**[NAVIGATE: Point to `gateway/main.go`]**

When an authenticated client request comes in via the frontend I built, it first hits the API Gateway on port 8080. 

**[NAVIGATE: Open `gateway/middleware/auth.go`]**

The request immediately enters the middleware chain I designed where the JWT Authentication Middleware validates the access token, extracts the trusted user_id and mandatory org_id claims, and injects them as gRPC metadata. 

**[NAVIGATE: Point to the gRPC-Gateway configuration in `gateway/main.go`]**

The gRPC-Gateway then translates the HTTP/JSON request into an efficient binary gRPC call using Protocol Buffers.

**[NAVIGATE: Open `services/task/service/task_service.go`]**

This binary call is forwarded to the Task Service on port 50052. The Task Service extracts the trusted identity from the gRPC metadata. It performs validation, including the Org Boundary Check I implemented, and then persists the new task into PostgreSQL, with the query explicitly scoped by the trusted org_id.

**[NAVIGATE: Scroll to the event publishing section]**

The successful database write then triggers the crucial event flow I designed. The Task Service, acting as a producer, publishes a durable event payload (e.g., `task_created`) to the Redis Stream. 

**[NAVIGATE: Open `services/notification/main.go`]**

This event is asynchronously consumed by the Notification Service Worker Goroutine I built via the Consumer Group. The worker processes the event for durability (saving history to the database) and simultaneously publishes a real-time message via Redis Pub/Sub.

**[NAVIGATE: Open `gateway/websocket/hub.go`]**

This Pub/Sub message is received by all running Notification Service instances, which then broadcast the update through the internal WebSocket Hub I implemented. 

**[NAVIGATE: Open `frontend/src/app/tasks/page.tsx`]**

Finally, the Frontend application receives the real-time message, triggering a TanStack Query invalidation which instantly refreshes the Kanban board I built with the new task, completing the high-performance, event-driven cycle."

---

## SECTION 5: KEY TECHNICAL ACHIEVEMENTS [9:00-9:30]

**Exact Narration:** "Let me highlight the key technical achievements I've accomplished that showcase the system's robustness:

**First, End-to-End Multi-Tenancy and RBAC Enforcement.** Every major database table I designed includes the org_id foreign key. I enforce isolation by injecting the org_id from the stateless JWT claim directly into every database query via the API Gateway middleware I built, implementing Row-Level Security in the application layer.

**Second, the design of my High-Performance RPC/REST Hybrid Architecture.** I utilize Go and gRPC with Protocol Buffers for fast, type-safe binary communication between microservices, achieving 5-10x faster serialization than JSON. I seamlessly expose this internal RPC interface as a standard REST API using the gRPC-Gateway.

**Third, I engineered a Robust Asynchronous Eventing System using Redis Streams and Consumer Groups.** This provides at-least-once message delivery for critical events, leveraging `XReadGroup` and `XAck` commands for fault tolerance and horizontal scaling of notification workers.

**Fourth, the Automatic JWT Token Refresh and Deduplication Strategy I built.** My Axios response interceptor automatically catches 401 errors and, using a global `refreshPromise`, ensures only one token refresh request is ever executed for simultaneous failures, eliminating the "thundering herd" problem.

**Fifth, the implementation of Advanced PostgreSQL Data Modeling.** This includes self-referencing foreign keys for hierarchical teams, the use of the `TEXT[]` array type and GIN Indexes for task tags, and a careful mix of `ON DELETE CASCADE` and `ON DELETE SET NULL` constraints I chose to balance cleanup and audit trail preservation.

**Sixth, the development of the Intelligent Search Parser.** This feature I built allows users to construct complex queries using natural language syntax like `status:IN_PROGRESS`, `@user`, and `#urgent`, simplifying the UI while maximizing server-side filtering capability."

---

## SECTION 6: SCALABILITY & PERFORMANCE [9:30-9:45]

**[NAVIGATE: Open `deployments/k8s/` directory]**

**Exact Talking Points:** "Regarding scalability, the system I designed is fundamentally built for horizontal scaling, achieved through my Microservices Architecture and Kubernetes Deployment Strategy.

**[NAVIGATE: Open `deployments/k8s/hpa.yaml`]**

The architecture allows for flexible scaling: the Task Service is configured to handle the highest read/write traffic load, scaling up to 5-10 replicas using Horizontal Pod Autoscaling (HPA) I configured based on CPU utilization. The User Service typically maintains 3-5 replicas.

**[NAVIGATE: Open `pkg/database/postgres.go`]**

I implemented database connection pooling in all Go services, limiting Max Open Connections to 100 per instance to prevent database resource starvation.

**[NAVIGATE: Open `pkg/cache/redis.go`]**

For performance, I use a multi-layer Redis caching strategy for user profiles and session data, and rely on Go's native Goroutines for high-concurrency, non-blocking network I/O.

**[NAVIGATE: Open `migrations/000_base_schema.sql` and scroll to indexes]**

For example, the composite indexing strategy I implemented on frequently queried columns, prefixed by org_id (e.g., `(org_id, assigned_to, status)`), ensures that complex list queries remain performant, regardless of the total number of tasks in the platform."

---

## SECTION 7: TESTING & QUALITY ASSURANCE [9:45-10:00]

**[NAVIGATE: Open `scripts/test.sh`]**

**Exact Talking Points:** "For testing, I implemented a comprehensive three-tiered testing strategy. This includes focused unit tests for individual Go functions and frontend components, integration tests to verify communication between microservices (e.g., Gateway JWT validation against the User Service), and end-to-end (E2E) tests covering critical user flows.

**[NAVIGATE: Show test files in `services/user/service/`]**

I used the standard Go testing framework for the backend, complemented by Jest and React Testing Library for the frontend. 

For example, a key security integration test I wrote validates the Brute-Force Protection in the User Service. The test case confirms that the Login RPC fails with an Unauthenticated status, the `failed_login_attempts` counter increments in the database, and the account is locked after exactly 5 failures. 

Another critical scenario I tested covers the Invite System Security, ensuring that if a user provides an invalid invite token, the system correctly returns an error because the input hash does not match the SHA-256 hash stored in the invites table."

---

## SECTION 8: DEPLOYMENT & DEVOPS [10:00-10:15]

**[NAVIGATE: Open `deployments/docker/` directory]**

**Exact Talking Points:** "The deployment strategy I designed uses containerization via Docker and orchestration via Kubernetes. 

**[NAVIGATE: Open `deployments/docker/Dockerfile.gateway`]**

I utilized Docker multi-stage builds to minimize image size and exclude unnecessary build dependencies from the final runtime images.

**[NAVIGATE: Open `deployments/k8s/` directory]**

I set up the production environment entirely managed by Kubernetes (K8s). This includes K8s manifests I created defining deployments, services (ClusterIP for internal, LoadBalancer for external), and essential security resources like Kubernetes Secrets for managing sensitive credentials, specifically the `JWT_SECRET`. 

**[NAVIGATE: Open `.github/workflows/` if exists or mention CI/CD]**

The CI/CD pipeline I configured ensures that successful tests automatically trigger a push to our container registry, followed by a rolling update deployment using `kubectl apply` to minimize downtime.

The infrastructure includes an internal Nginx layer I set up serving as a Load Balancer to distribute traffic evenly across multiple API Gateway replicas.

**[NAVIGATE: Open `deployments/monitoring/prometheus.yml`]**

For monitoring and observability, I implemented a stack using Prometheus for metrics collection and Grafana for visualization. 

**[NAVIGATE: Open `pkg/metrics/`]**

Every Go microservice exposes custom metrics I defined via the `pkg/metrics` package. Key metrics I monitor include `http_request_duration_seconds` (a histogram for P95 latency tracking), `db_connections_open`, and the `redis_hits_total` counter. All application logging utilizes Zap for structured, high-performance JSON output, making it easily ingestible by a centralized log aggregation system like the ELK stack."

---

## SECTION 9: CHALLENGES & SOLUTIONS [10:15-10:30]

**Exact Narration:** "The biggest challenge I faced was guaranteeing complete Multi-Tenant Data Isolation and Row-Level Security (RLS) in a performant, distributed microservices environment. The issue was needing a scalable way to filter potentially billions of records by organization ID securely, without relying solely on slow database RLS policies.

**[NAVIGATE: Open `gateway/middleware/auth.go`]**

I solved this by enforcing RLS in the application layer, controlled entirely by the trusted JWT claim. The API Gateway I built validates the token and injects the mandatory org_id into the gRPC metadata. 

**[NAVIGATE: Open `services/task/service/task_service.go`]**

Every subsequent database query in the Task Service and Organization Service I implemented is prepended with `WHERE org_id = ?`, automatically scoping the data. 

**[NAVIGATE: Open `migrations/000_base_schema.sql` and scroll to indexes]**

This solution improved query performance dramatically, as all critical database indexes I created are composite indexes prefixed by org_id, allowing fast index scans.

---

A second major challenge I faced was achieving guaranteed, at-least-once durable event delivery for critical actions like sending push notifications when a task status changes. Simple Pub/Sub is unreliable for persistence.

**[NAVIGATE: Open `services/notification/main.go`]**

I solved this by leveraging Redis Streams with the Consumer Group Architecture I implemented. The Task Service publishes events to the stream, and the Notification Service workers I built consume them using `XReadGroup` and `XAck`. This provides load balancing across multiple workers and guarantees that if a worker crashes, the unacknowledged message remains in the Pending Entries List and is retried, ensuring the event is eventually processed.

---

A third challenge I faced was ensuring the frontend's seamless authentication lifecycle despite short-lived JWT access tokens. If tokens expire simultaneously, we face the "thundering herd" problem on the refresh endpoint.

**[NAVIGATE: Open `frontend/src/lib/api/client.ts`]**

I solved this using the Refresh Deduplication pattern I implemented in the Axios Response Interceptor. When the first 401 is detected, it initiates the refresh and sets a global `refreshPromise`. All subsequent 401 errors are instructed to wait for this single promise to resolve. Once the new token is acquired, all waiting requests are automatically retried. This solution completely eliminated redundant refresh calls, ensuring a zero-perceived-latency experience for the user and significantly reducing stress on the User Service."

---

## SECTION 10: FUTURE IMPROVEMENTS & TRADE-OFFS [10:30-10:45]

**Exact Talking Points:** "If I were to extend this, I would focus on three specific technical improvements:

**First, I would implement Cursor-Based Pagination for the ListTasks RPC.** Currently, I use offset-based pagination (`LIMIT/OFFSET`), which is simple but becomes slow for deep paging on large tables. Cursor pagination, using `WHERE ID > [last_id]`, would ensure faster and more consistent performance regardless of data size, effectively supporting true infinite scroll.

**Second, I would migrate the complex Intelligent Search System to a dedicated Search Microservice utilizing Elasticsearch or OpenSearch.** Currently, complex filters like tag containment I implemented use PostgreSQL GIN indexes. Offloading this to a dedicated inverted index would provide faster, more scalable full-text search capabilities and drastically reduce the load on the primary PostgreSQL cluster.

**Third, to enhance long-term security, I would upgrade my password hashing from bcrypt (cost 10) to the modern, memory-hard algorithm Argon2.** Argon2 is specifically designed to resist hardware-accelerated attacks (ASICs and GPUs), providing superior protection against brute-force attacks in the future.

[PAUSE]

Currently, the main trade-offs that guided my design include:

**One major trade-off is the use of stateless JWTs.** This provides superior horizontal scalability. However, the drawback is that immediate token revocation—for instance, forcing a user logout—requires implementing a relatively resource-intensive JWT Blacklisting mechanism across all services, or waiting for the short access token (24h) to expire.

**Another trade-off is the use of UUID Primary Keys over auto-increment integers.** I chose UUIDs for security and distribution readiness. The technical cost is increased storage (16 bytes vs 4 bytes) and potential index fragmentation due to the random nature of UUID generation, which can impact write performance."

---

## SECTION 11: Q&A PREPARATION [10:45-11:00]

### Q: How do you handle database migration safety, especially for large tables, and why did you mix CASCADE and SET NULL deletion strategies?

**[NAVIGATE: Open `migrations/` directory]**

**A:** My migration strategy utilizes versioned SQL files and relies on a dedicated library like golang-migrate for execution, ensuring all migrations are transaction-wrapped for atomicity. To ensure safety and backward compatibility for large tables, I follow the principle of additive changes: when adding a new required column, I first add it as nullable, then run a data backfill script, and only then add the NOT NULL constraint. This prevents downtime. 

[PAUSE] 

**[NAVIGATE: Open `migrations/000_base_schema.sql` and scroll to foreign key definitions]**

Regarding deletion strategies, the choice between `ON DELETE CASCADE` and `ON DELETE SET NULL` is a deliberate design decision I made based on referential integrity and audit trail requirements. I use CASCADE for hierarchical relationships—deleting an Organization automatically removes all associated Teams—preventing orphaned records. Conversely, I use SET NULL when deleting the parent should preserve the child record's history. For instance, deleting a User sets their id to NULL in the `tasks.assigned_to` column, ensuring the task work history and audit trail are maintained.

---

### Q: Explain the WebSocket Heartbeat Mechanism in detail, including the specific timings and the handling of slow consumers.

**[NAVIGATE: Open `gateway/websocket/client.go`]**

**A:** The WebSocket connection requires a robust Heartbeat Mechanism I implemented to actively detect and clean up dead or unresponsive connections, preventing resource leakage. The logic is implemented in the `gateway/websocket/client.go`'s read and write pumps. 

**[NAVIGATE: Scroll to the ping/pong section]**

The server sends a periodic ping message to the client every 54 seconds (pingPeriod = 9/10 of pongWait). If the client fails to respond with a pong frame within the defined pongWait period of 60 seconds, the server automatically closes the connection and unregisters the client from the Hub. 

[PAUSE] 

**[NAVIGATE: Scroll to the write pump section]**

More critically, the Write Pump I implemented uses a non-blocking send to the client's internal channel buffer. If a client is on a poor network and cannot consume messages as fast as the server produces them (causing the internal channel to fill up), the system I built proactively closes the connection. This defense mechanism against a slow consumer is vital because it ensures that one misbehaving client cannot block the central WebSocket Hub Goroutine, thereby protecting the performance and responsiveness of all other active users.

---

### Q: You use gRPC for inter-service communication. How is data transmitted, and what security measures are in place since gRPC primarily uses HTTP/2?

**[NAVIGATE: Open `proto/user.proto`]**

**A:** gRPC is chosen for its performance, leveraging HTTP/2 for multiplexing and connection efficiency. Data transmission relies entirely on Protocol Buffers (Proto3 syntax), which serializes data into a compact binary format—approximately 60% smaller than JSON—resulting in significantly faster serialization/deserialization speeds. The use of generated Go and TypeScript structs ensures strong, compile-time type safety. 

[PAUSE] 

**[NAVIGATE: Open `gateway/middleware/auth.go`]**

Regarding security, while services communicate over HTTP/2, I enforce secure external communication by requiring TLS/SSL for all traffic to the API Gateway. Internally, the most critical security measure is authentication via the JWT token. The token is validated once at the API Gateway I built and passed to backend services as gRPC metadata (e.g., `user-id` and `org-id` keys). Services then extract the trusted identity from this metadata, ensuring the client cannot tamper with the authorization identity once it passes the secured gateway.

---

### Q: Detail your caching strategy using Redis, explaining the specific roles of Caching, Pub/Sub, and Streams within the pkg/cache package.

**[NAVIGATE: Open `pkg/cache/redis.go`]**

**A:** My `pkg/cache/redis.go` wrapper centralizes Redis access and manages three distinct roles I designed.

1. **Basic Caching:** This provides simple key-value storage for non-critical, frequently accessed data like user profiles. This layer utilizes standard Redis commands and greatly reduces read load on PostgreSQL.

2. **Pub/Sub Messaging:** This is used exclusively for the Real-Time Notification Path. It is a fire-and-forget mechanism I implemented, offering at-most-once delivery for instant fan-out to online WebSocket clients. It uses Pattern Subscription (`PSUBSCRIBE notifications:*`) to allow multiple Notification Service instances to receive broadcast events.

**[NAVIGATE: Open `services/notification/main.go`]**

3. **Redis Streams:** This is used for the Durable Event Processing Path I built. Streams provide a persistent event log, at-least-once delivery, and support Consumer Groups for fault-tolerant, load-balanced consumption. This is critical for guaranteed events, such as processing a task event to reliably send a mobile push notification, ensuring the message is retained even if the consumer is offline.

---

### Q: How does the Frontend manage client and server state, and why did you select TanStack Query over using a custom data fetching solution?

**[NAVIGATE: Open `frontend/src/store/` directory]**

**A:** I divide state management into two categories. Client State (local UI concerns, like theme, dark mode, or token storage) is managed using Zustand. I chose Zustand because it is lightweight, requires minimal boilerplate, and is TypeScript-friendly. It is primarily used to store the access and refresh tokens via the Persist Middleware. 

**[NAVIGATE: Open `frontend/src/lib/api/client.ts`]**

Server State (API data, like tasks or user lists) is managed entirely by TanStack Query (React Query). I selected TanStack Query because it solves the inherent difficulties of asynchronous data management. It provides automatic caching with defined `staleTime`, background refetching of stale data, handles deduplication of concurrent requests, and natively supports Optimistic Updates during mutations (e.g., dragging a task). 

**[NAVIGATE: Open `frontend/src/app/tasks/page.tsx`]**

This framework allows components to focus purely on display logic, eliminating the need to write complex manual caching and synchronization code.

---

### Q: The Organization Service manages hierarchical teams. How do you model this in PostgreSQL, and how would you query the full team structure?

**[NAVIGATE: Open `services/org/models/team.go`]**

**A:** Hierarchical teams are modeled in PostgreSQL using a self-referencing foreign key I designed. The teams table includes a column named `parent_team_id`, which references the `id` column of the same table. This foreign key is nullable to allow for top-level root teams. 

[PAUSE] 

**[NAVIGATE: Open `services/org/service/team_service.go`]**

Querying the full structure—finding all descendants of a given parent team—requires advanced SQL capabilities, specifically Recursive Common Table Expressions (CTEs). A Recursive CTE allows me to define a temporary result set that continually queries itself until a terminating condition is met (i.e., no more children are found). Since the Organization Service I built occasionally uses raw SQL via `database/sql`, implementing this recursive CTE is the most efficient way to fetch the entire team hierarchy structure in a single database round trip, thereby preventing the performance-killing N+1 query problem.

---

### Q: What are the key features you included in the JWT claim structure to support the system's needs?

**[NAVIGATE: Open `pkg/auth/jwt.go`]**

**A:** My JWT claim structure is designed to facilitate stateless authorization and multi-tenancy. I include three mandatory, high-value claims that are required for every authorized request:

1. **user_id (string):** The UUID of the authenticated user. Used to scope tasks to the individual (e.g., `created_by = user_id`).

2. **org_id (string):** The UUID of the organization the user belongs to. This is the single most critical security claim I designed, used by every service to enforce the mandatory `WHERE org_id = ?` filter, guaranteeing multi-tenant isolation.

3. **role (string):** The user's role (e.g., `org_admin`, `member`). This enables immediate RBAC enforcement within the service logic, determining data visibility without requiring a database lookup. 

These embedded claims ensure the authority needed for authorization is contained entirely within the token, providing significant performance benefits and horizontal scalability.

---

### Q: How do you prevent SQL injection, especially considering the Organization Service sometimes uses raw SQL?

**[NAVIGATE: Open `services/org/service/team_service.go`]**

**A:** Preventing SQL injection is critical, especially when using raw SQL. The fundamental rule I follow is to never concatenate user input directly into an SQL string. Instead, I always use parameterized queries. Whether using GORM or raw `database/sql`, I use placeholders like `$1`, `$2`, or the ORM's specific format. 

**[NAVIGATE: Scroll to a raw SQL query example showing parameterized queries]**

This ensures that user-provided values are passed separately from the SQL command itself. The database driver then safely escapes and quotes the values, treating them purely as data and not as executable code. Furthermore, input validation is enforced upstream in the services I built, such as checking that parameters like `team_id` or `user_id` are valid UUID formats and normalizing emails to lowercase before processing, limiting the attack surface.

---

### Q: Explain gRPC-Gateway's role and why you didn't just write REST endpoints manually.

**[NAVIGATE: Open `gateway/main.go` and scroll to the gRPC-Gateway setup]**

**A:** The gRPC-Gateway is a reverse proxy that sits within the API Gateway I built. Its primary role is protocol translation. It accepts external HTTP/JSON requests from browsers and mobile clients, translates them to efficient binary gRPC calls using Protocol Buffers based on the `google.api.http` annotations I defined in the proto files, and then converts the gRPC responses back to JSON. 

**[NAVIGATE: Open `proto/user.proto` and show the google.api.http annotations]**

I chose gRPC-Gateway instead of writing REST handlers manually because it provides automatic code generation. This ensures complete consistency between my internal gRPC API and my external REST API, drastically reducing boilerplate and eliminating the need to manually parse JSON or maintain separate API definitions. This focus allows my Go services to focus purely on high-performance gRPC RPCs.

---

### [TIME: 11:00] 

**End of Script.**
