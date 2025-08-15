import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

let scrapingProcess = null;
let scrapingStatus = {
  status: 'idle',
  message: 'Ready to start scraping',
  postsFound: 0,
  timeElapsed: '0s',
  progress: 0
};

// WebSocket connections
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  
  // Send current status to new client
  ws.send(JSON.stringify({
    type: 'status',
    payload: scrapingStatus
  }));

  ws.on('close', () => {
    clients.delete(ws);
  });
});

// Broadcast to all connected clients
function broadcast(data) {
  clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  });
}

// Update status and broadcast
function updateStatus(newStatus) {
  scrapingStatus = { ...scrapingStatus, ...newStatus };
  broadcast({
    type: 'status',
    payload: scrapingStatus
  });
}

// Load and broadcast scraped posts
async function loadAndBroadcastPosts() {
  try {
    const outDir = './out';
    const files = await fs.readdir(outDir);
    const jsonFiles = files.filter(file => file.endsWith('.json')).sort().reverse();
    
    if (jsonFiles.length > 0) {
      const latestFile = path.join(outDir, jsonFiles[0]);
      const data = JSON.parse(await fs.readFile(latestFile, 'utf8'));
      
      broadcast({
        type: 'posts',
        payload: data.items || []
      });
      
      updateStatus({
        postsFound: data.count || 0
      });
    }
  } catch (error) {
    console.error('Error loading posts:', error);
  }
}

// Start scraping endpoint
app.post('/api/start-scraping', async (req, res) => {
  if (scrapingProcess) {
    return res.status(400).json({ error: 'Scraping already in progress' });
  }

  try {
    updateStatus({
      status: 'running',
      message: 'Initializing browser...',
      postsFound: 0,
      timeElapsed: '0s',
      progress: 10
    });

    const startTime = Date.now();
    
    // Spawn the scraping process
    scrapingProcess = spawn('node', ['index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });

    // Handle stdout from scraping process
    scrapingProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('Scraper output:', output);
      
      // Parse scraping progress from output
      let message = 'Scraping in progress...';
      let progress = 30;
      
      if (output.includes('Launching browser')) {
        message = 'Launching browser...';
        progress = 15;
      } else if (output.includes('Navigating')) {
        message = 'Navigating to saved posts...';
        progress = 25;
      } else if (output.includes('Starting post extraction')) {
        message = 'Starting post extraction...';
        progress = 35;
      } else if (output.includes('Found') && output.includes('post elements')) {
        message = 'Extracting posts from page...';
        progress = 50;
      } else if (output.includes('Extracted') && output.includes('unique posts')) {
        const match = output.match(/Extracted (\d+) unique posts/);
        if (match) {
          const count = parseInt(match[1]);
          message = `Found ${count} posts so far...`;
          progress = Math.min(70, 35 + (count * 2));
        }
      } else if (output.includes('Show more results')) {
        message = 'Loading more results...';
        progress = Math.min(80, progress + 5);
      } else if (output.includes('Finished scrolling')) {
        message = 'Finalizing extraction...';
        progress = 85;
      } else if (output.includes('Export completed')) {
        message = 'Export completed successfully!';
        progress = 100;
      }
      
      const timeElapsed = Math.floor((Date.now() - startTime) / 1000);
      
      updateStatus({
        message,
        progress,
        timeElapsed: `${timeElapsed}s`
      });
      
      // Load and broadcast latest posts periodically
      if (output.includes('unique posts')) {
        loadAndBroadcastPosts();
      }
    });

    // Handle stderr
    scrapingProcess.stderr.on('data', (data) => {
      console.error('Scraper error:', data.toString());
    });

    // Handle process exit
    scrapingProcess.on('close', (code) => {
      console.log(`Scraping process exited with code ${code}`);
      
      if (code === 0) {
        updateStatus({
          status: 'completed',
          message: 'Scraping completed successfully!',
          progress: 100
        });
        
        // Load final results
        setTimeout(loadAndBroadcastPosts, 1000);
      } else {
        updateStatus({
          status: 'error',
          message: 'Scraping failed with an error',
          progress: 0
        });
      }
      
      scrapingProcess = null;
    });

    res.json({ success: true, message: 'Scraping started' });
  } catch (error) {
    console.error('Error starting scraping:', error);
    updateStatus({
      status: 'error',
      message: 'Failed to start scraping',
      progress: 0
    });
    scrapingProcess = null;
    res.status(500).json({ error: 'Failed to start scraping' });
  }
});

// Stop scraping endpoint
app.post('/api/stop-scraping', (req, res) => {
  if (!scrapingProcess) {
    return res.status(400).json({ error: 'No scraping process running' });
  }

  scrapingProcess.kill('SIGTERM');
  updateStatus({
    status: 'idle',
    message: 'Scraping stopped by user',
    progress: 0
  });
  
  scrapingProcess = null;
  res.json({ success: true, message: 'Scraping stopped' });
});

// Get current status endpoint
app.get('/api/status', (req, res) => {
  res.json(scrapingStatus);
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready for connections`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  if (scrapingProcess) {
    scrapingProcess.kill('SIGTERM');
  }
  server.close();
});

process.on('SIGINT', () => {
  if (scrapingProcess) {
    scrapingProcess.kill('SIGTERM');
  }
  server.close();
  process.exit(0);
});