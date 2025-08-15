# LinkedIn Saved Posts Scraper - Frontend

A modern web interface for the LinkedIn saved posts scraper with real-time progress tracking and results display.

## Features

- **Modern UI**: Built with Next.js, Tailwind CSS, and ShadCN UI components
- **Real-time Updates**: WebSocket connection for live scraping progress
- **Interactive Control**: Start/stop scraping with button controls  
- **Progress Tracking**: Visual progress bar and status indicators
- **Results Table**: Clean table display of scraped posts with links
- **Export Function**: Download results as JSON directly from the browser

## Quick Start

1. **Setup (first time only)**:
   ```bash
   npm run login    # Set up LinkedIn session
   ```

2. **Run the full application**:
   ```bash
   npm run dev      # Starts both server and frontend
   ```

   This will start:
   - Backend server on `http://localhost:3001`
   - Frontend UI on `http://localhost:3000`

3. Open your browser to `http://localhost:3000` and start scraping!

## Manual Setup

If you prefer to run components separately:

```bash
# Terminal 1 - Start the backend server
npm run server

# Terminal 2 - Start the frontend  
npm run frontend
```

## How It Works

1. **Backend Server** (`server.js`):
   - Express.js server with WebSocket support
   - Spawns the scraping process when requested
   - Parses scraper output for real-time status updates
   - Broadcasts progress to connected frontend clients

2. **Frontend UI** (`frontend/`):
   - Next.js React application with TypeScript
   - ShadCN UI components for modern design
   - WebSocket client for real-time updates
   - API routes for starting/stopping scraper

3. **Real-time Communication**:
   - WebSocket connection provides instant feedback
   - Status updates include progress percentage, message, and timing
   - Scraped posts are loaded and displayed as they're found

## API Endpoints

- `POST /api/scrape/start` - Start scraping job
- `POST /api/scrape/stop` - Stop current scraping job
- WebSocket at `ws://localhost:3001` - Real-time updates

## Project Structure

```
├── server.js                 # Backend server with WebSocket
├── index.js                  # Original scraper (unchanged)
├── frontend/                 # Next.js frontend
│   ├── src/app/
│   │   ├── page.tsx          # Main UI component
│   │   └── api/scrape/       # API routes
│   └── components/ui/        # ShadCN UI components
└── out/                      # Scraped results (JSON files)
```

## Environment Variables

Same as the original scraper:
- `LI_AT` - LinkedIn authentication cookie
- `MAX_IDLE_ROUNDS=5` - Stop after N rounds with no new posts
- `MAX_TIME_MINUTES=10` - Maximum runtime in minutes
- `HEADLESS=true` - Run browser in headless mode