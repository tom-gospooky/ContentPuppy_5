import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

class LinkedInSavedPostsExporter {
  constructor() {
    this.liAtCookie = process.env.LI_AT;
    this.maxIdleRounds = parseInt(process.env.MAX_IDLE_ROUNDS) || 5;
    this.maxTimeMinutes = parseInt(process.env.MAX_TIME_MINUTES) || 10;
    this.headless = process.env.HEADLESS !== 'false';
    this.browser = null;
    this.page = null;
    this.posts = new Map(); // Use Map to ensure unique activityIds
  }

  async init() {
    if (!this.liAtCookie || this.liAtCookie === 'your_li_at_cookie_value_here') {
      throw new Error('Please set your LI_AT cookie in the .env file');
    }

    console.log('Launching browser...');
    this.browser = await puppeteer.launch({
      headless: this.headless ? 'new' : false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });

    this.page = await this.browser.newPage();
    
    // Set realistic user agent
    await this.page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Set viewport
    await this.page.setViewport({ width: 1366, height: 768 });

    console.log('Setting authentication cookie...');
    
    // Set the cookie
    await this.page.setCookie({
      name: 'li_at',
      value: this.liAtCookie,
      domain: '.linkedin.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax'
    });
    
    console.log('Cookie set successfully');
  }

  async verifyAuthentication() {
    console.log('Verifying authentication...');
    
    try {
      console.log('Navigating to LinkedIn homepage...');
      await this.page.goto('https://www.linkedin.com/', { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      
      await new Promise(resolve => setTimeout(resolve, 5000));
      let currentUrl = this.page.url();
      console.log(`Homepage URL: ${currentUrl}`);
      
      if (currentUrl.includes('/login') || currentUrl.includes('/challenge')) {
        throw new Error('Authentication failed - invalid or expired li_at cookie');
      }
      
      const title = await this.page.title();
      console.log(`✓ Authentication verified - ${title}`);
      
    } catch (error) {
      console.error('Authentication error:', error.message);
      throw error;
    }
  }

  async navigateToSavedPosts() {
    console.log('Navigating to saved posts...');
    
    try {
      await this.page.goto('https://www.linkedin.com/my-items/saved-posts/', { 
        waitUntil: 'domcontentloaded',
        timeout: 60000 
      });
      
      await new Promise(resolve => setTimeout(resolve, 5000));
      let currentUrl = this.page.url();
      console.log(`Saved Posts URL: ${currentUrl}`);
      
      if (currentUrl.includes('/login')) {
        throw new Error('Lost authentication when accessing saved posts');
      }
      
      console.log('✓ Saved posts page loaded');
    } catch (error) {
      console.error('Navigation error:', error.message);
      throw error;
    }
  }

  async expandSeeMore() {
    const seeMoreButtons = await this.page.$$('button[aria-expanded="false"]:has-text("more"), button:has-text("See more"), button:has-text("Meer weergeven")');
    
    for (const button of seeMoreButtons) {
      try {
        const isVisible = await button.isIntersectingViewport();
        if (isVisible) {
          await button.click();
          await this.randomDelay(300, 600);
        }
      } catch (error) {
        // Ignore errors for buttons that might not be clickable
      }
    }
  }

  async extractPostData(postElement) {
    try {
      const data = await postElement.evaluate((element) => {
        // Extract activityId from various sources
        let activityId = null;
        
        // Strategy 1: From data-urn attribute
        const urnElement = element.querySelector('[data-urn*="activity:"]');
        if (urnElement) {
          const urn = urnElement.getAttribute('data-urn');
          const match = urn.match(/activity:(\d+)/);
          if (match) activityId = match[1];
        }
        
        // Strategy 2: From anchor href
        if (!activityId) {
          const linkElement = element.querySelector('a[href*="/posts/"]');
          if (linkElement) {
            const href = linkElement.getAttribute('href');
            const match = href.match(/posts\/[^-]+-(\d+)-/);
            if (match) activityId = match[1];
          }
        }
        
        // Strategy 3: From any element with activity ID pattern
        if (!activityId) {
          const allElements = element.querySelectorAll('*');
          for (const el of allElements) {
            const id = el.getAttribute('id') || el.getAttribute('data-id') || '';
            const match = id.match(/(\d{19})/); // LinkedIn activity IDs are typically 19 digits
            if (match) {
              activityId = match[1];
              break;
            }
          }
        }
        
        if (!activityId) return null;
        
        // Extract post URL
        const linkElement = element.querySelector('a[href*="/posts/"]');
        const postUrl = linkElement ? 
          (linkElement.getAttribute('href').startsWith('http') ? 
            linkElement.getAttribute('href') : 
            `https://www.linkedin.com${linkElement.getAttribute('href')}`) : null;
        
        // Extract author info
        const authorElement = element.querySelector('[data-anonymize="person-name"], .feed-shared-actor__name a, .update-components-actor__name a');
        const author = authorElement ? authorElement.textContent.trim() : null;
        
        // Extract snippet (post content)
        const contentSelectors = [
          '.feed-shared-text__text-view',
          '.feed-shared-update-v2__description',
          '[data-test-id="main-feed-activity-card"] .break-words',
          '.update-components-text .break-words'
        ];
        
        let snippet = null;
        for (const selector of contentSelectors) {
          const contentElement = element.querySelector(selector);
          if (contentElement) {
            snippet = contentElement.textContent.trim();
            break;
          }
        }
        
        // Limit snippet to 1400 characters
        if (snippet && snippet.length > 1400) {
          snippet = snippet.substring(0, 1400) + '...';
        }
        
        return {
          activityId,
          postUrl,
          author,
          snippet
        };
      });
      
      return data;
    } catch (error) {
      console.warn('Error extracting post data:', error.message);
      return null;
    }
  }

  async scrollAndExtractPosts() {
    console.log('Starting infinite scroll and post extraction...');
    const startTime = Date.now();
    const maxTime = this.maxTimeMinutes * 60 * 1000;
    let idleRounds = 0;
    let lastPostCount = 0;
    
    while (idleRounds < this.maxIdleRounds && (Date.now() - startTime) < maxTime) {
      // Expand "See more" buttons before extracting
      await this.expandSeeMore();
      
      // Get all post elements with more generic selectors
      const postSelectors = [
        '.feed-shared-update-v2',
        '.occludable-update',
        '[data-urn*="activity"]',
        '.update-components-article'
      ];
      
      let postElements = [];
      for (const selector of postSelectors) {
        const elements = await this.page.$$(selector);
        postElements = postElements.concat(elements);
        if (elements.length > 0) break;
      }
      
      console.log(`Found ${postElements.length} post elements on page`);
      
      // Extract data from each post
      for (const postElement of postElements) {
        const postData = await this.extractPostData(postElement);
        if (postData && postData.activityId) {
          this.posts.set(postData.activityId, postData);
        }
      }
      
      const currentPostCount = this.posts.size;
      console.log(`Extracted ${currentPostCount} unique posts so far`);
      
      // Check if we found new posts
      if (currentPostCount === lastPostCount) {
        idleRounds++;
        console.log(`No new posts found. Idle round ${idleRounds}/${this.maxIdleRounds}`);
      } else {
        idleRounds = 0;
        lastPostCount = currentPostCount;
      }
      
      // Scroll down
      await this.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      
      // Random delay between scrolls
      await this.randomDelay(650, 1250);
      
      // Wait for potential new content to load
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    const finalCount = this.posts.size;
    console.log(`✓ Finished scrolling. Total unique posts extracted: ${finalCount}`);
    
    if (idleRounds >= this.maxIdleRounds) {
      console.log('Stopped due to idle rounds limit');
    }
    if ((Date.now() - startTime) >= maxTime) {
      console.log('Stopped due to time limit');
    }
  }

  async exportToJSON() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `linkedin_saved_posts_${timestamp}.json`;
    const filepath = path.join('./out', filename);
    
    const exportData = {
      exportedAt: new Date().toISOString(),
      count: this.posts.size,
      items: Array.from(this.posts.values())
    };
    
    await fs.writeFile(filepath, JSON.stringify(exportData, null, 2));
    console.log(`✓ Exported ${this.posts.size} posts to ${filepath}`);
    
    return filepath;
  }

  async randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async run() {
    try {
      await this.init();
      await this.verifyAuthentication();
      await this.navigateToSavedPosts();
      await this.scrollAndExtractPosts();
      const filepath = await this.exportToJSON();
      
      console.log(`\n🎉 Export completed successfully!`);
      console.log(`📊 Total posts exported: ${this.posts.size}`);
      console.log(`📁 File saved: ${filepath}`);
      
    } catch (error) {
      console.error('❌ Export failed:', error.message);
      throw error;
    } finally {
      await this.cleanup();
    }
  }
}

// Run the exporter
const exporter = new LinkedInSavedPostsExporter();
exporter.run().catch(console.error);