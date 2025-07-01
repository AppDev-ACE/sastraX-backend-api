const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

let browser,page;

// To provide captcha to the UI
app.get('/captcha', async (req, res) => {

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] //to host publicly
    });

    page = await browser.newPage();
    await page.goto("https://webstream.sastra.edu/sastrapwi/");
    await new Promise(resolve => setTimeout(resolve, 1500));
    await page.waitForSelector('#imgCaptcha', { timeout: 5000 });

    const captchaPath = path.join(__dirname, 'captcha.png');
    const captchaElement = await page.$('#imgCaptcha');
    await captchaElement.screenshot({ path: captchaPath });

    res.sendFile(captchaPath);
});

// To get the reg no, password and captcha from the user and login
app.post('/login', async (req, res) => {
  const { regno, pwd, captcha } = req.body;

    await page.type("#txtRegNumber", regno);
    await page.type("#txtPwd", pwd);
    await page.type("#answer", captcha);

    await Promise.all([
      page.click('input[type="button"]'),
      page.waitForNavigation({ waitUntil: 'networkidle0' })
    ]);

    const loginFailed = await page.$('.ui-state-error');
    if (loginFailed) {
      const msg = await page.evaluate(el => el.textContent.trim(), loginFailed);
      await browser.close();
      return res.status(401).json({ success: false, message: msg });
    }

    //await browser.close();
    return res.json({ success: true, message: "Login successful!" });
});

app.get('/profile', async (req, res) => {
  
  try {
    
    // extract image URL
    const imageUrl = await page.evaluate(() => {
      const img = document.querySelector('img[src*="resource/Image/SImage"]');
      return img ? img.src : null;
    });

    if (!imageUrl) {
      return res.status(404).json({ success: false, message: 'Profile image not found' });
    }

    // Download the image
    const imagePage = await browser.newPage();
    const viewSource = await imagePage.goto(imageUrl);
    const buffer = await viewSource.buffer();

    // Return image as base64
    const base64Image = buffer.toString('base64');
    res.json({
      success: true,
      message: "Profile image retrieved",
      image: `data:image/jpeg;base64,${base64Image}`
    });

  } 
  catch (err) {
    console.error(' Error:', err);
    res.status(500).json({ error: 'Failed to retrieve or save image' });
  }
  
  finally {
    await browser.close();
  }
})

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API running at http://localhost:${PORT}`);
});