const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/captcha', async (req, res) => {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] //to host publicly
    });

    const page = await browser.newPage();
    await page.goto("https://webstream.sastra.edu/sastrapwi/");
    await new Promise(resolve => setTimeout(resolve, 1500));
    await page.waitForSelector('#imgCaptcha', { timeout: 5000 });
    const captchaPath = path.join(__dirname, 'captcha.png');
    const captchaElement = await page.$('#imgCaptcha');
    await captchaElement.screenshot({ path: captchaPath });

    await browser.close();
    res.sendFile(captchaPath);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API running at http://localhost:${PORT}`);
});