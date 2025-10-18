require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const { v4: uuidv4 } = require('uuid'); 
const path = require('path');
const cors = require('cors');
const admin = require('firebase-admin');
const cloudinary = require('cloudinary').v2;

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: serviceAccount.project_id,
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key.replace(/\\n/g, '\n'),
  }),
});


const app = express();
app.use(cors());
app.use(express.json());

const db = admin.firestore();

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});


let browser;
(async () => {
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'], //to host publicly
  });
  console.log("Puppeteer launched, starting server...");
  app.listen(3000, () => console.log("Server running on port 3000"));
})();

// Store sessions in memory
const userSessions = {};
const pendingCaptcha = {};





// This route generates and returns the SASTRA portal captcha image by launching a new browser context,
// navigating to the login page, waiting for the captcha to load, taking a screenshot, storing the
// session (page + context) mapped to the user's regNo, and sending the image back as the response.

app.post('/captcha', async (req, res) => {
  if (!browser) 
    return res.status(503).json({ success: false, message: "Browser not ready" });

  const { regNo } = req.body;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  try {
    await page.goto("https://webstream.sastra.edu/sastrapwi/",{ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const img = document.querySelector('#imgCaptcha');
      return img && img.complete && img.naturalWidth > 0;
    }, { timeout: 15000 });

    const captchaPath = path.join(__dirname, 'captcha.png');
    const captchaElement = await page.$('#imgCaptcha');
    await captchaElement.screenshot({ path: captchaPath });

    pendingCaptcha[regNo] = { page, context };
    res.sendFile(captchaPath);
  } catch(err) {
    await context.close().catch(() => {});
    res.status(500).json({ success: false, message: "Failed to get captcha", error: err?.message || String(err) });
  }
});





// This route handles login by reusing the stored captcha session (page + context), 
// filling in the regNo, password, and captcha, submitting the form, 
// checking for login errors, and if successful, creating a session token, 
// storing it in memory and Firestore, then returning the token to the client. 
// It also cleans up the captcha session afterward.

app.post('/login', async (req, res) => {
  const { regNo, pwd, captcha } = req.body;
  const session = pendingCaptcha[regNo];

  if (!session) return res.status(400).json({ success: false, message: "Captcha session expired or not found" });

  const { page, context } = session;

  try {
    await page.type("#txtRegNumber", regNo);
    await page.type("#txtPwd", pwd);
    await page.type("#answer", captcha);

    await Promise.all([
      page.click('input[type="button"]'),
      page.waitForNavigation({ waitUntil: 'networkidle0' })
    ]);

    const loginFailed = await page.$('.ui-state-error');
    if (loginFailed) {
      const msg = await page.evaluate(el => (el.textContent || "Login failed").trim(), loginFailed);
      await context.close().catch(() => {});
      return res.status(401).json({ success: false, message: msg });
    }

    const token = uuidv4();
    userSessions[token] = { regNo, context };
    let cookies = await page.cookies();
    cookies = cookies.map(({ name, value, domain, path, expires, httpOnly, secure }) => ({
      name,
      value,
      domain,
      path,
      expires,
      httpOnly,
      secure
    }));
    await db.collection("activeSessions").doc(token).set({
        regNo,
        cookies,
        createdAt: new Date().toISOString()
    });
    return res.json({ success: true, message: "Login successful!", token });

  } 
  catch(err) 
  {
    await context.close().catch(() => {});
    return res.status(500).json({ success: false, message: "Login failed", error: err?.message || String(err) });
  } 
  finally 
  {
    delete pendingCaptcha[regNo];
  }
});





// This route logs out a user by closing their browser context, 
// removing the session from memory and Firestore, and 
// returning a logout success message (or "Already logged out" if no session exists).

app.post('/logout',async(req,res) => {
    let { token } = req.body;
    const session = userSessions[token];
    
    if (!session){
      delete userSessions[token];
      await db.collection("activeSessions").doc(token).delete();
      return res.json({success: true,message: "Already logged out!"});
    }

    await session.context.close().catch(() => {});
    delete userSessions[token];
    await db.collection("activeSessions").doc(token).delete();

    return res.json({success:true, message:"Logged out successfully"});
});






// This is a helper function to check whether the token is available in the firebase or not.
// If it is available, the user is already logged in. If not, user has to login again.

async function getSessionsByToken(token){
  let session = userSessions[token];
  if (session)
    return session;
  const doc = await db.collection("activeSessions").doc(token).get();
  if (!doc.exists)
    return null;
  
  const data = doc.data();
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  await page.goto("https://webstream.sastra.edu/sastrapwi/", { waitUntil: "domcontentloaded" });

  if (data.cookies){
    await page.setCookie(...data.cookies);
  }

  userSessions[token] = {
    regNo: data.regNo,
    context
  };
  await page.close();
  return userSessions[token];
}







// This route submits a student grievance to the SASTRA SWI portal using Puppeteer automation.
// It fills and submits the grievance form with type, category, subject, and description.
// After successful submission, it stores the grievance details in Firestore with timestamp history.
// The route ensures the user is logged in via session token and returns a success response.

app.post('/grievances',async(req,res) => {
  const { token, grievanceType, grievanceCategory, grievanceSubject, grievanceDetail } = req.body;
  const session = await getSessionsByToken(token);
  if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
  
  try
  {
    await page.goto("https://webstream.sastra.edu/sastrapwi/academy/StudentsGrievances.jsp");
    await page.waitForSelector("#cmbGrievanceType");
    await page.select("#cmbGrievanceType",grievanceType);
    await page.select("#cmbGrievanceCategory",grievanceCategory);
    await page.type("#txtSubject",grievanceSubject);
    await page.type("#txtSubjectDescription",grievanceDetail);
    await Promise.all([
      page.click("#cmdSave"),
      page.waitForNavigation({ waitUntil: 'networkidle0' })
    ]);

    //Storing data in Firestore
    const docRef = db.collection("studentDetails").doc(regNo);
    await docRef.set({
      grievances: admin.firestore.FieldValue.arrayUnion({
        type: grievanceType,
        category: grievanceCategory,
        subject: grievanceSubject,
        detail: grievanceDetail,
        submittedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
      }),
      lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    },{merge: true});
    res.json({success: true, message:"Grievance submitted successfully"});
  }
  catch (error)
  {
    res.status(500).json({ success: false, error: error.message });
  }
  finally{
    await page.close();
  }
});





// This route fetches a student's profile using their session token. 
// If the profile is missing in Firestore or a refresh is requested, it scrapes the data 
// (name, regNo, department, semester) from the SASTRA portal, stores/updates it in Firestore, 
// and returns it. Otherwise, it serves the cached profile from Firestore.

app.post('/profile', async (req, res) => {
    let { token,refresh } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
    try
    {
      await page.goto("https://webstream.sastra.edu/sastrapwi/usermanager/home.jsp");
      await page.waitForSelector('img[alt="Photo not found"]');

      //Storing data in Firestore
      const docRef = db.collection("studentDetails").doc(regNo);
      const doc = await docRef.get();
      if (!doc.exists || refresh || !doc.data().profile)
      {
        //If data not found in DB or if refreshed by user, scraping from SWI
        const profileData = await page.evaluate(() => {
          const name = document.querySelectorAll('.profile-text-bold')[0]?.innerText.trim();
          const regNo = document.querySelectorAll('.profile-text')[0]?.innerText.trim();
          const department = document.querySelectorAll('.profile-text')[1]?.innerText.trim();
          const semester = document.querySelectorAll('.profile-text')[2]?.innerText.trim();

          return{
            name,
            regNo,
            department,
            semester,
          };
        });
        
        await docRef.set({
          profile : profileData,
          lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        },{merge: true});
        res.json({success: true, profileData});
      }  
      else
      {
        //Else, fetch from firestore
        res.json({success: true,profile: doc.data().profile});
      }
    }
    catch (error)
    {
      res.status(500).json({ success: false, error: error.message });
    }
    finally{
      await page.close();
    }
});






// This route fetches a student's profile picture using their session token. 
// If not found in Firestore or if refresh is requested, it scrapes the image 
// from the SASTRA portal, saves a temporary screenshot, uploads it to Cloudinary, 
// stores the URL in Firestore, and returns it. Otherwise, it serves the cached image URL.

app.post('/profilePic', async(req, res) => {
  let { token,refresh } = req.body;
  const session = await getSessionsByToken(token);
  if (!session) 
    return res.status(401).json({ success: false, message: "User not logged in" });
  const { regNo, context } = session;
  const page = await context.newPage();
  try
  {
      //Storing data in Firestore
      const docRef = db.collection("studentDetails").doc(regNo);
      const doc = await docRef.get();
      if (!doc.exists || refresh || !doc.data().profilePic)
      {
        //If data not found in DB or if refreshed by user, scraping from SWI
        await page.goto("https://webstream.sastra.edu/sastrapwi/usermanager/home.jsp");
        await page.waitForSelector('img[alt="Photo not found"]');
        await new Promise(resolve => setTimeout(resolve, 1500));

        const profilePath = path.join(__dirname, 'profile.png');
        const profileElement = await page.$('img[alt="Photo not found"]');
        await profileElement.screenshot({ path: profilePath });

        const result = await cloudinary.uploader.upload(profilePath, {
          overwrite: true
        });
        const imageUrl = result.secure_url;
        await docRef.set({
          profilePic : imageUrl,
          lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        },{merge:true});
        res.json({success: true,imageUrl});
      }
      else
      {
        res.json({success: true,profilePic: doc.data().profilePic});
      }  
  }
  catch(error)
  {
    console.log(error);  
    res.status(500).json({ success: false, error: "Failed to fetch profile picture"});
  }
  finally{
    await page.close();
  } 
});






// This route fetches a student's attendance using their session token. 
// If attendance is missing in Firestore or refresh is requested, it scrapes the data 
// from the SASTRA portal, stores/updates it in Firestore, and returns it. 
// Otherwise, it serves the cached attendance from Firestore.

app.post('/attendance',async (req,res) => {
    let { token,refresh } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
    try
    {
      //Storing attendance in Firestore
      const docRef = db.collection("studentDetails").doc(regNo);
      const doc = await docRef.get();

      if (!doc.exists || refresh || !doc.data().attendance)
      {
        await page.goto("https://webstream.sastra.edu/sastrapwi/usermanager/home.jsp");
        await page.waitForSelector('#divAttendance', { timeout: 5000 });
        const attendanceHTML = await page.$eval("#divAttendance span", el => el.innerText);
        
        await docRef.set({
          attendance : attendanceHTML,
          lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        },{merge:true});
        res.json({success: true,attendanceHTML});
      }
      else
      {
        res.json({success: true,attendance: doc.data().attendance});
      }   
    }
    catch(error)
    {
      res.status(500).json({ success: false, message: "Failed to fetch attendance",error: error.message });
    }
    finally{
      await page.close();
    } 
});






// This route fetches a student's SASTRA fee due using their session token. 
// If the due amount is missing in Firestore or refresh is requested, it scrapes the value 
// from the fee due page, stores/updates it in Firestore, and returns it. 
// Otherwise, it serves the cached due amount from Firestore.

app.post('/sastraDue',async (req,res) => {
    let { token,refresh } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
    try
    {
      //Storing sastra due in Firestore
      const docRef = db.collection("studentDetails").doc(regNo);
      const doc = await docRef.get();

      if (!doc.exists || refresh || !doc.data().sastraDue)
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

          await docRef.set({
            sastraDue : totalSastraDue,
            lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
          },{merge:true});
          res.json({success: true,totalSastraDue});
      }
      else
      {
        res.json({success: true,sastraDue: doc.data().sastraDue});
      }
    }
    catch(error)
    {
      res.status(500).json({ success: false, message: "Failed to fetch due amount", error: error.message });
    }
    finally{
      await page.close();
    }
});






// This route fetches a student's hostel fee due using their session token. 
// If the due amount is missing in Firestore or refresh is requested, it scrapes the value 
// from the hostel fee due page, stores/updates it in Firestore, and returns it. 
// Otherwise, it serves the cached due amount from Firestore.

app.post('/hostelDue', async (req, res) => {
  let { token, refresh } = req.body;
  const session = await getSessionsByToken(token);

  if (!session)
    return res.status(401).json({ success: false, message: "User not logged in" });

  const { regNo, context } = session;
  const page = await context.newPage();

  try {
    const docRef = db.collection("studentDetails").doc(regNo);
    const doc = await docRef.get();

    // Fetch from website if first time or refresh required
    if (!doc.exists || refresh || !doc.data().hostelDue) {
      await page.goto("https://webstream.sastra.edu/sastrapwi/accounts/Feedue.jsp?arg=2");

      const data = await page.evaluate(() => {
        const table = document.querySelector("table");
        if (!table) return { hostelDue: [], totalDue: "No total found" };

        const tbody = table.querySelector("tbody");
        const rows = Array.from(tbody.getElementsByTagName("tr"));

        let hostelDue = [];
        let totalDue = "No total found";

        for (let i = 2; i < rows.length; i++) {
          const columns = rows[i].getElementsByTagName("td");
          const firstCol = columns[0]?.innerText?.trim();

          if (firstCol === "Total :" || firstCol === "Total:") {
            totalDue = columns[1]?.innerText?.trim() || "No total found";
          } else {
            hostelDue.push({
              sem: columns[1]?.innerText?.trim() || "",
              feeDetails: columns[2]?.innerText?.trim() || "",
              dueDate: columns[3]?.innerText?.trim() || "",
              dueAmount: columns[4]?.innerText?.trim() || "",
            });
          }
        }

        return { hostelDue, totalDue };
      });

      // Save to Firestore
      await docRef.set({
        hostelDue: data.hostelDue,
        totalDue: data.totalDue,
        lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
      }, { merge: true });

      res.json({ success: true, ...data });
    } else {
      // Load from Firestore
      res.json({
        success: true,
        hostelDue: doc.data().hostelDue,
        totalDue: doc.data().totalDue
      });
    }

  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch due amount", error: error.message });
  } finally {
    await page.close();
  }
});







// This route fetches a student's fee collections using their session token. 
// If the fee collections are missing in Firestore or refresh is requested, it scrapes the value 
// from the fee collections page, stores/updates it in Firestore, and returns it. 
// Otherwise, it serves the cached fee collections from Firestore.

app.post('/feeCollections',async (req,res) => {
    let { token,refresh } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
    try
    {
      //Storing fee collections in Firestore
      const docRef = db.collection("studentDetails").doc(regNo);
      const doc = await docRef.get();

      if (!doc.exists || refresh || !doc.data().feeCollections)
      {
        await page.goto("https://webstream.sastra.edu/sastrapwi/resource/StudentDetailsResources.jsp?resourceid=12");
        const feeCollections = await page.evaluate(() => { 
          const table = document.querySelector("table");
          if (!table)
              return "No records found";
          const tbody = table.querySelector("tbody");
          const rows = Array.from(tbody.getElementsByTagName("tr"));
          const feeCollections = [];
          for (let i=2;i<rows.length-2;i++)
          {
            const columns = rows[i].getElementsByTagName("td"); 
            feeCollections.push({
                semester: columns[0]?.innerText?.trim(),
                institution: columns[1]?.innerText?.trim(),
                particulars: columns[2]?.innerText?.trim(),
                amountCollected: columns[3]?.innerText?.trim(),
                collectedDate: columns[4]?.innerText?.trim()
            });
          }
          return feeCollections;
        });
        await docRef.set({
          feeCollections : feeCollections,
          lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        },{merge:true});
        res.json({ success: true, feeCollections });
      }
      else
      {
        res.json({ success: true, feeCollections: doc.data().feeCollections});
      }
    }
    catch(error)
    {
      res.status(500).json({ success: false, message: "Failed to fetch fee collections", error: error.message });
    }
    finally{
      await page.close();
    }
});






// This route fetches a student's subject-wise attendance using their session token. 
// If not found in Firestore or if refresh is requested, it scrapes the subject-wise attendance table 
// (with subject code, name, total hours, present, absent, and percentage), stores/updates it in Firestore, 
// and returns it. Otherwise, it serves the cached data from Firestore.

app.post('/examSchedule',async (req,res) => {
    let { token,refresh } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
    try
    {
      //Storing exam schedule in Firestore
      const docRef = db.collection("studentDetails").doc(regNo);
      const doc = await docRef.get();

      if (!doc.exists || refresh || !doc.data().examSchedule)
      {
        await page.goto("https://webstream.sastra.edu/sastrapwi/resource/StudentDetailsResources.jsp?resourceid=23");
        const examSchedule = await page.evaluate(() => { 
          const table = document.querySelector("table");
          if (!table)
              return "No records found";
          const tbody = table.querySelector("tbody");
          const rows = Array.from(tbody.getElementsByTagName("tr"));
          const examSchedule = [];
          for (let i=2;i<rows.length-2;i++)
          {
            const columns = rows[i].getElementsByTagName("td"); 
            examSchedule.push({
                examDate: columns[0]?.innerText?.trim(),
                examTime: columns[1]?.innerText?.trim(),
                subCode: columns[2]?.innerText?.trim(),
                subName: columns[3]?.innerText?.trim()
            });
          }
          return examSchedule;
        });
        await docRef.set({
          examSchedule : examSchedule,
          lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        },{merge:true});
        res.json({ success: true, examSchedule });
      }
      else
      {
        res.json({ success: true, examSchedule: doc.data().examSchedule});
      }
    }
    catch(error)
    {
      res.status(500).json({ success: false, message: "Failed to fetch attendance", error: error.message });
    }
    finally{
      await page.close();
    }
});







// This route fetches a student's subject-wise attendance using their session token. 
// If not found in Firestore or if refresh is requested, it scrapes the subject-wise attendance table 
// (with subject code, name, total hours, present, absent, and percentage), stores/updates it in Firestore, 
// and returns it. Otherwise, it serves the cached data from Firestore.

app.post('/subjectWiseAttendance',async (req,res) => {
    let { token,refresh } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
    try
    {
      //Storing subject-wise attendance in Firestore
      const docRef = db.collection("studentDetails").doc(regNo);
      const doc = await docRef.get();

      if (!doc.exists || refresh || !doc.data().subjectWiseAttendance)
      {
        await page.goto("https://webstream.sastra.edu/sastrapwi/resource/StudentDetailsResources.jsp?resourceid=7");
        const subjectWiseAttendance = await page.evaluate(() => { 
          const table = document.querySelector("table");
          if (!table)
              return "No records found";
          const tbody = table.querySelector("tbody");
          const rows = Array.from(tbody.getElementsByTagName("tr"));
          const attendance = [];
          for (let i=2;i<rows.length-2;i++)
          {
            const columns = rows[i].getElementsByTagName("td"); 
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
        await docRef.set({
          subjectAttendance : subjectWiseAttendance,
          lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        },{merge:true});
        res.json({ success: true, subjectWiseAttendance });
      }
      else
      {
        res.json({ success: true, subjectAttendance: doc.data().subjectAttendance});
      }
    }
    catch(error)
    {
      res.status(500).json({ success: false, message: "Failed to fetch attendance", error: error.message });
    }
    finally{
      await page.close();
    }
});


app.post('/hourWiseAttendance',async (req,res) => {
    let { token,refresh } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
    try
    {
      //Storing hour-wise attendance in Firestore
      const docRef = db.collection("studentDetails").doc(regNo);
      const doc = await docRef.get();
      
      const docRef1 = db.collection("OD").doc(regNo);
      const doc1 = await docRef1.get();

      if (!doc.exists || !doc1.exists || refresh || !doc.data().hourWiseAttendance || !doc1.data().hourWiseAttendance)
      {
        await page.goto("https://webstream.sastra.edu/sastrapwi/academy/studentHourWiseAttendance.jsp");
        const hourWiseAttendance = await page.evaluate(() => {
            const table = document.querySelector('table[name="table1"]');
            if (!table)
              return "No record found";
            const tbody = table.querySelector("tbody");
            const rows = Array.from(tbody.querySelectorAll("tr"));
            const attendance = []
            for (let i=1;i<rows.length;i++)
            {
              const coloumns = rows[i].querySelectorAll("td");
              attendance.push({
                dateDay : coloumns[0]?.innerText?.trim(),
                hour1 : coloumns[1]?.innerText?.trim(),
                hour2 : coloumns[2]?.innerText?.trim(),
                hour3 : coloumns[3]?.innerText?.trim(),
                hour4 : coloumns[4]?.innerText?.trim(),
                hour5 : coloumns[5]?.innerText?.trim(),
                hour6 : coloumns[6]?.innerText?.trim(),
                hour7 : coloumns[7]?.innerText?.trim(),
                hour8 : coloumns[8]?.innerText?.trim(),
              });
            }
            return attendance;
        });
        //Adding to OD
        await docRef1.set({
          hourWiseAttendance : hourWiseAttendance,
          lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        },{merge:true});

        //Adding to usual student details
        await docRef.set({
          hourWiseAttendance : hourWiseAttendance,
          lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        },{merge:true});
        res.json({ success: true, hourWiseAttendance });
      }
      else
      {
        res.json({ success: true, hourWiseAttendance: doc.data().hourWiseAttendance});
      }
    }
    catch(error)
    {
      res.status(500).json({ success: false, message: "Failed to fetch attendance", error: error.message });
    }
    finally{
      await page.close();
    }
});






// This route fetches a student's semester-wise grades using their session token. 
// If not found in Firestore or if refresh is requested, it scrapes the grades table 
// (with semester, month/year, subject code, subject name, credit, and grade), 
// stores/updates it in Firestore, and returns it. Otherwise, it serves the cached data from Firestore.

app.post('/semGrades', async (req,res) => {
    let { token,refresh } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
    try
    {
      //Storing sem-wise grades in Firestore
      const docRef = db.collection("studentDetails").doc(regNo);
      const doc = await docRef.get();

      if (!doc.exists || refresh || !doc.data().semGrades)
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
          });
          
          await docRef.set({
            semGrades : gradeData,
            lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
          },{merge:true});
          res.json({success: true,gradeData});
      }
      else
      {
        res.json({success: true,semGrades: doc.data().semGrades});
      }
    }
    catch(error)
    {
      res.status(500).json({ sucess:false, message: "Failed to fetch sem-wise grades", error: error.message });
    }
    finally{
      await page.close();
    }
});







// This route fetches a student's internal marks using their session token. 
// If not found in Firestore or if refresh is requested, it scrapes the marks table 
// (with subjectCode, subjectName, totalCIAMarks), 
// stores/updates it in Firestore, and returns it. Otherwise, it serves the cached data from Firestore.

app.post('/internalMarks', async (req,res) => {
    let { token,refresh } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
    try
    {
      //Storing internal marks in Firestore
      const docRef = db.collection("studentDetails").doc(regNo);
      const doc = await docRef.get();

      if (!doc.exists || refresh || !doc.data().internalMarks)
      {
          await page.goto("https://webstream.sastra.edu/sastrapwi/resource/StudentDetailsResources.jsp?resourceid=22");
          const marksData = await page.evaluate(() => {
            const table = document.querySelectorAll("table");
            if (!table)
              return "No records found";
            const tbody = table[0].querySelector("tbody");
            const rows = Array.from(tbody.getElementsByTagName("tr"));
            const marks = [];
            for (let i=2;i<rows.length;i++)
            {
              const columns = rows[i].getElementsByTagName("td");
              marks.push({
                subjectCode : columns[0]?.innerText?.trim(),
                subjectName : columns[1]?.innerText?.trim(),
                totalCIAMarks : columns[2]?.innerText?.trim(),
              });
            }
            return marks;
          });
          
          await docRef.set({
            internalMarks : marksData,
            lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
          },{merge:true});
          res.json({success: true,marksData});
      }
      else
      {
        res.json({success: true,internalMarks: doc.data().internalMarks});
      }
    }
    catch(error)
    {
      res.status(500).json({ sucess:false, message: "Failed to fetch internal marks", error: error.message });
    }
    finally{
      await page.close();
    }
});









app.post('/ciaWiseInternalMarks', async (req,res) => {
    let { token,refresh } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
    try
    {
      //Storing internal marks in Firestore
      const docRef = db.collection("studentDetails").doc(regNo);
      const doc = await docRef.get();

      if (!doc.exists || refresh || !doc.data().ciaWiseInternalMarks)
      {
          await page.goto("https://webstream.sastra.edu/sastrapwi/resource/StudentDetailsResources.jsp?resourceid=22");
          const marksData = await page.evaluate(() => {
            const table = document.querySelectorAll("table");
            if (!table)
              return "No records found";
            const tbody = table[1].querySelector("tbody");
            const rows = Array.from(tbody.getElementsByTagName("tr"));
            const marks = [];
            for (let i=2;i<rows.length;i++)
            {
              const columns = rows[i].getElementsByTagName("td");
              marks.push({
                subjectCode : columns[0]?.innerText?.trim(),
                subjectName : columns[1]?.innerText?.trim(),
                component : columns[2]?.innerText?.trim(),
                marksObtained : columns[3]?.innerText?.trim(),
                maxMarks : columns[4]?.innerText?.trim(),
              });
            }
            return marks;
          });
          
          await docRef.set({
            ciaWiseInternalMarks : marksData,
            lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
          },{merge:true});
          res.json({success: true,marksData});
      }
      else
      {
        res.json({success: true,ciaWiseInternalMarks: doc.data().ciaWiseInternalMarks});
      }
    }
    catch(error)
    {
      res.status(500).json({ sucess:false, message: "Failed to fetch cia-wise internal marks", error: error.message });
    }
    finally{
      await page.close();
    }
});







// This route fetches a student's status(Dayscholar/Hosteller) using their session token. 
// If not found in Firestore or if refresh is requested, it scrapes the student status table 
// (specifically the status row), stores/updates it in Firestore, and returns it. 
// Otherwise, it serves the cached status from Firestore.

app.post('/studentStatus', async(req,res) => {
    let { token,refresh } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
    try
    {
      //Storing student status in Firestore
      const docRef = db.collection("studentDetails").doc(regNo);
      const doc = await docRef.get();

      if (!doc.exists || refresh || !doc.data().studentStatus)
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
        });
        
        await docRef.set({
          studentStatus : statusData,
          lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        },{merge:true});
        res.json({success: true,statusData});
      }
      else
      {
        res.json({success: true,studentStatus: doc.data().studentStatus});
      }
    }
    catch(error)
    {
      res.status(500).json({ sucess:false, message: "Failed to fetch student status", error: error.message });
    }
    finally{
      await page.close();
    }
});






// This route fetches a student's SGPA for each semester using their session token. 
// If not found in Firestore or if refresh is requested, it scrapes the SGPA table 
// (semester and SGPA values), stores/updates it in Firestore, and returns it. 
// Otherwise, it serves the cached SGPA from Firestore.

app.post('/sgpa', async(req,res) => {
    let { token,refresh } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
    try
    {
      //Storing SGPA in Firestore
      const docRef = db.collection("studentDetails").doc(regNo);
      const doc = await docRef.get();

      if (!doc.exists || refresh || !doc.data().sgpa)
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
        });
        await docRef.set({
          sgpa : sgpaData,
          lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        },{merge:true});
        res.json({success: true,sgpaData});
      }
      else
      {
        res.json({success: true,sgpa: doc.data().sgpa});
      }
    }
    catch (error)
    {
      res.status(500).json({ success: false, meassage: "Failed to fetch SGPA", error: error.meassage });
    }
    finally{
      await page.close();
    }
});






// POST /cgpa
// 1. Validates user session using token.
// 2. If CGPA not cached in Firestore (or refresh=true), scrapes CGPA from SASTRA portal.
// 3. Stores/updates CGPA in Firestore with timestamp.
// 4. Returns CGPA from Firestore if already available.
// 5. Handles errors and ensures Puppeteer page is closed.

app.post('/cgpa', async(req,res) => {
    let { token,refresh } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
    try
    {
      //Storing CGPA in Firestore
      const docRef = db.collection("studentDetails").doc(regNo);
      const doc = await docRef.get();
      if (!doc.exists || refresh || !doc.data().cgpa)
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
          });
          
          await docRef.set({
            cgpa : cgpaData,
            lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
          },{merge:true});
          res.json({success: true,cgpaData});
      }
      else
      {
        res.json({success: true,cgpa: doc.data().cgpa});
      }
      
    }
    catch (error)
    {
      res.status(500).json({ success: false, meassage: "Failed to fetch CGPA", error: error.meassage });
    }
    finally{
      await page.close();
      }
});






// POST /dob
// - Validates user session from token.
// - Checks Firestore for existing DOB (or refresh flag).
// - If not available, navigates to SASTRA portal (resourceid=59),
//   scrapes DOB from table row, and stores it in Firestore with timestamp.
// - Returns cached DOB if already present.
// - Handles errors gracefully and ensures Puppeteer page is closed.

app.post('/dob', async(req,res) => {
    let { token,refresh } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
    try
    {
      //Storing DOB grades in Firestore
      const docRef = db.collection("studentDetails").doc(regNo);
      const doc = await docRef.get();

      if (!doc.exists || refresh || !doc.data().dob)
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
          });

          await docRef.set({
            dob : dobData,
            lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
          },{merge:true});
          res.json({success: true,dobData});
      }
      else
      {
        res.json({success: true,dob: doc.data().dob});
      }
    }
    catch(error)
    {
      res.status(500).json({ sucess:false, message: "Failed to fetch DOB", error: error.message });
    }
    finally{
      await page.close();
    }
});






// POST /facultyList
// - Validates user session from token.
// - Checks Firestore for existing faculty list (or refresh flag).
// - If not available, navigates to SASTRA timetable page,
//   scrapes subject code, description, section, faculty, and venue,
//   then stores the list in Firestore with timestamp.
// - Returns cached faculty list if already present.
// - Handles errors and ensures Puppeteer page is closed.

app.post('/facultyList', async  (req,res) => {
    let { token,refresh } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
    try
    {
      //Storing faculty list in Firestore
      const docRef = db.collection("studentDetails").doc(regNo);
      const doc = await docRef.get();

      if (!doc.exists || refresh || !doc.data().facultyList)
      { 
          await page.goto("https://webstream.sastra.edu/sastrapwi/academy/frmStudentTimetable.jsp");
          const timeTable = await page.evaluate(() => {
            const tables = document.querySelectorAll("table");
            const timetableTable = tables[2]; 
            if (!timetableTable) return null;
            const rows = timetableTable.querySelectorAll("tbody tr");
            const data = [];
            for (let i = 1; i < rows.length; i++) 
            { 
              const cells = rows[i].querySelectorAll("td");
              if (cells.length < 5) continue;

              const code = cells[0].innerText.trim();
              if (!code || code.toLowerCase() === 'na') continue;

              data.push({
                code,
                description: cells[1].innerText.trim(),
                section: cells[2].innerText.trim(),
                faculty: cells[3].innerText.trim(),
                venue: cells[4].innerText.trim(),
              });
            }
          return data.length ? data : null;
        });
        
        await docRef.set({
            facultyList : timeTable,
            lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
          },{merge:true});
          res.json({success: true,timeTable});
      }
      else
      {
        res.json({success: true,facultyList: doc.data().facultyList});
      }
  }
  catch(error)
  {
    res.status(500).json({ success: false, message: "Failed to fetch faculty list", error: error.message });
  }
  finally{
    await page.close();
  }
});






// POST /currentSemCredits
// - Validates user session from token.
// - Checks Firestore for existing current semester credits (or refresh flag).
// - If not available, navigates to course registration page,
//   scrapes course code, name, and credit values for each subject,
//   then stores the data in Firestore with timestamp.
// - Returns cached credits if already present.
// - Handles errors and ensures Puppeteer page is closed.

app.post('/currentSemCredits',async (req,res) => {
    let { token,refresh } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
    try
    {
        //Storing the credits in firestore
        const docRef = db.collection("studentDetails").doc(regNo);
        const doc = await docRef.get();

        if (!doc.exists || refresh || !doc.data().credits)
        {
            await page.goto("https://webstream.sastra.edu/sastrapwi/academy/StudentCourseRegistrationView.jsp");
            const credits = await page.evaluate(() => {
              const table = document.querySelector("table");
              if (!table)
                return "No records Found";
              const tbody = table.querySelector("tbody");
              const rows = Array.from(tbody.getElementsByTagName("tr"));
              const credit = [];
              for (let i=4;i<rows.length;i++)
              {
                const coloumns = rows[i].getElementsByTagName("td");
                credit.push({
                  courseCode : coloumns[0]?.innerText.trim(),
                  courseName : coloumns[1]?.innerText.trim(),
                  credit : coloumns[5]?.innerText.trim()
                });
              }
              return credit;
            });

            docRef.set({
              credits : credits,
              lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            },{merge:true});
            res.json({ success: true,credits})
        }
        else
        {
            res.json({ success: true,credits: doc.data().credits});
        }
    }
    catch(error)
    {
      res.status(500).json({ status: false, message: "Failed to fetch credits", error: error.meassage });
    }
    finally{
      await page.close();
    }
});






// POST /timetable
// - Validates user session using token.
// - Checks Firestore for existing timetable (or refresh flag).
// - If missing or refresh requested:
//     • Navigates to student timetable page.
//     • Scrapes day-wise timetable including lecture slots and breaks.
//     • Stores timetable in Firestore with timestamp.
// - Returns cached timetable if available.
// - Ensures Puppeteer page is closed and handles errors properly.

app.post('/timetable', async  (req,res) => {
    let { token,refresh } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
    try
    {
      //Storing timetable in Firestore
      const docRef = db.collection("studentDetails").doc(regNo);
      const doc = await docRef.get();

      if (!doc.exists || refresh || !doc.data().timetable)
      { 
          await page.goto("https://webstream.sastra.edu/sastrapwi/academy/frmStudentTimetable.jsp");
          const timeTable = await page.evaluate(() => {
            const tables = document.querySelectorAll("table");
            const timetableTable = tables[1]; 
            if (!timetableTable) return null;
            const rows = timetableTable.querySelectorAll("tbody tr");
            const data = [];
            for (let i = 2; i < rows.length; i++) 
            { 
              const cells = rows[i].querySelectorAll("td");
              if (cells.length < 12) continue;
              data.push({
                day : cells[0].innerText.trim(),
                "08:45 - 09:45" : cells[1].innerText.trim() || "N/A",
                "09:45 - 10:45" : cells[2].innerText.trim() || "N/A",
                "10:45 - 11:00" : "Break",
                "11:00 - 12:00" : cells[3].innerText.trim() || "N/A",
                "12:00 - 01:00" : cells[4].innerText.trim() || "N/A",
                "01:00 - 02:00" : cells[5].innerText.trim() || "N/A",
                "02:00 - 03:00" : cells[6].innerText.trim() || "N/A",
                "03:00 - 03:15" : "Break",
                "03:15 - 04:15" : cells[7].innerText.trim() || "N/A",
                "04:15 - 05:15" : cells[8].innerText.trim() || "N/A",
                "05:30 - 06:30" : cells[9].innerText.trim() || "N/A",
                "06:30 - 07:30" : cells[10].innerText.trim() || "N/A",
                "07:30 - 08:30" : cells[11].innerText.trim() || "N/A"
              });
            }
          return data.length ? data : null;
        });
        
        await docRef.set({
            timetable : timeTable,
            lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
          },{merge:true});
          res.json({success: true,timeTable});
      }
      else
      {
        res.json({success: true,timetable: doc.data().timetable});
      }
  }
  catch(error)
  {
    res.status(500).json({ success: false, message: "Failed to fetch timetable", error: error.message });
  }
  finally{
    await page.close();
  }
});






// POST /courseMap
// - Validates user session using token.
// - Checks Firestore for existing courseMap (or refresh flag).
// - If missing or refresh requested:
//     • Navigates to student timetable page.
//     • Scrapes courseMap
//     • Stores courseMap in Firestore with timestamp.
// - Returns cached courseMap if available.

app.post('/courseMap', async  (req,res) => {
    let { token,refresh } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();
    try
    {
      //Storing timetable in Firestore
      const docRef = db.collection("studentDetails").doc(regNo);
      const doc = await docRef.get();

      if (!doc.exists || refresh || !doc.data().courseMap)
      { 
          await page.goto("https://webstream.sastra.edu/sastrapwi/academy/frmStudentTimetable.jsp");
          const courseMap = await page.evaluate(() => {
            const tables = document.querySelectorAll("table");
            const timetableTable = tables[2]; 
            if (!timetableTable) return null;
            const tbody = timetableTable.querySelector("tbody");
            const rows = Array.from(tbody.getElementsByTagName("tr"));
            const courseMap = [];
            for (let i=1;i<rows.length;i++)
            {
              const columns = rows[i].getElementsByTagName("td");
              courseMap.push({
                courseCode : columns[0]?.innerText?.trim(),
                courseName : columns[1]?.innerText?.trim(),
                section : columns[2]?.innerText?.trim(),
                faculty : columns[3]?.innerText?.trim(),
                venue : columns[4]?.innerText?.trim()
              });
            }
            return courseMap;
        });
        
        await docRef.set({
            courseMap : courseMap,
            lastUpdated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
          },{merge:true});
          res.json({success: true,courseMap});
      }
      else
      {
        res.json({success: true,courseMap: doc.data().courseMap});
      }
  }
  catch(error)
  {
    res.status(500).json({ success: false, message: "Failed to fetch timetable", error: error.message });
  }
  finally{
    await page.close();
  }
});





// - Includes `daysPerSem` mapping to indicate number of class
//   days per semester for each weekday (Mon–Sun).
// - Handles errors gracefully and always closes Puppeteer page.

const daysPerSem = {
  Mon: 15,
  Tue: 15,
  Wed: 16,
  Thu: 15,
  Fri: 15,
  Sat: 0,
  Sun: 0
};







// /bunk route calculates student bunk statistics based on timetable
// 1. Fetches the student's timetable from Firestore using regNo
// 2. Computes per-day class counts for each course
// 3. Aggregates total classes per course for the week
// 4. Projects total classes per course for the semester using daysPerSem
// 5. Calculates 20% of semester classes per course as allowed bunk limit
// 6. Returns a structured JSON with per-day, weekly, semester, and 20% bunk info

app.post('/bunk', async (req, res) => {
  let { token } = req.body;
    const session = await getSessionsByToken(token);
    if (!session) 
      return res.status(401).json({ success: false, message: "User not logged in" });
    const { regNo, context } = session;
    const page = await context.newPage();

  try {
    const docRef = db.collection("studentDetails").doc(regNo);
    const doc = await docRef.get();

    if (!doc.exists || !doc.data().timetable) {
      return res.status(500).json({ success: false, message: "Failed to fetch bunk" });
    }

    const data = doc.data();
    const timetable = data.timetable;

    const perDay = {};
    const perSem = {};
    const total = {};

    timetable.forEach(day => {
      const dayName = day.day;
      perDay[dayName] = {};

      Object.keys(day).forEach(slot => {
        if (slot !== "day") {
          const courses = day[slot].split(",").map(c => c.trim());
          courses.forEach(course => {
            if (course !== "N/A" && course !== "Break" && course !== "") {
              // per-day count
              perDay[dayName][course] = (perDay[dayName][course] || 0) + 1;

              // total weekly
              total[course] = (total[course] || 0) + 1;
            }
          });
        }
      });
    });

    // now compute perYear using daysPerYear
    Object.keys(perDay).forEach(day => {
      Object.keys(perDay[day]).forEach(course => {
        const yearly = perDay[day][course] * (daysPerSem[day] || 0);
        perSem[course] = (perSem[course] || 0) + yearly;
      });
    });

    const perSem20 = {};
    Object.keys(perSem).forEach(course => {
      perSem20[course] = Math.floor(perSem[course] * 0.20); // floor/round as needed
    });

    
    res.json({
      success: true,
      bunkdata: {
        perDay,
        totalWeekly: total,
        perSem,
        perSem20
      }
   
});

  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch bunk", error: error.message });
  }
});







// subjectMap: Maps short subject codes to Google Drive links containing PYQs
// Some subjects (like Java) have multiple links in an array

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



// subjectAliasMap: Maps various ways a user can refer to a subject to the short subject code
// Helps match user queries to the correct Drive link

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





// POST /chatbot
// 1. Receives a 'message' from user
// 2. Converts message to lowercase
// 3. Tries to find the longest matching subject alias in the message
// 4. If found, returns the corresponding Drive link(s) for that subject's PYQs
// 5. If no match, returns a friendly message saying no PYQs found

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






// GET /pyq
// Returns a list of department-wise PYQ Drive links
// Each entry has a 'dept' name and corresponding Drive 'url'
// Useful for fetching general PYQs for a department rather than a specific subject

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

const menuData = [
      //Week 2
      {
        week : "2",
        day : "Monday",
        breakfast : ["Dosa","Vadacurry","Chutney","BBJ"],
        lunch : ["Chappathi","Channa Masala","White Rice","Onion Drumstick Sambar","Potato Poriyal","Karamani Poriyal","Tomato Rasam","Curd","Fryums","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Peanut Sundal"],
        dinner: ["Chappathi","Mix Veg Gravy","Brinji Rice","Raitha","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "2",
        day : "Tuesday",
        breakfast : ["Pongal","Sambar","Cocunut Chutney","Medhu Vada(1)","Oats & Milk"],
        lunch : ["Chappathi","Dhall Fry","White Rice","Bindi Karakuzhambu","Raw Banana Poriyal","Spinach Kootu","Malli Rasam","Curd","Appalam","Pickle"],
        snacks: ["Tea, Milk and Coffee","Veg Puff"],
        dinner: ["Idly","Sambar","Coconut Chutney","Bisebelabath","Curd Rice","Fryums","Pickle","Banana (1 No)"] 
      },
      {
        week : "2",
        day : "Wednesday",
        breakfast : ["Idiyappam (3 Nos)","Veg Kuruma","Ragi Koozhu","Curd Chilly","BBJ"],
        lunch : ["Chappathi","Aloo Capsicum Masala","White Rice","Sambar","Carrot Poriyal","Bonda (1 No)","Mysore Rasam","Curd","Fryums","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Coconut Mango Peas Sundal"],
        dinner: ["Butter Chappathi","Kadai Veg Gravy","Sambar Rice","Potato Poriyal","Curd Rice","Pickle","Fryums","Banana (1 No)"] 
      },
      {
        week : "2",
        day : "Thursday",
        breakfast : ["Vegetable Rava Kichadi","Sambar","Cocunut Chutney","Masala Vada(1)"],
        lunch : ["Chappathi","White Channa Kuruma","White Rice","Vathakuzhambu","Yam 65","Chow Chow Kootu","Garlic Rasam","Curd","Appalam","Pickle"],
        snacks: ["Tea, Milk and Coffee","Cutlet"],
        dinner: ["Dosa","Sambar/Chutney","Rasam Rice","Curd Rice","Lemon Juice","Pickle","Banana (1 No)"] 
      },
      {
        week : "2",
        day : "Friday",
        breakfast : ["Uthappam","Sambar","Kara Chutney","Podi with Oil"],
        lunch : ["Chappathi","Paneer Butter Masala","White Rice","Pumpkin Morekuzhambu","Beetroot Channa Poriyal","Cabbage Peas Poriyal","Pineapple Rasam","Curd","Fryums","Pickle","Jangiri","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Mixture/Karasev"],
        dinner: ["Chappathi","Black Channa Masala","Tomato Rice","Raitha","Curd Rice","Pickle","Fryums","Banana (1 No)"] 
      },
      {
        week : "2",
        day : "Saturday",
        breakfast : ["Idly","Sambar","Tomato Chutney","Podi with Oil"],
        lunch : ["Chappathi","Green Peas Masala","White Rice","Spinach Sambar","Beans Usili","Aviyal","Dhall Rasam","Curd","Appalam","Pickle"],
        snacks: ["Tea, Milk and Coffee","Green Moongdal Sundal"],
        dinner: ["Idiyappam (2 Nos)","Veg Kuruma","White Rice","Rasam","Butter Milk","Fryums","Pickle","Banana (1 No)"] 
      },
      {
        week : "2",
        day : "Sunday",
        breakfast : ["Vermicelli Upma","Sambar","Coconut Chutney","Medhu Vada(1)","BBJ"],
        lunch : ["Aloo Paratha","Hyderabad Veg Biriyani","Boondhi Raitha","White Rice","Dhall","Rasam","Buttermilk","Appalam","Pickle","Icecream"],
        snacks: ["Tea, Milk and Coffee","Bhel Puri/Samosa"],
        dinner: ["Sambarava Upma","Sambar","Peanut Chutney","Uthappam","Curd Rice","Pickle","Banana (1 No)"] 
      },

      //Week 1
      {
        week : "1",
        day : "Monday",
        breakfast : ["Raagi Dosa","Drumstick Sambar","Tomato Chutney","Cornflakes & Hot Milk"],
        lunch : ["Chappathi","Dhall Tadka","White Rice","Sundavathal Karakuzhambu","Raw Banana Poriyal","Spinach Kootu","Tomato Rasam","Curd","Appalam","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Peanut Sundal"],
        dinner: ["Chappathi","Aloo Mutter Masala","Rava Upma","Sambar","Coconut Chutney","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "1",
        day : "Tuesday",
        breakfast : ["Idly","Carrot Beans Sambar","Peanut Chutney","Podi with Oil","BBJ"],
        lunch : ["Chappathi","White Kuruma","White Rice","Raddish Sambar","Cabbage Peas Poriyal","Masala Vada","Dhall Rasam","Curd","Fryums","Pickle"],
        snacks: ["Tea, Milk and Coffee","Chilly Bajji"],
        dinner: ["Dosa","Sambar","Coriander Chutney","Malli Rice","Thuvaiyal","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "1",
        day : "Wednesday",
        breakfast : ["Idiyappam (3 Nos)","Veg Kuruma","Ragi Koozhu","Curd Chilly","Masala Vada"],
        lunch : ["Chappathi","Palak Paneer","White Rice","Ladies Finger Morekuzhambu","Yam Channa Poriyal","Tindly Kara Curry","Malli Rasam","Curd","Appalam","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Milk Bikies"],
        dinner: ["Veg Biriyani","Onion Raitha","Potato Chips","Rasam Rice","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "1",
        day : "Thursday",
        breakfast : ["Mix Veg Uthappam","Small Onion Sambar","Kara Chutney","Podi with Oil","BBJ"],
        lunch : ["Chappathi","Rajma Masala","White Rice","Mix Veg Sambar","Aloo 65","Podalanga Kootu","Mysore Rasam","Curd","Fryums","Pickle"],
        snacks: ["Tea, Milk and Coffee","White Channa Sundal"],
        dinner: ["Chappathi","Veg Kuruma","Sambar Rice","Potato Poriyal","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "1",
        day : "Friday",
        breakfast : ["Poha","Sambar","Coconut Chutney","Medhu Vada(1)"],
        lunch : ["Chappathi","Veg Salna","White Rice","Spinach Kuzhambu","Beans Usili","Aviyal","Lemon Rasam","Curd","Fryums","Pickle","Pineapple Kesari"],
        snacks: ["Tea, Milk and Coffee","Millet Snacks"],
        dinner: ["Onion Uthappam","Sambar","Malli Chutney","Rasam Rice","Thuvaiyal","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "1",
        day : "Saturday",
        breakfast : ["Pongal","Tiffin Sambar","Cocunut Chutney","Medhu Vada(1)","BBJ"],
        lunch : ["Chappathi","Green Peas Masala","White Rice","Onion Sambar","Beetrrot Channa Poriyal","Carrot Coconut Poriyal","Garlic Rasam","Curd","Fryums","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Coconut Mango Peas Sundal"],
        dinner: ["Maggi Noodles","Tomato Sauce","Brinji Rice","Raitha","Curd Rice","Pickle","Fryums","Banana (1 No)"] 
      },
      {
        week : "1",
        day : "Sunday",
        breakfast : ["Poori","Aloo/Channa Masala"],
        lunch : ["Veg Fried Rice","Mix Veg Manchurian","White Rice","Dhall & Ghee","Aloo Kara Curry","Tomato Rasam","Buttermilk","Appalam","Pickle","Vermicelli Payasam/Fruit Salad"],
        snacks: ["Tea, Milk and Coffee","Cream Bun"],
        dinner: ["Idiayappam (2 Nos)","Mix Veg Gravy","Chappathi","Curd Rice","Pickle","Fryums","Banana (1 No)"] 
      },

      //Week 4
      {
        week : "4",
        day : "Monday",
        breakfast : ["Dosa","Vadacurry","Chutney","BBJ"],
        lunch : ["Chappathi","Channa Masala","White Rice","Onion Drumstick Sambar","Potato Poriyal","Karamani Poriyal","Tomato Rasam","Curd","Fryums","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Peanut Sundal"],
        dinner: ["Chappathi","Mix Veg Gravy","Brinji Rice","Raitha","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "4",
        day : "Tuesday",
        breakfast : ["Pongal","Sambar","Cocunut Chutney","Medhu Vada(1)","Oats & Milk"],
        lunch : ["Chappathi","Dhall Fry","White Rice","Bindi Karakuzhambu","Raw Banana Poriyal","Spinach Kootu","Malli Rasam","Curd","Appalam","Pickle"],
        snacks: ["Tea, Milk and Coffee","Veg Puff"],
        dinner: ["Idly","Sambar","Coconut Chutney","Bisebelabath","Curd Rice","Fryums","Pickle","Banana (1 No)"] 
      },
      {
        week : "4",
        day : "Wednesday",
        breakfast : ["Idiyappam (3 Nos)","Veg Kuruma","Ragi Koozhu","Curd Chilly","BBJ"],
        lunch : ["Chappathi","Aloo Capsicum Masala","White Rice","Sambar","Carrot Poriyal","Bonda (1 No)","Mysore Rasam","Curd","Fryums","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Coconut Mango Peas Sundal"],
        dinner: ["Butter Chappathi","Kadai Veg Gravy","Sambar Rice","Potato Poriyal","Curd Rice","Pickle","Fryums","Banana (1 No)"] 
      },
      {
        week : "4",
        day : "Thursday",
        breakfast : ["Vegetable Rava Kichadi","Sambar","Cocunut Chutney","Masala Vada(1)"],
        lunch : ["Chappathi","White Channa Kuruma","White Rice","Vathakuzhambu","Yam 65","Chow Chow Kootu","Garlic Rasam","Curd","Appalam","Pickle"],
        snacks: ["Tea, Milk and Coffee","Cutlet"],
        dinner: ["Dosa","Sambar/Chutney","Rasam Rice","Curd Rice","Lemon Juice","Pickle","Banana (1 No)"] 
      },
      {
        week : "4",
        day : "Friday",
        breakfast : ["Uthappam","Sambar","Kara Chutney","Podi with Oil"],
        lunch : ["Chappathi","Paneer Butter Masala","White Rice","Pumpkin Morekuzhambu","Beetroot Channa Poriyal","Cabbage Peas Poriyal","Pineapple Rasam","Curd","Fryums","Pickle","Jangiri","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Mixture/Karasev"],
        dinner: ["Chappathi","Black Channa Masala","Tomato Rice","Raitha","Curd Rice","Pickle","Fryums","Banana (1 No)"] 
      },
      {
        week : "4",
        day : "Saturday",
        breakfast : ["Idly","Sambar","Tomato Chutney","Podi with Oil"],
        lunch : ["Chappathi","Green Peas Masala","White Rice","Spinach Sambar","Beans Usili","Aviyal","Dhall Rasam","Curd","Appalam","Pickle"],
        snacks: ["Tea, Milk and Coffee","Green Moongdal Sundal"],
        dinner: ["Idiyappam (2 Nos)","Veg Kuruma","White Rice","Rasam","Butter Milk","Fryums","Pickle","Banana (1 No)"] 
      },
      {
        week : "4",
        day : "Sunday",
        breakfast : ["Vermicelli Upma","Sambar","Coconut Chutney","Medhu Vada(1)","BBJ"],
        lunch : ["Aloo Paratha","Hyderabad Veg Biriyani","Boondhi Raitha","White Rice","Dhall","Rasam","Buttermilk","Appalam","Pickle","Icecream"],
        snacks: ["Tea, Milk and Coffee","Bhel Puri/Samosa"],
        dinner: ["Sambarava Upma","Sambar","Peanut Chutney","Uthappam","Curd Rice","Pickle","Banana (1 No)"] 
      },

      //Week 3
      {
        week : "3",
        day : "Monday",
        breakfast : ["Raagi Dosa","Drumstick Sambar","Tomato Chutney","Cornflakes & Hot Milk"],
        lunch : ["Chappathi","Dhall Tadka","White Rice","Sundavathal Karakuzhambu","Raw Banana Poriyal","Spinach Kootu","Tomato Rasam","Curd","Appalam","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Peanut Sundal"],
        dinner: ["Chappathi","Aloo Mutter Masala","Rava Upma","Sambar","Coconut Chutney","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "3",
        day : "Tuesday",
        breakfast : ["Idly","Carrot Beans Sambar","Peanut Chutney","Podi with Oil","BBJ"],
        lunch : ["Chappathi","White Kuruma","White Rice","Raddish Sambar","Cabbage Peas Poriyal","Masala Vada","Dhall Rasam","Curd","Fryums","Pickle"],
        snacks: ["Tea, Milk and Coffee","Chilly Bajji"],
        dinner: ["Dosa","Sambar","Coriander Chutney","Malli Rice","Thuvaiyal","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "3",
        day : "Wednesday",
        breakfast : ["Idiyappam (3 Nos)","Veg Kuruma","Ragi Koozhu","Curd Chilly","Masala Vada"],
        lunch : ["Chappathi","Palak Paneer","White Rice","Ladies Finger Morekuzhambu","Yam Channa Poriyal","Tindly Kara Curry","Malli Rasam","Curd","Appalam","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Milk Bikies"],
        dinner: ["Veg Biriyani","Onion Raitha","Potato Chips","Rasam Rice","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "3",
        day : "Thursday",
        breakfast : ["Mix Veg Uthappam","Small Onion Sambar","Kara Chutney","Podi with Oil","BBJ"],
        lunch : ["Chappathi","Rajma Masala","White Rice","Mix Veg Sambar","Aloo 65","Podalanga Kootu","Mysore Rasam","Curd","Fryums","Pickle"],
        snacks: ["Tea, Milk and Coffee","White Channa Sundal"],
        dinner: ["Chappathi","Veg Kuruma","Sambar Rice","Potato Poriyal","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "3",
        day : "Friday",
        breakfast : ["Poha","Sambar","Coconut Chutney","Medhu Vada(1)"],
        lunch : ["Chappathi","Veg Salna","White Rice","Spinach Kuzhambu","Beans Usili","Aviyal","Lemon Rasam","Curd","Fryums","Pickle","Pineapple Kesari"],
        snacks: ["Tea, Milk and Coffee","Millet Snacks"],
        dinner: ["Onion Uthappam","Sambar","Malli Chutney","Rasam Rice","Thuvaiyal","Curd Rice","Pickle","Banana (1 No)"] 
      },
      {
        week : "3",
        day : "Saturday",
        breakfast : ["Pongal","Tiffin Sambar","Cocunut Chutney","Medhu Vada(1)","BBJ"],
        lunch : ["Chappathi","Green Peas Masala","White Rice","Onion Sambar","Beetrrot Channa Poriyal","Carrot Coconut Poriyal","Garlic Rasam","Curd","Fryums","Pickle","Paruppu Podi with Oil"],
        snacks: ["Tea, Milk and Coffee","Coconut Mango Peas Sundal"],
        dinner: ["Maggi Noodles","Tomato Sauce","Brinji Rice","Raitha","Curd Rice","Pickle","Fryums","Banana (1 No)"] 
      },
      {
        week : "3",
        day : "Sunday",
        breakfast : ["Poori","Aloo/Channa Masala"],
        lunch : ["Veg Fried Rice","Mix Veg Manchurian","White Rice","Dhall & Ghee","Aloo Kara Curry","Tomato Rasam","Buttermilk","Appalam","Pickle","Vermicelli Payasam/Fruit Salad"],
        snacks: ["Tea, Milk and Coffee","Cream Bun"],
        dinner: ["Idiayappam (2 Nos)","Mix Veg Gravy","Chappathi","Curd Rice","Pickle","Fryums","Banana (1 No)"] 
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