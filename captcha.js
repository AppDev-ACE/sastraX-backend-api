const express = require('express');
const puppeteer = require('puppeteer'); // 👈 Changed from chrome-aws-lambda
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir);
}

app.use('/public', express.static(publicDir));

app.get('/getCaptcha', async (req, res) => {
  try {
    console.log('🚀 Launching Puppeteer...');
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // 👈 Required for Render
    });

    const page = await browser.newPage();
    console.log('🌐 Navigating to login page...');
    await page.goto('https://webstream.sastra.edu/sastrapwi/', {
      waitUntil: 'networkidle2',
    });

    const captchaSelector = '#imgCaptcha';
    console.log('⏳ Waiting for CAPTCHA image selector...');
    await page.waitForSelector(captchaSelector, { timeout: 10000 });
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const captchaElement = await page.$(captchaSelector);
    if (!captchaElement) {
      console.log('❌ CAPTCHA element not found after waiting.');
      await browser.close();
      return res.status(500).json({ error: 'CAPTCHA element not found' });
    }

    const screenshotPath = path.join(publicDir, 'captcha.png');
    await captchaElement.screenshot({ path: screenshotPath });

    await browser.close();
    console.log('✅ CAPTCHA screenshot saved.');

    res.json({
      captchaUrl: `https://${req.headers.host}/public/captcha.png?ts=${Date.now()}`
    });

  } catch (error) {
    console.error('❌ Error capturing CAPTCHA:', error);
    res.status(500).json({ error: 'Failed to capture CAPTCHA' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
