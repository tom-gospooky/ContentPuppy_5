'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Play, Pause, Download, ExternalLink } from 'lucide-react';

interface ScrapedPost {
  activityId: string;
  originalPostUrl: string;
  author: string;
  snippet: string;
}

interface ScrapingStatus {
  status: 'idle' | 'running' | 'completed' | 'error';
  message: string;
  postsFound: number;
  timeElapsed: string;
  progress: number;
}

export default function Home() {
  const [scrapingStatus, setScrapingStatus] = useState<ScrapingStatus>({
    status: 'idle',
    message: 'Ready to start scraping',
    postsFound: 0,
    timeElapsed: '0s',
    progress: 0
  });
  const [scrapedPosts, setScrapedPosts] = useState<ScrapedPost[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);

  useEffect(() => {
    // Initialize WebSocket connection for real-time updates
    const websocket = new WebSocket('ws://localhost:3001');
    
    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'status') {
        setScrapingStatus(data.payload);
      } else if (data.type === 'posts') {
        setScrapedPosts(data.payload);
      }
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    setWs(websocket);

    return () => {
      websocket.close();
    };
  }, []);

  const startScraping = async () => {
    try {
      const response = await fetch('/api/scrape/start', {
        method: 'POST',
      });
      
      if (!response.ok) {
        throw new Error('Failed to start scraping');
      }
    } catch (error) {
      console.error('Error starting scraping:', error);
      setScrapingStatus({
        status: 'error',
        message: 'Failed to start scraping',
        postsFound: 0,
        timeElapsed: '0s',
        progress: 0
      });
    }
  };

  const stopScraping = async () => {
    try {
      const response = await fetch('/api/scrape/stop', {
        method: 'POST',
      });
      
      if (!response.ok) {
        throw new Error('Failed to stop scraping');
      }
    } catch (error) {
      console.error('Error stopping scraping:', error);
    }
  };

  const downloadResults = () => {
    const dataStr = JSON.stringify({
      exportedAt: new Date().toISOString(),
      count: scrapedPosts.length,
      items: scrapedPosts
    }, null, 2);
    
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `linkedin_saved_posts_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'running': return 'default';
      case 'completed': return 'secondary';
      case 'error': return 'destructive';
      default: return 'outline';
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-col space-y-2">
        <h1 className="text-3xl font-bold">LinkedIn Saved Posts Scraper</h1>
        <p className="text-muted-foreground">
          Extract and export your saved LinkedIn posts with real-time progress tracking
        </p>
      </div>

      {/* Control Panel */}
      <Card>
        <CardHeader>
          <CardTitle>Scraping Control</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Button 
              onClick={startScraping} 
              disabled={scrapingStatus.status === 'running'}
              className="flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              Start Scraping
            </Button>
            
            <Button 
              variant="outline"
              onClick={stopScraping} 
              disabled={scrapingStatus.status !== 'running'}
              className="flex items-center gap-2"
            >
              <Pause className="w-4 h-4" />
              Stop
            </Button>

            <Button 
              variant="secondary"
              onClick={downloadResults} 
              disabled={scrapedPosts.length === 0}
              className="flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download Results
            </Button>
          </div>

          <div className="flex items-center gap-4">
            <Badge variant={getStatusBadgeVariant(scrapingStatus.status)}>
              {scrapingStatus.status.toUpperCase()}
            </Badge>
            <span className="text-sm text-muted-foreground">
              Posts found: {scrapingStatus.postsFound} | Time: {scrapingStatus.timeElapsed}
            </span>
          </div>

          {scrapingStatus.status === 'running' && (
            <div className="space-y-2">
              <Progress value={scrapingStatus.progress} className="w-full" />
              <p className="text-sm text-muted-foreground">{scrapingStatus.message}</p>
            </div>
          )}

          {scrapingStatus.status === 'error' && (
            <Alert variant="destructive">
              <AlertDescription>{scrapingStatus.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Results Table */}
      <Card>
        <CardHeader>
          <CardTitle>Scraped Posts ({scrapedPosts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {scrapedPosts.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Author</TableHead>
                  <TableHead>Content Preview</TableHead>
                  <TableHead>Link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scrapedPosts.map((post) => (
                  <TableRow key={post.activityId}>
                    <TableCell className="font-medium">{post.author}</TableCell>
                    <TableCell className="max-w-md">
                      <p className="truncate" title={post.snippet}>
                        {post.snippet}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Button 
                        variant="outline" 
                        size="sm"
                        asChild
                      >
                        <a 
                          href={post.originalPostUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View Post
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No posts scraped yet. Click "Start Scraping" to begin.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
