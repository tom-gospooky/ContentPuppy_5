# LinkedIn Saved Posts Exporter

Export all your saved LinkedIn posts to JSON format using Puppeteer with stealth capabilities.

## Setup

1. Install dependencies:
```bash
npm install
```

2. **Easy Setup** - Automatic login (Recommended):
```bash
npm run login
```
This will:
- Open a browser window
- Let you log into LinkedIn manually (including 2FA)
- Save your session for future use
- No need to copy/paste cookies!

3. **Alternative** - Manual cookie setup:
   - Open LinkedIn in your browser and log in
   - Open Developer Tools (F12)
   - Go to Application/Storage tab → Cookies → linkedin.com
   - Find the `li_at` cookie and copy its value
   - Update the `.env` file:

```env
LI_AT=your_li_at_cookie_value_here
```

## Configuration

Optional settings in `.env`:

- `MAX_IDLE_ROUNDS=5` - Stop after N rounds with no new posts (default: 5)
- `MAX_TIME_MINUTES=10` - Maximum runtime in minutes (default: 10)  
- `HEADLESS=true` - Run browser in headless mode (default: true)

## Usage

**First time:**
```bash
npm run login    # Set up your LinkedIn session
npm start        # Export your saved posts
```

**Subsequent runs:**
```bash
npm start        # Just run the export (uses saved session)
```

The script will automatically use your saved browser session, so you won't need to log in again!

## Output

The script will create a JSON file in `./out/` with the format:
```
linkedin_saved_posts_YYYY-MM-DDTHH-mm-ss.json
```

Output structure:
```json
{
  "exportedAt": "2025-08-13T20:41:58.502Z",
  "count": 10,
  "items": [
    {
      "activityId": "7360742711169019905",
      "postUrl": "https://www.linkedin.com/feed/update/urn:li:activity:7360742711169019905?updateEntityUrn=...",
      "originalPostUrl": "https://www.linkedin.com/posts/ACoAAB12PtkB_7360742711169019905_xxx",
      "alternativeUrl": "https://www.linkedin.com/posts/activity-7360742711169019905",
      "author": "Quentin Valembois",
      "snippet": "Niantic just brought their Spatial SDK to Meta Quest 3! Since the release of the passthrough camera API, developers now have real-time access to the headset's camera feed..."
    }
  ]
}
```

## Features

✅ **Desktop Mode**: Proper 1920x1080 viewport for LinkedIn desktop experience with lazy loading  
✅ **Authentication**: Secure authentication via `li_at` cookie  
✅ **Infinite Scroll**: Desktop lazy loading with idle detection and time limits  
✅ **Content Expansion**: Automatic "See more" expansion for truncated posts  
✅ **Multiple URL Formats**: Extract both feed URLs and generate original post URL formats  
✅ **Smart Extraction**: Multiple strategies for `activityId`, author, and content extraction  
✅ **Full Post Content**: Extract actual post content, not just author descriptions  
✅ **Deduplication**: Prevent duplicates by `activityId`  
✅ **Human-like Behavior**: Random delays (650-1250ms) between actions  
✅ **Configurable**: Stopping conditions (idle rounds, time cap) via environment variables  
✅ **Rich Export**: JSON export with timestamp, count, and comprehensive post data