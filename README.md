# ExercisePal — Your Daily Fitness Trainer

ExercisePal is a full-stack web application that acts as a personal fitness trainer. It provides daily workout plans, an exercise library with search and filter, a weekly training schedule, and a map of nearby gyms in Kigali, Rwanda. The app is designed to help users build and maintain a consistent fitness routine — whether they are at the gym or working out at home.

---

## Features

- **Daily Workout** — Automatically loads a workout based on the current day of the week (Chest, Back, Legs, Shoulders, Arms, Core, Rest Day)
- **Gym / Home Mode** — Toggle between gym exercises (with equipment) and home exercises (bodyweight only)
- **Progress Tracker** — Mark each exercise as done and track completion with a live progress bar
- **Exercise Library** — Search by name, filter by body part, and sort by name, difficulty, or equipment
- **Weekly Training Plan** — View the full 7-day schedule and preview exercises for any day
- **Nearby Gyms** — Locate fitness centers in Kigali using your GPS location or browse all gyms on the map
- **Light / Dark Theme** — Toggle between dark and light mode (preference saved in localStorage)
- **YouTube Tutorials** — Every exercise card links to a YouTube tutorial for that specific exercise

---

## APIs Used

| API | Purpose | Documentation |
|-----|---------|--------------|
| [ExerciseDB (RapidAPI)](https://rapidapi.com/justin-WFnsXH_t6/api/exercisedb) | Exercise data — names, targets, equipment, instructions, difficulty | https://rapidapi.com/justin-WFnsXH_t6/api/exercisedb |
| [OpenStreetMap Overpass API](https://overpass-api.de/) | Nearby gym locations (free, no key required) | https://wiki.openstreetmap.org/wiki/Overpass_API |

---

## Running Locally

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- A free RapidAPI account with access to [ExerciseDB](https://rapidapi.com/justin-WFnsXH_t6/api/exercisedb)

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env
```

Edit `.env` and fill in your RapidAPI key:

```
RAPIDAPI_KEY=your_rapidapi_key_here
PORT=3000
ALLOWED_ORIGIN=http://localhost:3000
```

```bash
# 4. Start the server
npm start
```

Open your browser and go to: **http://localhost:3000**

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RAPIDAPI_KEY` | Your RapidAPI key for ExerciseDB | (required) |
| `PORT` | Port the server listens on | `3000` |
| `ALLOWED_ORIGIN` | CORS allowed origin | `http://localhost:3000` |

> **Security note:** The `.env` file is excluded by `.gitignore` and must never be committed to the repository.

---

## Deployment on Web Servers

The application is deployed on two web servers (Web01 and Web02) behind a load balancer (Lb01).

### Server Information

| Server | Role | IP Address |
|--------|------|-----------|
| Web01 | Application server | 54.88.58.56 |
| Web02 | Application server | 13.219.88.213 |
| Lb01  | Load balancer (HAProxy) | 3.83.53.244 |

### Deploy on Web01 and Web02

Run the following steps on **both** Web01 and Web02:

```bash
# SSH into the server
ssh ubuntu@54.88.58.56   # (or 13.219.88.213 for Web02)

# Clone the repository
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

# Install Node.js (if not installed)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install dependencies
npm install

# Create the environment file
nano .env
# Paste your RAPIDAPI_KEY, PORT=3000, ALLOWED_ORIGIN=http://localhost:3000

# Install PM2 (process manager to keep app running)
sudo npm install -g pm2

# Start the application with PM2
pm2 start server.js --name exercisepal

# Save PM2 process list so it restarts on reboot
pm2 save
pm2 startup
```

To update the app after pushing new code:

```bash
git pull origin main
pm2 restart exercisepal
```

### Load Balancer Configuration (HAProxy on Lb01)

HAProxy was already installed on Lb01. The configuration file is at `/etc/haproxy/haproxy.cfg`.

```bash
ssh ubuntu@3.83.53.244
sudo nano /etc/haproxy/haproxy.cfg
```

Add or update the following sections:

```
frontend http_front
    bind *:80
    default_backend http_back

backend http_back
    balance roundrobin
    server web01 54.88.58.56:3000 check
    server web02 13.219.88.213:3000 check
```

Reload HAProxy to apply changes:

```bash
sudo systemctl reload haproxy
```

The application is now accessible at **http://3.83.53.244** and traffic is distributed between Web01 and Web02 using round-robin balancing.

### Verifying Load Balancing

To verify that traffic is balanced between the two servers:

```bash
# Check HAProxy status
sudo systemctl status haproxy

# Check PM2 process on each server
pm2 status

# Test the endpoint
curl http://3.83.53.244/ping
```

---

## Project Structure

```
exercisepal/
├── public/
│   ├── index.html       # Frontend HTML — 4 tabs: Daily, Library, Weekly, Gyms
│   ├── css/
│   │   └── style.css    # All styles — dark/light theme, responsive layout
│   └── js/
│       └── app.js       # Frontend JavaScript — API calls, rendering, interaction
├── server.js            # Express backend — API proxy, caching, gym route
├── .env.example         # Environment variable template
├── .gitignore           # Excludes node_modules, .env
├── package.json
└── README.md
```

---

## Bonus Features Implemented

- **Server-side caching** — API responses are cached with `node-cache` (10-minute TTL) to reduce API calls and improve load times
- **Rate limiting** — `express-rate-limit` limits each IP to 100 requests per 15 minutes to prevent abuse
- **Security headers** — `helmet` adds HTTP security headers (XSS protection, no-sniff, etc.)
- **Input validation** — All query parameters are validated and sanitized before use
- **XSS protection** — All user-supplied data rendered in HTML is escaped via `escapeHTML()`
- **CORS protection** — Only the configured origin is allowed to make requests

---

## Challenges Faced

1. **HAProxy vs Nginx conflict** — HAProxy was already running on port 80 on Lb01. Attempting to run Nginx caused a port conflict. Solution: configured HAProxy directly instead of using Nginx.

2. **ExerciseDB GIF URLs removed** — The free tier of ExerciseDB no longer returns `gifUrl` in API responses. Solution: mapped each body part to a relevant Unsplash photo and added difficulty badges using the `difficulty` field that is still returned.

3. **Home workout filter returning empty** — Filtering only for `body weight` equipment returned too few results for some body parts. Solution: implemented a progressive fallback (body weight → resistance band → any no-gym equipment → any equipment).

4. **Express 5 rate limiter path issue** — Mounting the rate limiter with `app.use('/api', limiter)` caused all routes to return "Cannot GET" in Express 5. Solution: changed to `app.use(limiter)` to apply globally.

5. **Stale Node.js process** — After code changes, the old Node.js process was still running on port 3000 serving the old code. Solution: explicitly kill the old process before restarting.

---

## Credits

- **Exercise data** — [ExerciseDB](https://rapidapi.com/justin-WFnsXH_t6/api/exercisedb) by Justin on RapidAPI
- **Gym location data** — [OpenStreetMap](https://www.openstreetmap.org/) via [Overpass API](https://overpass-api.de/)
- **Exercise photos** — [Unsplash](https://unsplash.com/) (free to use under Unsplash License)
- **Icons** — [Font Awesome 6 Free](https://fontawesome.com/) (CDN, MIT License)
- **Font** — [Inter](https://fonts.google.com/specimen/Inter) via Google Fonts (SIL Open Font License)
- **Backend** — [Express.js](https://expressjs.com/), [Axios](https://axios-http.com/), [node-cache](https://github.com/node-cache/node-cache)

---

## License

This project was created as part of a school assignment at Holberton School.
