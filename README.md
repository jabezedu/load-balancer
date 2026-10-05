# Load Balancer

Simulates a cloud application load balancer (such as AWS Application Load Balancer or NGINX) with multiple balancing algorithms and health checks.

## Overview

The Load Balancer simulator demonstrates core load balancing and traffic distribution algorithms used to scale backend server fleets. It models Round Robin, Smooth Weighted Round Robin, Least Connections, and IP Hash algorithms, complete with backend health checks and traffic distribution analysis. Users can configure server weights, toggle instance availability, and simulate batches of concurrent client requests.

## Features

- Support for four standard balancing algorithms: Round Robin, Weighted Round Robin, Least Connections, and IP Hash
- Dynamic server pool management allowing 3 to 6 backend nodes with weights from 1 to 10
- Server health check state toggling with instant failover and traffic exclusion for unhealthy nodes
- Least Connections dispatching using a virtual clock tracker for concurrent request overlap
- Smooth Weighted Round Robin distributing requests proportionally without burst clustering
- Real-time traffic distribution metrics computing request counts and percentage share per node
- Detailed access logging recording client IP, selected target server, and simulated latency
- One-click statistical reset to clear historical counters and access logs

## Tech Stack

| Component | Technology |
| --- | --- |
| Frontend | Next.js 14 + TypeScript + Tailwind |
| Backend | Node.js + Express |
| Database | PostgreSQL 16 |
| Auth | JWT |
| Container | Docker Compose |

## Project Structure

```
load-balancer/
├── backend/
├── database/
│   └── init.sql
├── docker-compose.yml
└── frontend/
```

## Getting Started

### Prerequisites

- Node.js 20+
- Docker and Docker Compose

### Option A: Docker Compose

1. From the `load-balancer` directory, run:
   ```bash
   docker compose up --build
   ```
2. Access the applications:
   - Frontend: http://localhost:3003
   - Backend: http://localhost:4003

### Option B: Local Development

1. Start the PostgreSQL database:
   ```bash
   docker compose up -d db
   ```
2. Start the backend service:
   ```bash
   cd backend
   npm install
   npm run dev
   ```
   Backend runs on http://localhost:4003.
3. Start the frontend application:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Frontend runs on http://localhost:3003.

> `database/init.sql` runs only on first container startup. To reset the database and re-run initialization, run `docker compose down -v`.

## Demo Login

- **Email**: admin@demo.com
- **Password**: demo123

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description |
| --- | --- |
| `PORT` | Port for Express backend server (default: 4003) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret key used to sign and verify authentication JWT tokens |
| `CORS_ORIGIN` | Allowed origin for Cross-Origin Resource Sharing |

### Frontend (`frontend/.env.local`)

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Base URL for the backend API (default: http://localhost:4003) |

*Note: The frontend reads the API URL from `NEXT_PUBLIC_API_URL` at build time, so it must be configured before building for deployment.*

## API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Server health check endpoint |
| POST | `/api/auth/login` | Authenticate administrator and receive JWT token |
| GET | `/api/balancers` | List all load balancers with server pools, shares, and recent logs |
| POST | `/api/balancers` | Create a new load balancer with initial backend servers |
| PATCH | `/api/balancers/:id/algorithm` | Switch the active routing algorithm for a balancer |
| PATCH | `/api/balancers/:balancerId/servers/:serverId` | Update server health status or traffic weight |
| POST | `/api/balancers/:id/reset` | Reset request counters and clear logs for a balancer |
| POST | `/api/balancers/:id/simulate` | Send a batch of simulated client requests (1 to 100) |

## License

MIT
