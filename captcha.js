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

    return res.json({ success: true, message: "Login successful!" });
});

// To fetch profile details
app.get('/profile', async (req, res) => {
  
  await page.waitForSelector('img[alt="Photo not found"]');

  // Extract details
    const profileData = await page.evaluate(() => {
    //const image = document.querySelector('img[alt="Photo not found"]')?.src;
    const name = document.querySelectorAll('.profile-text-bold')[0]?.innerText.trim();
    const regNo = document.querySelectorAll('.profile-text')[0]?.innerText.trim();
    const department = document.querySelectorAll('.profile-text')[1]?.innerText.trim();
    const semester = document.querySelectorAll('.profile-text')[2]?.innerText.trim();

    return {
      name,
      regNo,
      department,
      semester,
      //image
    };
  });
    res.json(profileData);
});

// To fetch attendance
app.get('/attendance',async (req,res) => {
    try
    {
      await page.goto("https://webstream.sastra.edu/sastrapwi/usermanager/home.jsp");
      await page.waitForSelector('#divAttendance', { timeout: 5000 });

      const attendanceHTML = await page.$eval("#divAttendance span", el => el.innerText);
      res.json({"success":true,attendanceHTML});
    }
    catch(error)
    {
      res.status(500).json({ success: false, message: "Failed to fetch attendance" });
    }
});

// To fetch SASTRA due
app.get('/sastraDue',async (req,res) => {
    try
    {
      await page.goto("https://webstream.sastra.edu/sastrapwi/accounts/Feedue.jsp?arg=1");
      const totalSastraDue = await page.evaluate(() => {
        const table = document.querySelector("table");
        if (!table)
            return "No records found";
        const tbody = table.querySelector("tbody"); 
        const rows = Array.from(tbody.getElementsByTagName("tr")); 
        for (const row of rows)
        {
          const columns = row.getElementsByTagName("td"); 
          if (columns[0].innerText === "Total :")
            return columns[1].innerText;
        }
      });
      res.json({ success: true, totalSastraDue });
    }
    catch(error)
    {
      res.status(500).json({ success: false, message: "Failed to fetch due amount", error: error.message });
    }
});

// To fetch Hostel due
app.get('/hostelDue',async (req,res) => {
    try
    {
      await page.goto("https://webstream.sastra.edu/sastrapwi/accounts/Feedue.jsp?arg=2");
      const totalHostelDue = await page.evaluate(() => {
        const table = document.querySelector("table");
        if (!table)
            return "No records found";
        const tbody = table.querySelector("tbody"); 
        const rows = Array.from(tbody.getElementsByTagName("tr")); 
        for (const row of rows)
        {
          const columns = row.getElementsByTagName("td"); 
          if (columns[0].innerText === "Total :")
            return columns[1]?.innerText || "No records found";
        }
      });
      res.json({ success: true, totalHostelDue });
    }
    catch(error)
    {
      res.status(500).json({ success: false, message: "Failed to fetch due amount", error: error.message });
    }
});

//Subject - wise Attendance
app.get('/subjectWiseAttendance',async (req,res) => {
    try
    {
      await page.goto("https://webstream.sastra.edu/sastrapwi/resource/StudentDetailsResources.jsp?resourceid=7");
      const subjectWiseAttendance = await page.evaluate(() => { 
        const table = document.querySelector("table");
        if (!table)
            return "No records found";
        const tbody = table.querySelector("tbody");
        const rows = Array.from(tbody.getElementsByTagName("tr"));
        const attendance = [];
        for (const row of rows)
        {
          const columns = row.getElementsByTagName("td"); 
          attendance.push({
              code: columns[0]?.innerText?.trim(),
              subject: columns[1]?.innerText?.trim(),
              totalHrs: columns[2]?.innerText?.trim(),
              presentHrs: columns[3]?.innerText?.trim(),
              absentHrs: columns[4]?.innerText?.trim(),
              percentage: columns[5]?.innerText?.trim()
          });
        }
        return attendance;
      });
      res.json({ success: true, subjectWiseAttendance });
    }
    catch(error)
    {
      res.status(500).json({ success: false, message: "Failed to fetch attendance", error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API running at http://localhost:${PORT}`);
});