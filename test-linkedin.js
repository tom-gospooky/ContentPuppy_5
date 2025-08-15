import puppeteer from 'puppeteer';
import dotenv from 'dotenv';

dotenv.config();

async function testLinkedInAccess() {
  console.log('Testing LinkedIn access...');
  
  const browser = await puppeteer.launch({
    headless: false, // Always visible for testing
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Set user agent
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  
  try {
    console.log('Setting cookie...');
    await page.setCookie({
      name: 'li_at',
      value: process.env.LI_AT,
      domain: '.linkedin.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax'
    });
    
    console.log('Navigating to LinkedIn...');
    await page.goto('https://www.linkedin.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);
    
    if (currentUrl.includes('/login')) {
      console.log('❌ Redirected to login - cookie invalid');
    } else if (currentUrl.includes('chrome-error')) {
      console.log('❌ Page crashed - likely blocked by LinkedIn');
    } else {
      console.log('✅ Successfully accessed LinkedIn');
      
      // Try to take a screenshot
      await page.screenshot({ path: './out/linkedin-test.png' });
      console.log('Screenshot saved to ./out/linkedin-test.png');
      
      // Check page title
      const title = await page.title();
      console.log(`Page title: ${title}`);
    }
    
    console.log('Press any key to continue...');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', () => {
      console.log('Closing browser...');
      browser.close();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    await browser.close();
  }
}

testLinkedInAccess();