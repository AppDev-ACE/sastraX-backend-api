const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

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

// To fetch DOB
app.get('/dob', async(req,res) => {
    try
    {
      await page.goto("https://webstream.sastra.edu/sastrapwi/resource/StudentDetailsResources.jsp?resourceid=59");
      const dobData = await page.evaluate(() => {
        const table = document.querySelector("table");
        if (!table)
          return "No records Found";
        const tbody = table.querySelector("tbody");
        const rows = Array.from(tbody.getElementsByTagName("tr"));
        const dob =[];
        const coloumns = rows[2].getElementsByTagName("td");
        dob.push({
          dob : coloumns[1]?.innerText?.trim(),
        })
          
        return dob;
      })
      return res.json({ sucsess: true, dobData});
    }
    catch(error)
    {
      res.status(500).json({ sucess:false, message: "Failed to fetch DOB", error: error.message });
    }
});

// Chatbot
const subjectMap = {
  "co": "https://drive.google.com/drive/folders/12ilquRi9o9yy1RPaUjbcUP1yfCVWHf0_",
  "ds": "https://drive.google.com/drive/folders/12VT1DKfSzfzbw_IPQIHAB2v6fdJnnqCn",
  "dsd": "https://drive.google.com/drive/folders/16DZ4xjqVnMEixKJPlIEZOTXBMe73y_2e",
  "java": [
    "https://drive.google.com/drive/folders/12inzgU1MvrFL9s6MGw5xpkvGdWDf3QOv",
    "https://drive.google.com/drive/folders/195Xp_kCGThNAqPrTvQWyxAOP69fxgZXb"
  ],
  "m1": "https://drive.google.com/drive/folders/1-WAOXrd-ewtKutuo_jswsyKiathIHsr7",
  "m2": "https://drive.google.com/drive/folders/1-hwcJ6k6e5KZBEzzzaXAtKDb1CNeFA39",
  "m3": "https://drive.google.com/drive/folders/1-Hn0sJ7zsap2cKJ-cpNBOdKsO5QcRpEr",
  "m4": "https://drive.google.com/drive/folders/1YZ7dtwi3hdGXXWSiv2Df2_q8y7bqNB6t",
  "ca": "https://drive.google.com/drive/folders/1L4qKq23Wh6l8AkQDWPt5k6x--6in3YUF",
  "dbms": "https://drive.google.com/drive/folders/1K-ieRxpobolPF5yKl6xZ4fVvc_D3GGLJ",
  "daa": "https://drive.google.com/drive/folders/1G8dqGhGpZmr9ajppmJwb7hnJSJnHQ4lP",
  "discrete": "https://drive.google.com/drive/folders/15RXLBlh96OhvqbpsuvFCdLsDz6BH_PaI",
  "mcs": "https://drive.google.com/drive/folders/1avhovlxCuQxZ9Les6--znYB--gEZepSW",
  "ooad": "https://drive.google.com/drive/folders/1KBwL_u04TDmfKFtfdKvy5Qkt1jhfAU1T",
  "opengl": "https://drive.google.com/drive/folders/1acmL-qCeXSklo3bndCFVlzzRtP3u2B5V",
  "ai": "https://drive.google.com/drive/folders/1EwwQ5UQcVO8FRElD-BxoO8HabpyZje_o",
  "cn": "https://drive.google.com/drive/folders/10YFOPznNKCn4JGjzBYQgq4XVejDAy7Wo",
  "os": "https://drive.google.com/drive/folders/16ZTZiT5wcjJsSTe3CUugGsLCQu5ozciL",
  "toc": "https://drive.google.com/drive/folders/1cxEFVeqVQnIoitu5U3LTUw5pUJzmYJ8c",
  "aids": "https://drive.google.com/drive/folders/1-Z4Wom2FsMOmNMQmExlQ3eJtR9-hhDHt",
  "dwdm": "https://drive.google.com/drive/folders/1yNM44EK69V3H9uSGw5FdE7UpDWVsh0Ke",
  "eai": "https://drive.google.com/drive/folders/1_TEENtrs6GNSMbVjtmMV5ZNrTrwKC-aa",
  "mlt": "https://drive.google.com/drive/folders/1UUbErzkxgjhqynUdt5A7aIDHm035Jkpk",
  "time series": "https://drive.google.com/drive/folders/1__-5RqCvtOI6tjMO7pJwVjogBPgQtHh1",
  "bda": "https://drive.google.com/drive/folders/1i4BjVYWmPgv1E6lvgeZCvjGrGLgsQUNi",
  "dle": "https://drive.google.com/drive/folders/1-0-E0l_flHNww3rMwrNE0Cp-qeoHfEaC",
  "cns": "http://drive.google.com/drive/folders/1TMdhosfO3mQSjAUafDaaGguu__rjukhL",
  "compeng": "https://drive.google.com/drive/folders/1U_T8JThRL9KDBitNb2wuK_0Yb8NOct7y",
  "commeng": "https://drive.google.com/drive/folders/1BgPmU1YJFutzST8Cv5QiTbgX5J4H_keT",
  "gc": "https://drive.google.com/drive/folders/1UY9HO2zvEDtC4WkTBvePe-FCTUqQgoCw",
  "nlp": "https://drive.google.com/drive/folders/1BPkfod2sSszTWypImhjS1e30XqnTJY6s",
  "se": "https://drive.google.com/drive/folders/1mS9g6b-YzpB4uLhjXthptONcZm_glkyM",
  "cc": "https://drive.google.com/drive/folders/1i3tN__g9N4Hmv_q-oMLUnVeeVv51IB5i",
  "fswad": "https://drive.google.com/drive/folders/1iFjyCCUmgHLmrIvM58qMX_jcVni5rhtV",
  "iot": "https://drive.google.com/drive/folders/1CJzkMP6tRhuhMsC1gy38KB09nNHqNeA7",
  "ot": "https://drive.google.com/drive/folders/1GAoEohZco0eeKeKKHZeCds6_CU6QriyY",
  "pds": "https://drive.google.com/drive/folders/1xjVpvvHRzyNzOhKwZF3tsmOyZZTvinxZ",
  "sensors": "https://drive.google.com/drive/folders/1aAo03DfIX4uUOUXzz_0gFaoXXKNgOG7v",
  "ec": "https://drive.google.com/drive/folders/1a4ySfl4T5zvV4BjE8smhiwBMtEG4-6WM",
  "eie": "https://drive.google.com/drive/folders/19E0xCRx2WM3rMcVHLUdpRrOYktyGSJ59",
  "coa": "https://drive.google.com/drive/folders/1JvMEMQQp1DI_bk4XrTprgZHySn_YNaA_",
  "dcn": "https://drive.google.com/drive/folders/17KnsJA0f4VR7SPK1suLyxicqUEpSt21I",
  "ss": "https://drive.google.com/drive/folders/1328YXH_UeCqdMi1LJCxLtRLeohdimr-N"
};

const subjectAliasMap = {
  "computer organisation": "co",
  "computer organization": "co",
  "co": "co",

  "data structures": "ds",
  "ds": "ds",

  "digital system design": "dsd",
  "dsd": "dsd",

  "java": "java",
  "java programming": "java",
  "java language": "java",

  "engineering math 1": "m1",
  "math 1": "m1",
  "m1": "m1",

  "engineering math 2": "m2",
  "math 2": "m2",
  "m2": "m2",

  "engineering math 3": "m3",
  "math 3": "m3",
  "m3": "m3",

  "engineering math 4": "m4",
  "math 4": "m4",
  "m4": "m4",

  "computer architecture": "ca",
  "ca": "ca",

  "database management system": "dbms",
  "database": "dbms",
  "dbms": "dbms",

  "design and analysis of algorithm": "daa",
  "algorithms": "daa",
  "daa": "daa",

  "math for cyber security": "mcs",
  "mcs": "mcs",

  "object oriented analysis and design": "ooad",
  "ooad": "ooad",

  "computer graphics using opengl": "opengl",
  "graphics": "opengl",
  "opengl": "opengl",

  "artificial intelligence": "ai",
  "ai": "ai",

  "computer network": "cn",
  "computer networks": "cn",
  "cn": "cn",

  "operating system": "os",
  "os": "os",

  "theory of computation": "toc",
  "toc": "toc",

  "artificial intelligence and data science": "aids",
  "aids": "aids",

  "data warehouse and data mining": "dwdm",
  "dwdm": "dwdm",

  "explainable ai": "eai",
  "eai": "eai",

  "machine learning techniques": "mlt",
  "machine learning": "mlt",
  "ml": "mlt",
  "mlt": "mlt",

  "time series": "time series",
  "ts": "time series",

  "big data analytics": "bda",
  "bda": "bda",

  "deep learning essentials": "dle",
  "dle": "dle",

  "cryptography and network security": "cns",
  "cns": "cns",

  "compiler engineering": "compeng",
  "compiler design": "compeng",
  "comp eng": "compeng",
  "compeng": "compeng",

  "communication engineering": "commeng",
  "comm eng": "commeng",
  "commeng": "commeng",

  "green computing": "gc",
  "gc": "gc",

  "natural language processing": "nlp",
  "nlp": "nlp",

  "software engineering": "se",
  "se": "se",

  "cloud computing": "cc",
  "cc": "cc",

  "full stack application development": "fswad",
  "fswad": "fswad",

  "internet of things": "iot",
  "iot": "iot",

  "optimization techniques": "ot",
  "ot": "ot",

  "parallel and distributive system": "pds",
  "parallel & distributive system": "pds",
  "pds": "pds",

  "sensors and actuators": "sensors",
  "sensors": "sensors",

  "embedded computing": "ec",
  "ec": "ec",

  "electronic circuits": "eie",
  "eie": "eie",

  "computer organisation and architecture": "coa",
  "computer organization and architecture": "coa",
  "coa": "coa",

  "data communication and networks": "dcn",
  "data communication": "dcn",
  "dcn": "dcn",

  "signals and systems": "ss",
  "ss": "ss"
};

app.post('/chatbot', async(req,res) => {
    try
    {
        let { message } = req.body;
        if (!message)
          return res.json({ reply: "Say something to get started" });
        message = message.toLowerCase();
        let subjects = Object.keys(subjectAliasMap).sort((x,y) => y.length - x.length);
        const matchedKey = subjects.find((key) => message.includes(key))
        if (matchedKey)
        {
            const value = subjectAliasMap[matchedKey];
            if (matchedKey)
            {
              return res.json({ reply: "Here is your drive link for "+matchedKey+" PYQs. "+subjectMap[value]});
            }
            else
            {
              return res.json({ reply: "Sorry! I couldn't find any PYQs for your query" });
            }
        }
    }
    catch(error)
    {
        res.status(500).json({ success: true, message: "Chatbot Error", error: error.message});
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
admin.initializeApp({
  credential : admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
const menuData = [
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
    ];
app.get('/messMenu', async (req,res) => {
    try
    {
        const docRef = db.collection("cache").doc("messMenu");
        const doc = await docRef.get();
        await docRef.set({
          menu : menuData,
          lastUpdated : new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });
        return res.json(menuData);
    }
    catch(error)
    {
        res.status(500).json({ success: false, error: "Server error" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API running at http://localhost:${PORT}`);
});