This is a Node.js-based backend API built using Puppeteer to automate login and scrape data from the SASTRA University student portal.

API Endpoints:
 - /captcha: To fetch captcha and display in UI (GET)
 - /login: To get register number, password and captcha from user and login (POST)
 - /profile: To fetch name, register number, course and current semester and display under profile section (POST)
 - /profilePic: To fetch profile picture (POST)
 - /grievances: To submit grievances (POST)
 - /attendance: To fetch the overall attendance and display in home page (POST)
 - /sastraDue: To fetch the total SASTRA fee due (POST)
 - /hostelDue: To fetch the total Hostel fee due (POST)
 - /subjectWiseAttendance: To fetch subject-wise attendance (POST)
 - /hourWiseAttendance: To fetch hour-wise attendance (POST)
 - /currentSemCredits: To fetch the credits of current semester courses (POST) 
 - /bunk: To calculate bunks (POST)
 - /semGrades: To fetch semester-wise grades and credits (POST)
 - /internalMarks: To fetch total internal marks (POST)
 - /ciaWiseInternalMarks: To fetch cia-wise internal marks (POST)
 - /studentStatus: To fetch student status - Hosteler/Dayschloar (POST)
 - /sgpa: To fetch SGPA sem-wise (POST)
 - /cgpa: To fetch overall CGPA (POST)
 - /pyq: To fetch department-wise PYQs (GET)
 - /chatbot: To fetch PYQs based on text(input message) in community chat (POST)
 - /facultyList: To fetch faculty list (POST)
 - /timetable: To fetch timetable (POST)
 - /messMenu: To fetch mess menu (GET)

API is temporarily hosted in CLOUDFLARED for testing purpose