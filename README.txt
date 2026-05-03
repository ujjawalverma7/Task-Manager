Team Task Manager (Full-Stack)
==============================

This is a complete full-stack web app for the assignment:

- Authentication: signup and login
- Role-based access control: Admin and Member
- Project and team management
- Task creation, assignment, priority, due dates, and status tracking
- Dashboard with total, pending, in-progress, done, and overdue task counts
- REST API backend
- File-backed NoSQL-style JSON database
- Works locally and can be deployed on Railway

Tech Stack
----------

- Node.js HTTP server
- Vanilla HTML, CSS, and JavaScript frontend
- JSON database stored in data/db.json
- Password hashing with PBKDF2
- Signed auth tokens with Node crypto

How to Run Locally
------------------

1. Install Node.js 18 or newer.
2. Open a terminal in this folder.
3. Run:

   npm start

4. Open:

   http://localhost:3000

If you already have another React/Node app running on port 3000, use another
port instead:

   npm run start:3099

Then open:

   http://localhost:3099

Seed Login Accounts
-------------------

Admin:

  Email: admin@example.com
  Password: Admin@123

Member:

  Email: member@example.com
  Password: Member@123

Admin Features
--------------

- Create projects
- Add members to projects
- Create and assign tasks
- Update task details/status
- Delete projects and tasks
- View all projects and tasks

Member Features
---------------

- Login and view assigned/team projects
- View assigned/team tasks
- Update status of assigned tasks
- Track dashboard progress

REST API Routes
---------------

Public:

- POST /api/auth/signup
- POST /api/auth/login

Authenticated:

- GET /api/me
- GET /api/users
- GET /api/projects
- GET /api/tasks
- GET /api/dashboard

Admin only:

- POST /api/projects
- PUT /api/projects/:id
- DELETE /api/projects/:id
- POST /api/tasks
- DELETE /api/tasks/:id

Admin or assigned member:

- PUT /api/tasks/:id

Deploy on Railway
-----------------

1. Push this project to GitHub.
2. Create a new Railway project.
3. Connect the GitHub repository.
4. Railway should detect Node.js automatically.
5. Set these environment variables:

   PORT=3000
   JWT_SECRET=use-a-long-random-secret

6. Deploy the project.

Note
-----

- The database file is created automatically at data/db.json on first run.
- For production, always set JWT_SECRET in your hosting environment.
- If you want a fresh database, stop the server and delete data/db.json, then start again.
