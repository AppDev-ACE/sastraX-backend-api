This is a Node.js-based backend API built using Puppeteer to automate login and scrape data from the SASTRA University student portal. It provides endpoints for:

- Fetching captcha image
- Student login validation
- Attendance percentage
- Fee due amount
  (as of now)

API Endpoints:
 - /captcha: To fetch captcha and display in UI (GET)
 - /login: To get register number, password and captcha from user and login (POST)
 - /profile: To fetch name, register number, profile picture, course and current semester and display under profile section (GET)
 - /attendance: To fetch the overall attendance and display in home page (GET)
 - /sastraDue: To fetch the total SASTRA fee due (GET)
 - /hostelDue: To fetch the total Hostel fee due (GET)

API is temporarily hosted in public for testing purpose
