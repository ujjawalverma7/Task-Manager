const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const portArgIndex = process.argv.findIndex((arg) => arg === "--port" || arg === "-p");
const cliPort = portArgIndex >= 0 ? process.argv[portArgIndex + 1] : null;
const PORT = Number(cliPort || process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-before-production";
const DB_FILE = path.join(__dirname, "data", "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

let db = null;
let writeQueue = Promise.resolve();

function now() {
  return new Date().toISOString();
}

function uid(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function defaultDb() {
  const admin = {
    id: uid("usr"),
    name: "Admin User",
    email: "admin@example.com",
    role: "admin",
    password: hashPassword("Admin@123"),
    createdAt: now()
  };

  const member = {
    id: uid("usr"),
    name: "Member User",
    email: "member@example.com",
    role: "member",
    password: hashPassword("Member@123"),
    createdAt: now()
  };

  const project = {
    id: uid("prj"),
    name: "Website Launch",
    description: "Plan and track the launch tasks for the new product website.",
    ownerId: admin.id,
    memberIds: [admin.id, member.id],
    createdAt: now()
  };

  return {
    users: [admin, member],
    projects: [project],
    tasks: [
      {
        id: uid("tsk"),
        projectId: project.id,
        title: "Prepare launch checklist",
        description: "Collect deployment, QA, analytics, and support readiness items.",
        status: "in-progress",
        priority: "high",
        assignedTo: member.id,
        dueDate: dateOffset(2),
        createdBy: admin.id,
        createdAt: now(),
        updatedAt: now()
      },
      {
        id: uid("tsk"),
        projectId: project.id,
        title: "Review mobile dashboard",
        description: "Check responsive views and fix spacing issues.",
        status: "todo",
        priority: "medium",
        assignedTo: member.id,
        dueDate: dateOffset(5),
        createdBy: admin.id,
        createdAt: now(),
        updatedAt: now()
      }
    ]
  };
}

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const attempt = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(attempt, "hex"));
}

function base64url(input) {
  return Buffer.from(JSON.stringify(input)).toString("base64url");
}

function signToken(user) {
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const payload = base64url({
    sub: user.id,
    role: user.role,
    name: user.name,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24
  });
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (data.exp < Math.floor(Date.now() / 1000)) return null;
  return db.users.find((user) => user.id === data.sub) || null;
}

async function loadDb() {
  await fsp.mkdir(path.dirname(DB_FILE), { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    db = defaultDb();
    await saveDb();
  } else {
    db = JSON.parse(await fsp.readFile(DB_FILE, "utf8"));
  }
}

async function saveDb() {
  writeQueue = writeQueue.then(() => fsp.writeFile(DB_FILE, JSON.stringify(db, null, 2)));
  return writeQueue;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  };
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, status, message, details) {
  send(res, status, { error: message, details });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const err = new Error("Invalid JSON body");
    err.status = 400;
    throw err;
  }
}

function requireAuth(req, res) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const user = verifyToken(token);
  if (!user) {
    sendError(res, 401, "Authentication required");
    return null;
  }
  return user;
}

function requireAdmin(user, res) {
  if (user.role !== "admin") {
    sendError(res, 403, "Admin access required");
    return false;
  }
  return true;
}

function validateRequired(body, fields) {
  const missing = fields.filter((field) => !String(body[field] || "").trim());
  return missing.length ? `Missing required field(s): ${missing.join(", ")}` : null;
}

function projectForUser(project, user) {
  return user.role === "admin" || project.memberIds.includes(user.id);
}

function taskForUser(task, user) {
  if (user.role === "admin") return true;
  const project = db.projects.find((item) => item.id === task.projectId);
  return task.assignedTo === user.id || (project && project.memberIds.includes(user.id));
}

async function api(req, res, url) {
  const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req) : {};

  if (req.method === "POST" && url.pathname === "/api/auth/signup") {
    const missing = validateRequired(body, ["name", "email", "password"]);
    if (missing) return sendError(res, 400, missing);
    const email = String(body.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendError(res, 400, "Enter a valid email address");
    if (String(body.password).length < 6) return sendError(res, 400, "Password must be at least 6 characters");
    if (db.users.some((user) => user.email === email)) return sendError(res, 409, "Email already registered");

    const firstUser = db.users.length === 0;
    const user = {
      id: uid("usr"),
      name: String(body.name).trim(),
      email,
      role: firstUser ? "admin" : "member",
      password: hashPassword(String(body.password)),
      createdAt: now()
    };
    db.users.push(user);
    await saveDb();
    return send(res, 201, { token: signToken(user), user: publicUser(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const missing = validateRequired(body, ["email", "password"]);
    if (missing) return sendError(res, 400, missing);
    const user = db.users.find((item) => item.email === String(body.email).trim().toLowerCase());
    if (!user || !verifyPassword(String(body.password), user.password)) {
      return sendError(res, 401, "Invalid email or password");
    }
    return send(res, 200, { token: signToken(user), user: publicUser(user) });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method === "GET" && url.pathname === "/api/me") {
    return send(res, 200, { user: publicUser(user) });
  }

  if (req.method === "GET" && url.pathname === "/api/users") {
    return send(res, 200, { users: db.users.map(publicUser) });
  }

  if (req.method === "GET" && url.pathname === "/api/projects") {
    const projects = db.projects.filter((project) => projectForUser(project, user));
    return send(res, 200, { projects });
  }

  if (req.method === "POST" && url.pathname === "/api/projects") {
    if (!requireAdmin(user, res)) return;
    const missing = validateRequired(body, ["name"]);
    if (missing) return sendError(res, 400, missing);
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds.filter((id) => db.users.some((u) => u.id === id)) : [];
    const project = {
      id: uid("prj"),
      name: String(body.name).trim(),
      description: String(body.description || "").trim(),
      ownerId: user.id,
      memberIds: Array.from(new Set([user.id, ...memberIds])),
      createdAt: now()
    };
    db.projects.push(project);
    await saveDb();
    return send(res, 201, { project });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/projects/")) {
    if (!requireAdmin(user, res)) return;
    const id = url.pathname.split("/").at(-1);
    const project = db.projects.find((item) => item.id === id);
    if (!project) return sendError(res, 404, "Project not found");
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds.filter((uidValue) => db.users.some((u) => u.id === uidValue)) : project.memberIds;
    project.name = String(body.name || project.name).trim();
    project.description = String(body.description ?? project.description).trim();
    project.memberIds = Array.from(new Set([project.ownerId, ...memberIds]));
    await saveDb();
    return send(res, 200, { project });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/projects/")) {
    if (!requireAdmin(user, res)) return;
    const id = url.pathname.split("/").at(-1);
    const before = db.projects.length;
    db.projects = db.projects.filter((project) => project.id !== id);
    db.tasks = db.tasks.filter((task) => task.projectId !== id);
    if (before === db.projects.length) return sendError(res, 404, "Project not found");
    await saveDb();
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/tasks") {
    const tasks = db.tasks.filter((task) => taskForUser(task, user));
    return send(res, 200, { tasks });
  }

  if (req.method === "POST" && url.pathname === "/api/tasks") {
    if (!requireAdmin(user, res)) return;
    const missing = validateRequired(body, ["projectId", "title", "assignedTo", "dueDate"]);
    if (missing) return sendError(res, 400, missing);
    const project = db.projects.find((item) => item.id === body.projectId);
    if (!project) return sendError(res, 404, "Project not found");
    if (!project.memberIds.includes(body.assignedTo)) return sendError(res, 400, "Assignee must be a project member");
    const task = {
      id: uid("tsk"),
      projectId: project.id,
      title: String(body.title).trim(),
      description: String(body.description || "").trim(),
      status: ["todo", "in-progress", "done"].includes(body.status) ? body.status : "todo",
      priority: ["low", "medium", "high"].includes(body.priority) ? body.priority : "medium",
      assignedTo: body.assignedTo,
      dueDate: String(body.dueDate),
      createdBy: user.id,
      createdAt: now(),
      updatedAt: now()
    };
    db.tasks.push(task);
    await saveDb();
    return send(res, 201, { task });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/tasks/")) {
    const id = url.pathname.split("/").at(-1);
    const task = db.tasks.find((item) => item.id === id);
    if (!task) return sendError(res, 404, "Task not found");
    if (user.role !== "admin" && task.assignedTo !== user.id) return sendError(res, 403, "You can update only your assigned tasks");

    if (user.role === "admin") {
      if (body.title !== undefined) task.title = String(body.title).trim();
      if (body.description !== undefined) task.description = String(body.description).trim();
      if (body.priority !== undefined && ["low", "medium", "high"].includes(body.priority)) task.priority = body.priority;
      if (body.dueDate !== undefined) task.dueDate = String(body.dueDate);
      if (body.assignedTo !== undefined) {
        const project = db.projects.find((item) => item.id === task.projectId);
        if (!project.memberIds.includes(body.assignedTo)) return sendError(res, 400, "Assignee must be a project member");
        task.assignedTo = body.assignedTo;
      }
    }
    if (body.status !== undefined && ["todo", "in-progress", "done"].includes(body.status)) {
      task.status = body.status;
    }
    task.updatedAt = now();
    await saveDb();
    return send(res, 200, { task });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/tasks/")) {
    if (!requireAdmin(user, res)) return;
    const id = url.pathname.split("/").at(-1);
    const before = db.tasks.length;
    db.tasks = db.tasks.filter((task) => task.id !== id);
    if (before === db.tasks.length) return sendError(res, 404, "Task not found");
    await saveDb();
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    const visibleTasks = db.tasks.filter((task) => taskForUser(task, user));
    const today = new Date().toISOString().slice(0, 10);
    const stats = {
      projects: db.projects.filter((project) => projectForUser(project, user)).length,
      total: visibleTasks.length,
      todo: visibleTasks.filter((task) => task.status === "todo").length,
      inProgress: visibleTasks.filter((task) => task.status === "in-progress").length,
      done: visibleTasks.filter((task) => task.status === "done").length,
      overdue: visibleTasks.filter((task) => task.status !== "done" && task.dueDate < today).length
    };
    return send(res, 200, { stats });
  }

  sendError(res, 404, "API route not found");
}

async function staticFile(req, res, url) {
  let filePath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolute = path.join(PUBLIC_DIR, filePath);
  if (!absolute.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    const file = await fsp.readFile(absolute);
    const ext = path.extname(absolute);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(file);
  } catch {
    const fallback = await fsp.readFile(path.join(PUBLIC_DIR, "index.html"));
    res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
    res.end(fallback);
  }
}

async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      return await api(req, res, url);
    }
    return await staticFile(req, res, url);
  } catch (error) {
    console.error(error);
    sendError(res, error.status || 500, error.message || "Server error");
  }
}

loadDb().then(() => {
  http.createServer(handler).listen(PORT, () => {
    console.log(`Team Task Manager running at http://localhost:${PORT}`);
    console.log("Seed login: admin@example.com / Admin@123");
  });
});
