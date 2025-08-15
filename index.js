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
    this.realUrlsExtracted = 0; // Counter for real URLs extracted
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

  async getOriginalPostUrlFromDOM(postElement) {
    try {
      // Try to extract URL directly from DOM elements (faster, more reliable)
      const urlData = await postElement.evaluate((element) => {
        const foundUrls = [];
        let activityId = null;
        let profileUsername = null;
        
        // Extract activity ID
        const chameleonElement = element.querySelector('[data-chameleon-result-urn*="activity:"]');
        if (chameleonElement) {
          const urn = chameleonElement.getAttribute('data-chameleon-result-urn');
          const match = urn.match(/activity:(\d+)/);
          if (match) activityId = match[1];
        }
        
        // If no activity ID from chameleon, try other sources
        if (!activityId) {
          const allLinks = element.querySelectorAll('a[href*="activity"]');
          for (const link of allLinks) {
            const href = link.getAttribute('href');
            const match = href.match(/activity:(\d{19})/);
            if (match) {
              activityId = match[1];
              break;
            }
          }
        }
        
        // Look for profile username in profile links
        const profileLinks = element.querySelectorAll('a[href*="/in/"]');
        for (const link of profileLinks) {
          const href = link.getAttribute('href');
          // Look for proper username format (not ID format starting with ACo)
          const match = href.match(/\/in\/([a-zA-Z0-9-_]+)\/?/);
          if (match && !match[1].startsWith('ACo') && !match[1].includes('%')) {
            profileUsername = match[1];
            break;
          }
        }
        
        // Look for existing post URLs with correct format
        const allLinks = element.querySelectorAll('a[href]');
        for (const link of allLinks) {
          const href = link.getAttribute('href');
          // Look for URLs with the correct LinkedIn post format
          if (href && href.includes('/posts/') && href.includes('-activity-') && !href.includes('_xxx')) {
            foundUrls.push(href);
          }
        }
        
        return {
          urls: foundUrls,
          activityId: activityId,
          profileUsername: profileUsername
        };
      });
      
      // First, check if we found any properly formatted URLs
      for (const url of urlData.urls) {
        const fullUrl = url.startsWith('http') ? url : `https://www.linkedin.com${url}`;
        console.log(`✓ Found properly formatted URL in DOM: ${fullUrl}`);
        return fullUrl;
      }
      
      // If no properly formatted URL found, but we have username and activity ID, construct one
      if (urlData.profileUsername && urlData.activityId) {
        // We can't predict the hashtags and final hash, but LinkedIn often redirects these
        const constructedUrl = `https://www.linkedin.com/posts/${urlData.profileUsername}_activity-${urlData.activityId}`;
        console.log(`✓ Constructed URL from username and activity: ${constructedUrl}`);
        return constructedUrl;
      }
      
      return null;
    } catch (error) {
      console.log(`Error extracting URL from DOM: ${error.message}`);
      return null;
    }
  }

  async getOriginalPostUrlFromMenu(postElement) {
    try {
      // Find the three-dot overflow menu button (as shown in your screenshot)
      const overflowSelectors = [
        'button[aria-label*="more actions"]',
        'button[aria-label*="Open control menu"]',
        'button[aria-label*="more options"]',
        '.entity-result__overflow-actions-trigger-ember',
        '.artdeco-dropdown__trigger',
        'button.artdeco-button--circle[type="button"]',
        'button[class*="overflow"]',
        'button[data-test-overflow-menu-trigger]'
      ];
      
      let overflowButton = null;
      for (const selector of overflowSelectors) {
        overflowButton = await postElement.$(selector);
        if (overflowButton) {
          console.log(`Found overflow button with selector: ${selector}`);
          break;
        }
      }
      
      if (!overflowButton) {
        console.log('No overflow button found');
        return null;
      }
      
      // Scroll button into view and click it
      await overflowButton.scrollIntoView();
      await this.randomDelay(500, 1000);
      await overflowButton.click();
      await this.randomDelay(1000, 1500);
      
      let originalPostUrl = null;
      
      try {
        // Wait for dropdown menu to appear
        await this.page.waitForSelector('.artdeco-dropdown__content, .artdeco-dropdown, [role="menu"]', { timeout: 5000 });
        
        // Look for "Copy link to post" option (as shown in your screenshot)
        const dropdownSelectors = [
          '.artdeco-dropdown__content',
          '.artdeco-dropdown', 
          '[role="menu"]',
          '.overflow-actions-menu'
        ];
        
        let foundDropdown = null;
        for (const selector of dropdownSelectors) {
          foundDropdown = await this.page.$(selector);
          if (foundDropdown) break;
        }
        
        if (foundDropdown) {
          // Find all clickable items in the dropdown
          const dropdownItems = await foundDropdown.$$('button, a, [role="menuitem"], .artdeco-dropdown__item');
          
          for (const item of dropdownItems) {
            try {
              const text = await item.evaluate(el => el.textContent?.toLowerCase().trim() || '');
              console.log(`Dropdown item text: "${text}"`);
              
              // Look for "Copy link to post" (exact text from your screenshot)
              if (text.includes('copy link to post') || 
                  text.includes('copy link') && text.includes('post') ||
                  text.includes('copier le lien')) { // French version
                
                console.log(`Found "Copy link to post" button: "${text}"`);
                
                // Clear any existing clipboard content first
                try {
                  await this.page.evaluate(() => {
                    if (navigator.clipboard) {
                      return navigator.clipboard.writeText('CLEARED');
                    }
                  });
                  await this.randomDelay(500, 1000);
                } catch (clearError) {
                  console.log(`Could not clear clipboard: ${clearError.message}`);
                }
                
                // Click the "Copy link to post" button
                console.log('Clicking "Copy link to post" button...');
                await item.click();
                
                // Wait longer for LinkedIn to copy to clipboard
                await this.randomDelay(2000, 3000);
                
                // Try multiple methods to read from clipboard
                try {
                  originalPostUrl = await this.page.evaluate(async () => {
                    // Method 1: Standard clipboard API
                    if (navigator.clipboard && navigator.clipboard.readText) {
                      try {
                        const clipboardText = await navigator.clipboard.readText();
                        if (clipboardText && clipboardText.trim() && clipboardText !== 'CLEARED') {
                          return clipboardText.trim();
                        }
                      } catch (e) {
                        console.log('Method 1 failed:', e.message);
                      }
                    }
                    
                    // Method 2: Try execCommand (fallback)
                    try {
                      const textArea = document.createElement('textarea');
                      textArea.style.position = 'fixed';
                      textArea.style.opacity = '0';
                      document.body.appendChild(textArea);
                      textArea.focus();
                      document.execCommand('paste');
                      const pastedText = textArea.value;
                      document.body.removeChild(textArea);
                      if (pastedText && pastedText.trim() && pastedText !== 'CLEARED') {
                        return pastedText.trim();
                      }
                    } catch (e) {
                      console.log('Method 2 failed:', e.message);
                    }
                    
                    return null;
                  });
                  
                  if (originalPostUrl && originalPostUrl.includes('/posts/')) {
                    console.log(`✓ Successfully extracted original post URL: ${originalPostUrl}`);
                    break;
                  } else {
                    console.log(`Clipboard content was: "${originalPostUrl}" - not a valid post URL`);
                  }
                } catch (clipboardError) {
                  console.log(`All clipboard methods failed: ${clipboardError.message}`);
                }
              }
            } catch (itemError) {
              console.log(`Error with dropdown item: ${itemError.message}`);
            }
          }
        }
      } catch (error) {
        console.log(`Error finding dropdown menu: ${error.message}`);
      }
      
      // Close the dropdown by clicking elsewhere or pressing Escape
      try {
        await this.page.keyboard.press('Escape');
        await this.randomDelay(500, 1000);
      } catch (error) {
        try {
          await this.page.click('body');
          await this.randomDelay(500, 1000);
        } catch (closeError) {
          // Ignore close errors
        }
      }
      
      return originalPostUrl;
      
    } catch (error) {
      console.warn(`Error extracting original URL from menu: ${error.message}`);
      return null;
    }
  }

  async extractPostData(postElement) {
    try {
      // Strategy 1: Try to get URL directly from DOM (faster)
      let originalPostUrl = await this.getOriginalPostUrlFromDOM(postElement);
      
      // Strategy 2: If DOM approach failed, try clipboard method (slower but more accurate)
      if (!originalPostUrl && this.realUrlsExtracted < 10) { // Limit clipboard attempts to first 10 posts
        console.log('DOM extraction failed, trying clipboard method...');
        originalPostUrl = await this.getOriginalPostUrlFromMenu(postElement);
      }
      
      if (originalPostUrl) {
        this.realUrlsExtracted++;
        console.log(`✓ Extracted real URL ${this.realUrlsExtracted}: ${originalPostUrl}`);
      }
      
      const data = await postElement.evaluate((element) => {
        // Extract activityId from various sources based on actual structure
        let activityId = null;
        
        // Strategy 1: From data-chameleon-result-urn attribute
        const chameleonElement = element.querySelector('[data-chameleon-result-urn*="activity:"]');
        if (chameleonElement) {
          const urn = chameleonElement.getAttribute('data-chameleon-result-urn');
          const match = urn.match(/activity:(\d+)/);
          if (match) activityId = match[1];
        }
        
        // Strategy 2: From feed update link href
        if (!activityId) {
          const linkElement = element.querySelector('a[href*="/feed/update/urn:li:activity:"]');
          if (linkElement) {
            const href = linkElement.getAttribute('href');
            const match = href.match(/activity:(\d+)/);
            if (match) activityId = match[1];
          }
        }
        
        // Strategy 3: From any href containing activity
        if (!activityId) {
          const allLinks = element.querySelectorAll('a[href*="activity"]');
          for (const link of allLinks) {
            const href = link.getAttribute('href');
            const match = href.match(/activity:(\d{19})/); // LinkedIn activity IDs are typically 19 digits
            if (match) {
              activityId = match[1];
              break;
            }
          }
        }
        
        if (!activityId) return null;
        
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
          activityId,
          author,
          snippet
        };
      });
      
      // Add the real original URL if we found it, otherwise create a fallback URL
      if (data) {
        if (originalPostUrl) {
          data.originalPostUrl = originalPostUrl;
        } else {
          // Fallback: create a LinkedIn post URL with proper format that might work
          // LinkedIn sometimes redirects these generic activity URLs to the proper post
          console.log(`Could not extract real URL for post ${data.activityId}, using fallback URL`);
          data.originalPostUrl = `https://www.linkedin.com/feed/update/urn:li:activity:${data.activityId}`;
        }
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

  async scrollAndExtractPosts() {
    console.log('Starting post extraction with hybrid pagination handling...');
    const startTime = Date.now();
    const maxTime = this.maxTimeMinutes * 60 * 1000;
    let idleRounds = 0;
    let lastPostCount = 0;
    
    while (idleRounds < this.maxIdleRounds && (Date.now() - startTime) < maxTime) {
      // Expand "See more" buttons for individual posts before extracting
      await this.expandSeeMore();
      
      // Get all saved post elements based on actual LinkedIn structure
      const postSelectors = [
        '.EEMHJwgiaepGoaANgOiExBohJpfRvkAjJV', // Individual saved post items
        '[data-chameleon-result-urn*="activity"]', // Items with activity URN
        '.entity-result__content-container', // Content containers
        'li[class*="EEMHJwgiaepGoaANgOiExBohJpfRvkAjJV"]'
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
        console.log('No new posts found since last check...');
        
        // Strategy 1: Try clicking "Show more results" button first
        console.log('Strategy 1: Looking for "Show more results" button...');
        const clickedShowMore = await this.clickShowMoreResults();
        if (clickedShowMore) {
          console.log('✓ Successfully clicked "Show more results", continuing extraction...');
          // Don't increment idle counter, continue immediately
          continue;
        }
        
        // Strategy 2: Try aggressive scrolling for lazy loading
        console.log('Strategy 2: Trying aggressive scrolling for lazy loading...');
        await this.page.evaluate(() => {
          // Scroll to bottom multiple times with different approaches
          const scrollHeight = Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight
          );
          
          // Main window scroll
          window.scrollTo(0, scrollHeight);
          
          // Find and scroll the main content containers
          const containers = [
            '.scaffold-finite-scroll__content',
            '.workflow-results-container', 
            'main[role="main"]',
            '.feed-container',
            '.application-outlet'
          ];
          
          containers.forEach(selector => {
            const container = document.querySelector(selector);
            if (container) {
              container.scrollTop = container.scrollHeight;
            }
          });
        });
        
        // Wait for lazy loading to potentially trigger
        await this.randomDelay(3000, 5000);
        
        // Strategy 3: Try scrolling up and down to trigger intersection observers
        console.log('Strategy 3: Triggering intersection observers...');
        await this.page.evaluate(() => {
          // Scroll up a bit, then back down (triggers intersection observers)
          window.scrollBy(0, -200);
          setTimeout(() => {
            window.scrollTo(0, document.body.scrollHeight);
          }, 500);
        });
        
        await this.randomDelay(2000, 3000);
        
        // Check one more time for the "Show more" button after scrolling
        console.log('Final check: Looking for "Show more results" button after scrolling...');
        const finalClickCheck = await this.clickShowMoreResults();
        if (finalClickCheck) {
          console.log('✓ Found and clicked "Show more results" button after scrolling!');
          continue; // Don't increment idle counter
        }
        
        // If all strategies failed, increment idle counter
        idleRounds++;
        console.log(`All loading strategies failed. Idle round ${idleRounds}/${this.maxIdleRounds}`);
      } else {
        // Found new posts, reset idle counter
        idleRounds = 0;
        lastPostCount = currentPostCount;
        console.log(`✓ Found ${currentPostCount - lastPostCount} new posts! Continuing...`);
      }
      
      // Always do a gentle scroll at the end (helps with lazy loading detection)
      await this.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      
      // Shorter delay between actions since we already waited above
      await this.randomDelay(500, 1000);
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