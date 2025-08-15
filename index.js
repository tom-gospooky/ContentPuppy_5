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
    console.log('Launching browser with persistent session...');
    
    // Use a persistent user data directory
    const userDataDir = './browser-profile';
    
    this.browser = await puppeteer.launch({
      headless: this.headless ? 'new' : false,
      userDataDir: userDataDir, // This persists cookies and session data
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--enable-clipboard-api'
      ],
    });

    this.page = await this.browser.newPage();
    
    // Grant clipboard permissions
    const context = this.browser.defaultBrowserContext();
    await context.overridePermissions('https://www.linkedin.com', [
      'clipboard-read',
      'clipboard-write'
    ]);
    
    // Set realistic desktop user agent
    await this.page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Set desktop viewport to avoid mobile mode
    await this.page.setViewport({ width: 1920, height: 1080 });

    // Check if we already have valid cookies from persistent session
    await this.page.goto('https://www.linkedin.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const currentUrl = this.page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/challenge')) {
      console.log('No valid session found. Please log in manually...');
      
      if (this.liAtCookie && this.liAtCookie !== 'your_li_at_cookie_value_here') {
        console.log('Attempting to use provided li_at cookie...');
        await this.page.setCookie({
          name: 'li_at',
          value: this.liAtCookie,
          domain: '.linkedin.com',
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'Lax'
        });
        
        await this.page.reload({ waitUntil: 'domcontentloaded' });
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        throw new Error('No valid session or li_at cookie. Please log in manually first by running with HEADLESS=false');
      }
    } else {
      console.log('✓ Valid session found, using existing authentication');
    }
  }

  async navigateDirectlyToSavedPosts() {
    console.log('Navigating directly to saved posts...');
    
    try {
      await this.page.goto('https://www.linkedin.com/my-items/saved-posts/', { 
        waitUntil: 'domcontentloaded',
        timeout: 60000 
      });
      
      await new Promise(resolve => setTimeout(resolve, 5000));
      let currentUrl = this.page.url();
      console.log(`Current URL: ${currentUrl}`);
      
      // Check if we're redirected to login
      if (currentUrl.includes('/login') || currentUrl.includes('/challenge')) {
        throw new Error('Authentication failed - redirected to login. Cookie may be invalid or expired.');
      }
      
      if (currentUrl.includes('chrome-error')) {
        throw new Error('Page crashed - LinkedIn may be detecting automation.');
      }
      
      // Get page title for confirmation
      const title = await this.page.title();
      console.log(`✓ Successfully navigated to saved posts - ${title}`);
      
      // Look for saved posts content based on actual structure
      const contentSelectors = [
        '.scaffold-finite-scroll__content', // Main container
        '.workflow-results-container', // Results container
        '.iqOtrPdNTFvGwEvknzyUKyJGGbemNLbZdqmOlM', // List container
        'ul[role="list"]' // Generic list
      ];
      
      let hasContent = false;
      for (const selector of contentSelectors) {
        const element = await this.page.$(selector);
        if (element) {
          hasContent = true;
          console.log(`✓ Saved posts content detected with selector: ${selector}`);
          break;
        }
      }
      
      if (!hasContent) {
        console.log('⚠️  No saved posts content detected, but continuing...');
      }
      
    } catch (error) {
      const currentUrl = this.page.url();
      console.log(`Error occurred at URL: ${currentUrl}`);
      
      if (error.message.includes('detached') || currentUrl.includes('chrome-error')) {
        throw new Error('Browser page crashed. LinkedIn may be detecting automation.');
      }
      if (error.message.includes('ERR_TOO_MANY_REDIRECTS')) {
        throw new Error('Too many redirects when accessing saved posts. Cookie may be invalid.');
      }
      if (error.message.includes('TimeoutError') || error.name === 'TimeoutError') {
        throw new Error('Navigation timeout - LinkedIn may be slow. Try again.');
      }
      throw error;
    }
  }


  async expandSeeMore() {
    // Find "See more" buttons with valid CSS selectors
    const seeMoreSelectors = [
      'button[aria-label*="more"]',
      'button[aria-expanded="false"]',
      '.feed-shared-inline-show-more-text button',
      '.inline-show-more-text button'
    ];
    
    for (const selector of seeMoreSelectors) {
      try {
        const buttons = await this.page.$$(selector);
        for (const button of buttons) {
          try {
            const isVisible = await button.isIntersectingViewport();
            const buttonText = await button.evaluate(el => el.textContent?.toLowerCase() || '');
            
            if (isVisible && (buttonText.includes('more') || buttonText.includes('voir plus') || buttonText.includes('meer'))) {
              await button.click();
              await this.randomDelay(300, 600);
            }
          } catch (error) {
            // Ignore errors for buttons that might not be clickable
          }
        }
      } catch (error) {
        // Ignore selector errors
      }
    }
  }

  // Simplified: Just extract activity ID for fallback URL generation
  async getActivityIdFromElement(postElement) {
    try {
      return await postElement.evaluate((element) => {
        // Simple activity ID extraction - just find the activity ID
        let activityId = null;
        
        // Strategy 1: From data-chameleon-result-urn attribute
        const chameleonElement = element.querySelector('[data-chameleon-result-urn*="activity:"]');
        if (chameleonElement) {
          const urn = chameleonElement.getAttribute('data-chameleon-result-urn');
          const match = urn.match(/activity:(\d+)/);
          if (match) activityId = match[1];
        }
        
        // Strategy 2: From any href containing activity
        if (!activityId) {
          const allLinks = element.querySelectorAll('a[href*="activity"]');
          for (const link of allLinks) {
            const href = link.getAttribute('href');
            const match = href.match(/activity[:%](\d{19})/); // 19-digit activity ID
            if (match) {
              activityId = match[1];
              break;
            }
          }
        }
        
        return activityId;
      });
    } catch (error) {
      console.log(`Error extracting activity ID: ${error.message}`);
      return null;
    }
  }


  async extractPostData(postElement) {
    try {
      // Simplified: Just get the activity ID and generate fallback URL
      let activityId = await this.getActivityIdFromElement(postElement);
      
      if (!activityId) {
        console.log('Could not extract activity ID from post element');
        return null;
      }

      const data = await postElement.evaluate((element) => {
        
        // Extract author info - based on actual structure
        let author = null;
        const authorElement = element.querySelector('span[dir="ltr"] span[aria-hidden="true"]');
        if (authorElement) {
          author = authorElement.textContent.trim();
        }
        
        // Alternative author extraction
        if (!author) {
          const authorLink = element.querySelector('a[href*="/in/"] span[dir="ltr"]');
          if (authorLink) {
            author = authorLink.textContent.trim();
          }
        }
        
        // Extract snippet - look for post content first
        let snippet = null;
        
        // Strategy 1: Look for the main post content summary
        const contentSummary = element.querySelector('.entity-result__content-summary');
        if (contentSummary) {
          snippet = contentSummary.textContent.trim();
          // Clean up the snippet by removing the "…see more" text
          snippet = snippet.replace(/…see more\s*$/, '').trim();
        }
        
        // Strategy 2: Look for job title/description if no post content
        if (!snippet) {
          const snippetElement = element.querySelector('.ycveuXhkEkAmzWHsixaypnAAraQzPMvChMfQ');
          if (snippetElement) {
            snippet = snippetElement.textContent.trim();
          }
        }
        
        // Strategy 3: Alternative snippet extraction
        if (!snippet) {
          const contentElements = element.querySelectorAll('.t-14.t-black.t-normal, .entity-result__content-actor, p');
          for (const el of contentElements) {
            const text = el.textContent.trim();
            if (text && text.length > 10 && !text.includes('•') && !text.includes('Visible to everyone') && !text.includes('see more')) {
              snippet = text;
              break;
            }
          }
        }
        
        // Limit snippet to 1400 characters
        if (snippet && snippet.length > 1400) {
          snippet = snippet.substring(0, 1400) + '...';
        }
        
        return {
          author,
          snippet
        };
      });
      
      // Generate fallback URL using the extracted activity ID
      if (data) {
        data.activityId = activityId; // Use the activity ID we extracted earlier
        data.originalPostUrl = `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}`;
        console.log(`✓ Generated fallback URL for post ${activityId}: ${data.originalPostUrl}`);
        return data;
      }
      
      return null;
    } catch (error) {
      console.warn('Error extracting post data:', error.message);
      return null;
    }
  }

  async clickShowMoreResults() {
    try {
      // Based on your HTML: button with classes including "scaffold-finite-scroll__load-button"
      const showMoreSelectors = [
        '.scaffold-finite-scroll__load-button', // Direct match from your HTML
        'button[id="ember340"]', // The exact button ID from your HTML (though IDs change)
        'button.artdeco-button.artdeco-button--muted.artdeco-button--1.artdeco-button--full.artdeco-button--secondary', // Full class chain
        'button.artdeco-button--muted.artdeco-button--full', // Key classes
        'button[class*="scaffold-finite-scroll"]', // Contains scaffold class
        'button[class*="load-button"]', // Contains load-button class
        '.artdeco-button--full[type="button"]' // Full-width button
      ];
      
      for (const selector of showMoreSelectors) {
        try {
          const buttons = await this.page.$$(selector);
          console.log(`Checking selector "${selector}": found ${buttons.length} buttons`);
          
          for (const button of buttons) {
            try {
              const isVisible = await button.isIntersectingViewport();
              const buttonText = await button.evaluate(el => el.textContent?.toLowerCase().trim() || '');
              const buttonClasses = await button.evaluate(el => el.className || '');
              
              console.log(`Button text: "${buttonText}", visible: ${isVisible}, classes: "${buttonClasses}"`);
              
              // Check if button is visible and either has the right class or text
              if (isVisible && (
                buttonClasses.includes('scaffold-finite-scroll__load-button') ||
                buttonClasses.includes('load-button') ||
                buttonText.includes('show more') || 
                buttonText.includes('more results') || 
                buttonText.includes('load more') ||
                buttonText.includes('see more') ||
                buttonText.includes('afficher plus') // French
              )) {
                console.log(`✓ Clicking "Show more results" button: "${buttonText}" with classes: "${buttonClasses}"`);
                
                // Scroll the button into view first
                await button.scrollIntoView();
                await this.randomDelay(1000, 2000);
                
                // Click the button
                await button.click();
                console.log('✓ Button clicked, waiting for content to load...');
                
                // Wait longer for LinkedIn to load new content
                await this.randomDelay(4000, 6000);
                return true; // Successfully clicked
              }
            } catch (error) {
              console.log(`Error with button: ${error.message}`);
            }
          }
        } catch (error) {
          console.log(`Error with selector "${selector}": ${error.message}`);
        }
      }
    } catch (error) {
      console.log(`Overall error in clickShowMoreResults: ${error.message}`);
    }
    return false; // No button found or clicked
  }

  async waitForNetworkIdle(timeout = 5000) {
    let networkIdleTimer = null;
    let pendingRequests = 0;
    let resolved = false;

    return new Promise((resolve) => {
      const requestHandler = () => {
        pendingRequests++;
        if (networkIdleTimer) {
          clearTimeout(networkIdleTimer);
          networkIdleTimer = null;
        }
      };

      const responseHandler = () => {
        pendingRequests--;
        if (pendingRequests === 0 && !resolved) {
          networkIdleTimer = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              this.page.off('request', requestHandler);
              this.page.off('response', responseHandler);
              resolve();
            }
          }, 1000); // Wait 1 second after last response
        }
      };

      // Set maximum timeout
      const maxTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.page.off('request', requestHandler);
          this.page.off('response', responseHandler);
          console.log('Network idle timeout reached');
          resolve();
        }
      }, timeout);

      this.page.on('request', requestHandler);
      this.page.on('response', responseHandler);

      // If already idle, resolve immediately
      if (pendingRequests === 0) {
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            this.page.off('request', requestHandler);
            this.page.off('response', responseHandler);
            clearTimeout(maxTimeout);
            resolve();
          }
        }, 1000);
      }
    });
  }

  async waitForSpinnerToDisappear(maxWait = 10000) {
    const spinnerSelectors = [
      '.loading-spinner',
      '[role="progressbar"]',
      '.artdeco-spinner',
      '.spinner',
      'svg[role="img"][aria-label*="Loading"]'
    ];

    try {
      console.log('Waiting for loading spinner to appear and disappear...');
      
      // First, wait for spinner to appear (if it's going to)
      let spinnerFound = false;
      const spinnerAppearTimeout = 2000;
      
      try {
        await this.page.waitForSelector(spinnerSelectors.join(', '), { 
          timeout: spinnerAppearTimeout 
        });
        spinnerFound = true;
        console.log('✓ Loading spinner detected');
      } catch (e) {
        console.log('No spinner detected initially');
      }

      if (spinnerFound) {
        // Wait for spinner to disappear
        await this.page.waitForFunction(() => {
          const selectors = [
            '.loading-spinner',
            '[role="progressbar"]',
            '.artdeco-spinner',
            '.spinner',
            'svg[role="img"][aria-label*="Loading"]'
          ];
          
          return !selectors.some(selector => {
            const elements = document.querySelectorAll(selector);
            return Array.from(elements).some(el => 
              el.offsetParent !== null || // visible
              getComputedStyle(el).display !== 'none'
            );
          });
        }, { timeout: maxWait });
        
        console.log('✓ Loading spinner disappeared - content should be loaded');
        // Additional wait for content to render
        await this.randomDelay(1000, 2000);
      }
    } catch (error) {
      console.log(`Spinner wait timeout: ${error.message}`);
    }
  }

  async scrollAndExtractPosts() {
    console.log('Starting post extraction with viewport-aware pagination handling...');
    const startTime = Date.now();
    const maxTime = this.maxTimeMinutes * 60 * 1000;
    let idleRounds = 0;
    let lastPostCount = 0;
    let consecutiveNoNewPosts = 0;
    
    // Detect viewport type to determine loading strategy
    const viewport = await this.page.viewport();
    const isPortraitMode = viewport.height > viewport.width;
    console.log(`Viewport: ${viewport.width}x${viewport.height} - ${isPortraitMode ? 'Portrait (button mode)' : 'Landscape (lazy loading mode)'}`);
    
    while (idleRounds < this.maxIdleRounds && (Date.now() - startTime) < maxTime) {
      // Expand "See more" buttons for individual posts before extracting
      await this.expandSeeMore();
      
      // Get all saved post elements with more robust selectors
      const postSelectors = [
        '[data-chameleon-result-urn*="activity"]', // Most reliable - items with activity URN
        '.feed-shared-update-v2', // Standard post container
        '.entity-result__content-container', // Content containers
        'article[data-id]', // Article elements with data-id
        '[data-urn*="activity"]', // Any element with activity URN
        'li[class*="result"]', // Generic result list items
        '.update-components-actor' // Actor components
      ];
      
      let postElements = [];
      for (const selector of postSelectors) {
        const elements = await this.page.$$(selector);
        if (elements.length > 0) {
          postElements = elements;
          console.log(`Using selector: ${selector} - found ${elements.length} elements`);
          break;
        }
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
        consecutiveNoNewPosts++;
        console.log(`No new posts found since last check (${consecutiveNoNewPosts} times)...`);
        
        if (isPortraitMode) {
          // Portrait mode: Look for "Show more results" button
          console.log('Portrait mode: Looking for "Show more results" button...');
          const clickedShowMore = await this.clickShowMoreResults();
          if (clickedShowMore) {
            console.log('✓ Successfully clicked "Show more results", waiting for content...');
            await this.waitForNetworkIdle(8000);
            await this.waitForSpinnerToDisappear();
            consecutiveNoNewPosts = 0; // Reset counter
            continue;
          }
        } else {
          // Landscape mode: Use lazy loading with intersection observer simulation
          console.log('Landscape mode: Simulating intersection observer for lazy loading...');
          
          // Advanced scrolling technique for lazy loading
          const scrollResult = await this.page.evaluate(() => {
            const startHeight = document.body.scrollHeight;
            
            // Scroll to trigger lazy loading
            const scrollToEnd = () => {
              window.scrollTo(0, document.body.scrollHeight);
            };
            
            // Simulate rapid scrolling that triggers intersection observers
            const simulateScrolling = () => {
              const currentScroll = window.pageYOffset;
              const maxScroll = document.body.scrollHeight - window.innerHeight;
              
              // Scroll up 20% then back down
              window.scrollTo(0, currentScroll - (window.innerHeight * 0.2));
              setTimeout(() => {
                window.scrollTo(0, maxScroll);
              }, 100);
            };
            
            scrollToEnd();
            simulateScrolling();
            
            return {
              startHeight,
              endHeight: document.body.scrollHeight
            };
          });
          
          console.log(`Page height: ${scrollResult.startHeight} -> ${scrollResult.endHeight}`);
          
          // Wait for network activity and spinner
          await this.waitForNetworkIdle(8000);
          await this.waitForSpinnerToDisappear();
          
          // Additional intersection observer trigger
          await this.page.evaluate(() => {
            // Find the main content container and scroll it
            const containers = [
              '.scaffold-finite-scroll__content',
              'main[role="main"]',
              '.application-outlet'
            ];
            
            containers.forEach(selector => {
              const container = document.querySelector(selector);
              if (container) {
                container.scrollTop = container.scrollHeight;
                // Trigger a scroll event
                container.dispatchEvent(new Event('scroll'));
              }
            });
          });
          
          await this.randomDelay(2000, 3000);
        }
        
        // Final fallback: check for button even in landscape mode (sometimes appears)
        if (consecutiveNoNewPosts >= 2) {
          console.log('Final fallback: Checking for "Show more results" button...');
          const finalClickCheck = await this.clickShowMoreResults();
          if (finalClickCheck) {
            console.log('✓ Found and clicked "Show more results" button in final check!');
            await this.waitForNetworkIdle(8000);
            await this.waitForSpinnerToDisappear();
            consecutiveNoNewPosts = 0;
            continue;
          }
        }
        
        // If we've tried multiple times without success, increment idle counter
        if (consecutiveNoNewPosts >= 3) {
          idleRounds++;
          consecutiveNoNewPosts = 0; // Reset for next iteration
          console.log(`Multiple attempts failed. Idle round ${idleRounds}/${this.maxIdleRounds}`);
        }
      } else {
        // Found new posts, reset all counters
        idleRounds = 0;
        consecutiveNoNewPosts = 0;
        const newPostsCount = currentPostCount - lastPostCount;
        lastPostCount = currentPostCount;
        console.log(`✓ Found ${newPostsCount} new posts! Total: ${currentPostCount}`);
      }
      
      // Small delay before next iteration
      await this.randomDelay(1000, 2000);
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
      await this.navigateDirectlyToSavedPosts();
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