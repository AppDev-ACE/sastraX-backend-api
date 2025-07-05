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
    await page.goto("https://webstream.sastra.edu/sastrapwi/usermanager/home.jsp");
    await page.waitForSelector('img[alt="Photo not found"]');
    const profileData = await page.evaluate(() => {
      const name = document.querySelectorAll('.profile-text-bold')[0]?.innerText.trim();
      const regNo = document.querySelectorAll('.profile-text')[0]?.innerText.trim();
      const department = document.querySelectorAll('.profile-text')[1]?.innerText.trim();
      const semester = document.querySelectorAll('.profile-text')[2]?.innerText.trim();

      return {
        name,
        regNo,
        department,
        semester,
      };
    });
    res.json({success: true,profileData});
});

// To fetch profile picture
app.get('/profilePic', async(req, res) => {
    await page.goto("https://webstream.sastra.edu/sastrapwi/usermanager/home.jsp");
    await page.waitForSelector('img[alt="Photo not found"]');
    await new Promise(resolve => setTimeout(resolve, 1500));

    const profilePath = path.join(__dirname, 'profile.png');
    const profileElement = await page.$('img[alt="Photo not found"]');
    await profileElement.screenshot({ path: profilePath });

    res.sendFile(profilePath);
})

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

// To fetch semester-wise grades & credits
app.get('/semGrades', async (req,res) => {
    try
    {
      await page.goto("https://webstream.sastra.edu/sastrapwi/resource/StudentDetailsResources.jsp?resourceid=28");
      const gradeData = await page.evaluate(() => {
        const table = document.querySelector("table");
        if (!table)
          return "No records found";
        const tbody = table.querySelector("tbody");
        const rows = Array.from(tbody.getElementsByTagName("tr"));
        const gradeCredit = [];
        for (let i=2;i<rows.length-1;i++)
        {
          const columns = rows[i].getElementsByTagName("td");
          gradeCredit.push({
            sem : columns[0]?.innerText?.trim(),
            monthYear : columns[1]?.innerText?.trim(),
            code : columns[2]?.innerText?.trim(),
            subject : columns[3]?.innerText?.trim(),
            credit : columns[5]?.innerText?.trim(),
            grade : columns[6]?.innerText?.trim()
          });
        }
        return gradeCredit;
      })
      return res.json({ success: true, gradeData});
    }
    catch(error)
    {
      res.status(500).json({ sucess:false, message: "Failed to fetch sem-wise grades", error: error.message });
    }
});

//To fetch status of student (Hosteler/Dayscholar)
app.get('/studentStatus', async(req,res) => {
    try
    {
      await page.goto("https://webstream.sastra.edu/sastrapwi/resource/StudentDetailsResources.jsp?resourceid=59");
      const statusData = await page.evaluate(() => {
        const table = document.querySelector("table");
        if (!table)
          return "No records Found";
        const tbody = table.querySelector("tbody");
        const rows = Array.from(tbody.getElementsByTagName("tr"));
        const status =[];
        for (let i=0;i<rows.length;i++)
        {
          const coloumns = rows[i].getElementsByTagName("td");
          if (i==9)
          {
            status.push({
              status : coloumns[1]?.innerText?.trim(),
            })
          }
        }
        return status;
      })
      return res.json({ sucsess: true, statusData});
    }
    catch(error)
    {
      res.status(500).json({ sucess:false, message: "Failed to fetch student status", error: error.message });
    }
});

// To fetch each sem SGPA
app.get('/sgpa', async(req,res) => {
    try
    {
      await page.goto("https://webstream.sastra.edu/sastrapwi/resource/StudentDetailsResources.jsp?resourceid=28");
      const sgpaData = await page.evaluate(() => {
        const table = document.querySelector('table[align="left"]');
        if (!table)
          return "No records found";
        const tbody = table.querySelector("tbody");
        const rows = Array.from(tbody.getElementsByTagName("tr"));
        const sgpa = [];
        for (let i=2;i<rows.length;i++)
        {
          const columns = rows[i].getElementsByTagName("td");
          sgpa.push({
            sem : columns[0]?.innerText?.trim(),
            sgpa : columns[1]?.innerText?.trim()
          });
        }
        return sgpa;
      })
      return res.json({ success: true, sgpaData});
    }
    catch (error)
    {
      res.status(500).json({ success: false, meassage: "Failed to fetch SGPA", error: error.meassage });
    }
});

// To fetch overall CGPA
app.get('/cgpa', async(req,res) => {
    try
    {
      await page.goto("https://webstream.sastra.edu/sastrapwi/resource/StudentDetailsResources.jsp?resourceid=28");
      const cgpaData = await page.evaluate(() => {
        const table = document.querySelector('table');
        if (!table)
          return "No records found";
        const tbody = table.querySelector("tbody");
        const rows = Array.from(tbody.getElementsByTagName("tr"));
        const cgpa = [];
        for (let i=0;i<rows.length;i++)
        {
          const columns = rows[i].getElementsByTagName("td");
          if (columns[0]?.innerText?.trim() === "CGPA")
            cgpa.push({
              cgpa : columns[1]?.innerText?.trim()
            });
        }
        return cgpa;
      })
      return res.json({ success: true, cgpaData});
    }
    catch (error)
    {
      res.status(500).json({ success: false, meassage: "Failed to fetch CGPA", error: error.meassage });
    }
});

// To fetch depatment-wise PYQs
app.get('/pyq', async(req,res) => {
    return res.json([
      {
        dept : "cse-aids",
        url : "https://drive.google.com/drive/folders/1_HOFZaJmBZOP43EShPrnPcrqMYMn3kTO"
      },
      {
        dept : "cse-core",
        url : "https://drive.google.com/drive/folders/1Zz_D31EafQG5pb7nrpl2cGOGy5KjpS-K"
      }, 
      {
        dept : "cse-iota",
        url : "https://drive.google.com/drive/folders/1Zsmed8gEvxJO2lY3ABWkruV0P1TZN-wD"
      }, 
      {
        dept : "cse-ict",
        url : "https://drive.google.com/drive/folders/12mZUxxoREu80Xd6KxWIRkDlq6wirO_Aa"
      },
      {
        dept : "ece",
        url : "https://drive.google.com/drive/folders/14ZcBJmmDN5fBGbAYg7T7lIUVjIox7oBi"
      },
      {
        dept : "eee",
        url : "https://drive.google.com/drive/u/0/folders/1ip6SUn3dqvW0ELpxwsEVJMPD4mQ8g7Jj"
      },
      {
        dept : "eee-sgev",
        url : "https://drive.google.com/drive/folders/1mR24zrsWJt_8T8H1EmhbGG0kdFC-qReh"
      },
      {
        dept : "mechanical-dm",
        url : "https://drive.google.com/drive/folders/1CayvomN4rpZBfuPau31JHzxUqKuRuBtJ"
      },
      {
        dept : "mechanical",
        url : "https://drive.google.com/drive/folders/1ANgc0gyCdwLrVEjirxkguA8f7azEL6PU"
      },
    ]);
});

// To fetch mess menu
app.get('/messMenu', async (req,res) => {
    return res.json([
      //Week 1
      {
        week : "1",
        day : "Monday",
        breakfast : ["Dosa","Vadacurry","Chutney","BBJ"],
        lunch : ["Chappathi","Channa Masala","White Rice","Onion Drumstick Sambar","Potato Poriyal","Karamani Poriyal","Tomato Rasam","Curd","Fryums","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Peanut Sundal"],
        dinner: ["Chappathi","Mix Veg Gravy","Brinji Rice","Raitha","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "1",
        day : "Tuesday",
        breakfast : ["Pongal","Sambar","Cocunut Chutney","Medhu Vada(1)","Oats & Milk"],
        lunch : ["Chappathi","Dhall Fry","White Rice","Bindi Karakuzhambu","Raw Banana Poriyal","Spinach Kootu","Malli Rasam","Curd","Appalam","Pickle"],
        snacks: ["Tea, Milk and Coffee","Veg Puff"],
        dinner: ["Idly","Sambar","Coconut Chutney","Bisebelabath","Curd Rice","Fryums","Pickle","Banana (1 No)"] 
      },
      {
        week : "1",
        day : "Wednesday",
        breakfast : ["Sevai(Coconut/Tomato)","Sambar","Coconut Chutney","Ragi Koozhu","Curd Chilly","BBJ"],
        lunch : ["Chappathi","Aloo Capsicum Masala","White Rice","Sambar","Carrot Poriyal","Bonda (1 No)","Mysore Rasam","Curd","Fryums","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Coconut Mango Peas Sundal"],
        dinner: ["Butter Chappathi","Kadai Veg Gravy","Sambar Rice","Potato Poriyal","Curd Rice","Pickle","Fryums","Banana (1 No)"] 
      },
      {
        week : "1",
        day : "Thursday",
        breakfast : ["Vegetable Rava Kichadi","Sambar","Cocunut Chutney","Masala Vada(1)"],
        lunch : ["Chappathi","White Channa Kuruma","White Rice","Vathakuzhambu","Yam 65","Chow Chow Kootu","Garlic Rasam","Curd","Appalam","Pickle"],
        snacks: ["Tea, Milk and Coffee","Cutlet"],
        dinner: ["Dosa","Sambar/Chutney","Rasam Rice","Curd Rice","Lemon Juice","Pickle","Banana (1 No)"] 
      },
      {
        week : "1",
        day : "Friday",
        breakfast : ["Uthappam","Sambar","Kara Chutney","Podi with Oil"],
        lunch : ["Chappathi","Paneer Butter Masala","White Rice","Pumpkin Morekuzhambu","Beetroot Channa Poriyal","Cabbage Peas Poriyal","Pineapple Rasam","Curd","Fryums","Pickle","Jangiri","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Mixture/Karasev"],
        dinner: ["Chappathi","Black Channa Masala","Tomato Rice","Raitha","Curd Rice","Pickle","Fryums","Banana (1 No)"] 
      },
      {
        week : "1",
        day : "Saturday",
        breakfast : ["Idly","Sambar","Tomato Chutney","Podi with Oil"],
        lunch : ["Chappathi","Green Peas Masala","White Rice","Spinach Sambar","Beans Usili","Aviyal","Dhall Rasam","Curd","Appalam","Pickle"],
        snacks: ["Tea, Milk and Coffee","Green Moongdal Sundal"],
        dinner: ["Chappathi","White Kuruma","Coconut Rice","Potato Kara Curry","Curd Rice","Fryums","Pickle","Banana (1 No)"] 
      },
      {
        week : "1",
        day : "Sunday",
        breakfast : ["Vermicelli Upma","Sambar","Coconut Chutney","Medhu Vada(1)","BBJ"],
        lunch : ["Aloo Paratha","Hyderabad Veg Biriyani","Boondhi Raitha","White Rice","Dhall","Rasam","Buttermilk","Appalam","Pickle","Icecream"],
        snacks: ["Tea, Milk and Coffee","Bhel Puri/Samosa"],
        dinner: ["Sambarava Upma","Sambar","Peanut Chutney","Uthappam","Curd Rice","Pickle","Banana (1 No)"] 
      },

      //Week 2
      {
        week : "2",
        day : "Monday",
        breakfast : ["Raagi Dosa","Drumstick Sambar","Tomato Chutney","Cornflakes & Hot Milk"],
        lunch : ["Chappathi","Dhall Tadka","White Rice","Sundavathal Karakuzhambu","Raw Banana Poriyal","Spinach Kootu","Tomato Rasam","Curd","Appalam","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Peanut Sundal"],
        dinner: ["Chappathi","Aloo Mutter Masala","Rava Upma","Sambar","Coconut Chutney","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "2",
        day : "Tuesday",
        breakfast : ["Idly","Carrot Beans Sambar","Peanut Chutney","Podi with Oil","BBJ"],
        lunch : ["Chappathi","White Kuruma","White Rice","Raddish Sambar","Cabbage Peas Poriyal","Masala Vada","Dhall Rasam","Curd","Fryums","Pickle"],
        snacks: ["Tea, Milk and Coffee","Spinach Vada/Chilly Bajji"],
        dinner: ["Dosa","Sambar","Coriander Chutney","Malli Rice","Thuvaiyal","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "2",
        day : "Wednesday",
        breakfast : ["Sevai(Lemon/Tamarind)","Sambar","Coconut Chutney","Ragi Koozhu","Curd Chilly","Masala Vada"],
        lunch : ["Chappathi","Palak Paneer","White Rice","Ladies Finger Morekuzhambu","Yam Channa Poriyal","Tindly Kara Curry","Malli Rasam","Curd","Appalam","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Milk Bikies"],
        dinner: ["Veg Biriyani","Onion Raitha","Potato Chips","Rasam Rice","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "2",
        day : "Thursday",
        breakfast : ["Mix Veg Uthappam","Small Onion Sambar","Kara Chutney","Podi with Oil","BBJ"],
        lunch : ["Chappathi","Rajma Masala","White Rice","Mix Veg Sambar","Aloo 65","Podalanga Kootu","Mysore Rasam","Curd","Fryums","Pickle"],
        snacks: ["Tea, Milk and Coffee","White Channa Sundal"],
        dinner: ["Chappathi","Veg Kuruma","Sambar Rice","Potato Poriyal","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "2",
        day : "Friday",
        breakfast : ["Poha","Sambar","Coconut Chutney","Medhu Vada(1)"],
        lunch : ["Chappathi","Veg Salna","White Rice","Spinach Kuzhambu","Beans Usili","Aviyal","Lemon Rasam","Curd","Fryums","Pickle","Pineapple Kesari"],
        snacks: ["Tea, Milk and Coffee","Millet Snacks"],
        dinner: ["Onion Uthappam","Sambar","Malli Chutney","Rasam Rice","Thuvaiyal","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "2",
        day : "Saturday",
        breakfast : ["Pongal","Tiffin Sambar","Cocunut Chutney","Medhu Vada(1)","BBJ"],
        lunch : ["Chappathi","Green Peas Masala","White Rice","Onion Sambar","Beetrrot Channa Poriyal","Carrot Coconut Poriyal","Garlic Rasam","Curd","Fryums","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Coconut Mango Peas Sundal"],
        dinner: ["Maggi Noodles","Tomato Sauce","Brinji Rice","Raitha","Curd Rice","Pickle","Fryums","Banana (1 No)"] 
      },
      {
        week : "2",
        day : "Sunday",
        breakfast : ["Poori","Aloo/Channa Masala"],
        lunch : ["Veg Fried Rice","Mix Veg Manchurian","White Rice","Dhall & Ghee","Aloo Kara Curry","Tomato Rasam","Buttermilk","Appalam","Pickle","Vermicelli Payasam/Fruit Salad"],
        snacks: ["Tea, Milk and Coffee","Cream Bun"],
        dinner: ["Idly","Sambar","Coconut Chutney","Chappathi","Mix Veg Gravy","Curd Rice","Pickle","Fryums","Banana (1 No)"] 
      },

      //Week 3
      {
        week : "3",
        day : "Monday",
        breakfast : ["Dosa","Vadacurry","Chutney","BBJ"],
        lunch : ["Chappathi","Channa Masala","White Rice","Onion Drumstick Sambar","Potato Poriyal","Karamani Poriyal","Tomato Rasam","Curd","Fryums","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Peanut Sundal"],
        dinner: ["Chappathi","Mix Veg Gravy","Brinji Rice","Raitha","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "3",
        day : "Tuesday",
        breakfast : ["Pongal","Sambar","Cocunut Chutney","Medhu Vada(1)","Oats & Milk"],
        lunch : ["Chappathi","Dhall Fry","White Rice","Bindi Karakuzhambu","Raw Banana Poriyal","Spinach Kootu","Malli Rasam","Curd","Appalam","Pickle"],
        snacks: ["Tea, Milk and Coffee","Veg Puff"],
        dinner: ["Idly","Sambar","Coconut Chutney","Bisebelabath","Curd Rice","Fryums","Pickle","Banana (1 No)"] 
      },
      {
        week : "3",
        day : "Wednesday",
        breakfast : ["Sevai(Coconut/Tomato)","Sambar","Coconut Chutney","Ragi Koozhu","Curd Chilly","BBJ"],
        lunch : ["Chappathi","Aloo Capsicum Masala","White Rice","Sambar","Carrot Poriyal","Bonda (1 No)","Mysore Rasam","Curd","Fryums","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Coconut Mango Peas Sundal"],
        dinner: ["Butter Chappathi","Kadai Veg Gravy","Sambar Rice","Potato Poriyal","Curd Rice","Pickle","Fryums","Banana (1 No)"] 
      },
      {
        week : "3",
        day : "Thursday",
        breakfast : ["Vegetable Rava Kichadi","Sambar","Cocunut Chutney","Masala Vada(1)"],
        lunch : ["Chappathi","White Channa Kuruma","White Rice","Vathakuzhambu","Yam 65","Chow Chow Kootu","Garlic Rasam","Curd","Appalam","Pickle"],
        snacks: ["Tea, Milk and Coffee","Cutlet"],
        dinner: ["Dosa","Sambar/Chutney","Rasam Rice","Curd Rice","Lemon Juice","Pickle","Banana (1 No)"] 
      },
      {
        week : "3",
        day : "Friday",
        breakfast : ["Uthappam","Sambar","Kara Chutney","Podi with Oil"],
        lunch : ["Chappathi","Paneer Butter Masala","White Rice","Pumpkin Morekuzhambu","Beetroot Channa Poriyal","Cabbage Peas Poriyal","Pineapple Rasam","Curd","Fryums","Pickle","Jangiri","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Mixture/Karasev"],
        dinner: ["Chappathi","Black Channa Masala","Tomato Rice","Raitha","Curd Rice","Pickle","Fryums","Banana (1 No)"] 
      },
      {
        week : "3",
        day : "Saturday",
        breakfast : ["Idly","Sambar","Tomato Chutney","Podi with Oil"],
        lunch : ["Chappathi","Green Peas Masala","White Rice","Spinach Sambar","Beans Usili","Aviyal","Dhall Rasam","Curd","Appalam","Pickle"],
        snacks: ["Tea, Milk and Coffee","Green Moongdal Sundal"],
        dinner: ["Chappathi","White Kuruma","Coconut Rice","Potato Kara Curry","Curd Rice","Fryums","Pickle","Banana (1 No)"] 
      },
      {
        week : "3",
        day : "Sunday",
        breakfast : ["Vermicelli Upma","Sambar","Coconut Chutney","Medhu Vada(1)","BBJ"],
        lunch : ["Aloo Paratha","Hyderabad Veg Biriyani","Boondhi Raitha","White Rice","Dhall","Rasam","Buttermilk","Appalam","Pickle","Icecream"],
        snacks: ["Tea, Milk and Coffee","Bhel Puri/Samosa"],
        dinner: ["Sambarava Upma","Sambar","Peanut Chutney","Uthappam","Curd Rice","Pickle","Banana (1 No)"] 
      },

      //Week 4
      {
        week : "4",
        day : "Monday",
        breakfast : ["Raagi Dosa","Drumstick Sambar","Tomato Chutney","Cornflakes & Hot Milk"],
        lunch : ["Chappathi","Dhall Tadka","White Rice","Sundavathal Karakuzhambu","Raw Banana Poriyal","Spinach Kootu","Tomato Rasam","Curd","Appalam","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Peanut Sundal"],
        dinner: ["Chappathi","Aloo Mutter Masala","Rava Upma","Sambar","Coconut Chutney","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "4",
        day : "Tuesday",
        breakfast : ["Idly","Carrot Beans Sambar","Peanut Chutney","Podi with Oil","BBJ"],
        lunch : ["Chappathi","White Kuruma","White Rice","Raddish Sambar","Cabbage Peas Poriyal","Masala Vada","Dhall Rasam","Curd","Fryums","Pickle"],
        snacks: ["Tea, Milk and Coffee","Spinach Vada/Chilly Bajji"],
        dinner: ["Dosa","Sambar","Coriander Chutney","Malli Rice","Thuvaiyal","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "4",
        day : "Wednesday",
        breakfast : ["Sevai(Lemon/Tamarind)","Sambar","Coconut Chutney","Ragi Koozhu","Curd Chilly","Masala Vada"],
        lunch : ["Chappathi","Palak Paneer","White Rice","Ladies Finger Morekuzhambu","Yam Channa Poriyal","Tindly Kara Curry","Malli Rasam","Curd","Appalam","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Milk Bikies"],
        dinner: ["Veg Biriyani","Onion Raitha","Potato Chips","Rasam Rice","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "4",
        day : "Thursday",
        breakfast : ["Mix Veg Uthappam","Small Onion Sambar","Kara Chutney","Podi with Oil","BBJ"],
        lunch : ["Chappathi","Rajma Masala","White Rice","Mix Veg Sambar","Aloo 65","Podalanga Kootu","Mysore Rasam","Curd","Fryums","Pickle"],
        snacks: ["Tea, Milk and Coffee","White Channa Sundal"],
        dinner: ["Chappathi","Veg Kuruma","Sambar Rice","Potato Poriyal","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "4",
        day : "Friday",
        breakfast : ["Poha","Sambar","Coconut Chutney","Medhu Vada(1)"],
        lunch : ["Chappathi","Veg Salna","White Rice","Spinach Kuzhambu","Beans Usili","Aviyal","Lemon Rasam","Curd","Fryums","Pickle","Pineapple Kesari"],
        snacks: ["Tea, Milk and Coffee","Millet Snacks"],
        dinner: ["Onion Uthappam","Sambar","Malli Chutney","Rasam Rice","Thuvaiyal","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "4",
        day : "Saturday",
        breakfast : ["Pongal","Tiffin Sambar","Cocunut Chutney","Medhu Vada(1)","BBJ"],
        lunch : ["Chappathi","Green Peas Masala","White Rice","Onion Sambar","Beetrrot Channa Poriyal","Carrot Coconut Poriyal","Garlic Rasam","Curd","Fryums","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Coconut Mango Peas Sundal"],
        dinner: ["Maggi Noodles","Tomato Sauce","Brinji Rice","Raitha","Curd Rice","Pickle","Fryums","Banana (1 No)"] 
      },
      {
        week : "4",
        day : "Sunday",
        breakfast : ["Poori","Aloo/Channa Masala"],
        lunch : ["Veg Fried Rice","Mix Veg Manchurian","White Rice","Dhall & Ghee","Aloo Kara Curry","Tomato Rasam","Buttermilk","Appalam","Pickle","Vermicelli Payasam/Fruit Salad"],
        snacks: ["Tea, Milk and Coffee","Cream Bun"],
        dinner: ["Idly","Sambar","Coconut Chutney","Chappathi","Mix Veg Gravy","Curd Rice","Pickle","Fryums","Banana (1 No)"] 
      },
    ]);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API running at http://localhost:${PORT}`);
});