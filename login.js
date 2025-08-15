import puppeteer from 'puppeteer';
import dotenv from 'dotenv';

dotenv.config();

async function setupLinkedInSession() {
  console.log('Setting up LinkedIn session...');
  console.log('This will open a browser window for you to log into LinkedIn manually.');
  console.log('After logging in, the session will be saved for future use.');
  
  const browser = await puppeteer.launch({
    headless: false, // Always visible for login
    userDataDir: './browser-profile', // Same directory as main script
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ],
  });

  const page = await browser.newPage();
  
  // Set realistic user agent and viewport
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1920, height: 1080 });

  console.log('Opening LinkedIn login page...');
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

  console.log('\n=== INSTRUCTIONS ===');
  console.log('1. Log into LinkedIn in the browser window that opened');
  console.log('2. Complete any 2FA/verification if prompted');
  console.log('3. Make sure you reach your LinkedIn feed/homepage');
  console.log('4. This script will automatically detect when you\'re logged in...');
  console.log('==================\n');

  // Wait for successful login by checking URL changes
  let loginSuccessful = false;
  let attempts = 0;
  const maxAttempts = 60; // Wait up to 60 * 5 = 300 seconds (5 minutes)
  
  while (!loginSuccessful && attempts < maxAttempts) {
    try {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5 seconds
      
      const currentUrl = page.url();
      console.log(`Checking login status... (${attempts + 1}/${maxAttempts})`);
      
      if (!currentUrl.includes('/login') && !currentUrl.includes('/challenge') && 
          (currentUrl.includes('/feed') || currentUrl.includes('/mynetwork') || currentUrl.includes('linkedin.com'))) {
        loginSuccessful = true;
        console.log('✅ Login detected!');
      }
      
      attempts++;
    } catch (error) {
      attempts++;
    }
  }
  
  if (!loginSuccessful) {
    console.log('❌ Login timeout. Please try again.');
    await browser.close();
    return;
  }

  // Verify login worked
  try {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 10000 });
    
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/challenge')) {
      console.log('❌ Login verification failed. Please try again.');
    } else {
      console.log('✅ Login successful! Session has been saved.');
      console.log('You can now run the main script without needing to provide li_at cookies.');
      
      // Extract and display the li_at cookie for reference
      const cookies = await page.cookies();
      const liAtCookie = cookies.find(cookie => cookie.name === 'li_at');
      if (liAtCookie) {
        console.log('\n📋 For reference, your li_at cookie is:');
        console.log(`LI_AT=${liAtCookie.value}`);
        console.log('(This has been automatically saved to the browser profile)\n');
      }
    }
  } catch (error) {
    console.log('❌ Could not verify login. Please try running the script again.');
  }

  await browser.close();
  console.log('Setup complete! You can now run "npm start" to export your saved posts.');
}

setupLinkedInSession().catch(console.error);