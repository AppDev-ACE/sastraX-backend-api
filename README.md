This is a Node.js-based backend API built using Puppeteer to automate login and scrape data from the SASTRA University student portal.

API Endpoints:
 - /captcha: To fetch captcha and display in UI (GET)
 - /login: To get register number, password and captcha from user and login (POST)
 - /profile: To fetch name, register number, course and current semester and display under profile section (GET)
 - /profilePic: To fetch profile picture (GET)
 - /attendance: To fetch the overall attendance and display in home page (GET)
 - /sastraDue: To fetch the total SASTRA fee due (GET)
 - /hostelDue: To fetch the total Hostel fee due (GET)
 - /subjectWiseAttendance: To fetch subject-wise attendance (GET)
 - /semGrades: To fetch semester-wise grades and credits (GET)
 - /messMenu: To fetch mess menu (GET)

API is temporarily hosted in CLOUDFLARED for testing purpose
