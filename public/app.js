const state = {
  token: localStorage.getItem("ttm_token"),
  user: JSON.parse(localStorage.getItem("ttm_user") || "null"),
  users: [],
  projects: [],
  tasks: [],
  stats: null,
  mode: "login",
  view: "dashboard"
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function api(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  });
}

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem("ttm_token", token);
  localStorage.setItem("ttm_user", JSON.stringify(user));
}

function clearSession() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("ttm_token");
  localStorage.removeItem("ttm_user");
}

function showApp() {
  $("#auth-screen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#user-name").textContent = state.user.name;
  $("#user-email").textContent = state.user.email;
  $("#role-pill").textContent = state.user.role === "admin" ? "Admin access" : "Member access";
  $$(".admin-only").forEach((el) => el.classList.toggle("hidden", state.user.role !== "admin"));
}

function showAuth() {
  $("#auth-screen").classList.remove("hidden");
  $("#app").classList.add("hidden");
}

function switchAuthMode(mode) {
  state.mode = mode;
  $("#login-tab").classList.toggle("active", mode === "login");
  $("#signup-tab").classList.toggle("active", mode === "signup");
  $("#name-field").classList.toggle("hidden", mode === "login");
  $("#email").value = mode === "login" ? "admin@example.com" : "";
  $("#password").value = mode === "login" ? "Admin@123" : "";
  $("#auth-error").textContent = "";
}

function setView(view) {
  state.view = view;
  $$(".view").forEach((el) => el.classList.add("hidden"));
  $(`#${view}-view`).classList.remove("hidden");
  $$(".nav").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $("#page-title").textContent = view.charAt(0).toUpperCase() + view.slice(1);
}

function userById(id) {
  return state.users.find((user) => user.id === id) || { name: "Unassigned", email: "" };
}

function projectById(id) {
  return state.projects.find((project) => project.id === id) || { name: "Unknown project", memberIds: [] };
}

function isOverdue(task) {
  return task.status !== "done" && task.dueDate < new Date().toISOString().slice(0, 10);
}

function renderStats() {
  const stats = state.stats || {};
  const items = [
    ["Projects", stats.projects || 0],
    ["Total", stats.total || 0],
    ["To Do", stats.todo || 0],
    ["In Progress", stats.inProgress || 0],
    ["Done", stats.done || 0],
    ["Overdue", stats.overdue || 0]
  ];
  $("#stats-grid").innerHTML = items
    .map(([label, value]) => `<article class="stat"><span class="meta">${label}</span><strong>${value}</strong></article>`)
    .join("");
}

function taskCard(task) {
  const assignee = userById(task.assignedTo);
  const project = projectById(task.projectId);
  const canDelete = state.user.role === "admin";
  return `
    <article class="task-card">
      <div class="card-head">
        <h3>${escapeHtml(task.title)}</h3>
        <span class="pill ${task.priority}">${task.priority}</span>
      </div>
      <p>${escapeHtml(task.description || "No description")}</p>
      <div class="pill-row">
        <span class="pill">${escapeHtml(project.name)}</span>
        <span class="pill">${escapeHtml(assignee.name)}</span>
        <span class="pill ${isOverdue(task) ? "overdue" : ""}">${task.dueDate}</span>
      </div>
      <div class="task-actions">
        <select data-status="${task.id}">
          <option value="todo" ${task.status === "todo" ? "selected" : ""}>To Do</option>
          <option value="in-progress" ${task.status === "in-progress" ? "selected" : ""}>In Progress</option>
          <option value="done" ${task.status === "done" ? "selected" : ""}>Done</option>
        </select>
        ${canDelete ? `<button class="danger" data-delete-task="${task.id}" type="button">Delete</button>` : ""}
      </div>
    </article>
  `;
}

function renderTasks() {
  const columns = {
    todo: $("#todo-column"),
    "in-progress": $("#in-progress-column"),
    done: $("#done-column")
  };
  Object.values(columns).forEach((column) => (column.innerHTML = ""));
  state.tasks.forEach((task) => {
    columns[task.status].insertAdjacentHTML("beforeend", taskCard(task));
  });
  Object.entries(columns).forEach(([, column]) => {
    if (!column.innerHTML.trim()) column.innerHTML = `<p class="muted">No tasks here.</p>`;
  });
  $("#recent-tasks").innerHTML = state.tasks.slice(0, 5).map(taskCard).join("") || `<p class="muted">No tasks yet.</p>`;
}

function renderProjects() {
  $("#project-list").innerHTML =
    state.projects
      .map((project) => {
        const members = project.memberIds.map((id) => userById(id).name).join(", ");
        const taskCount = state.tasks.filter((task) => task.projectId === project.id).length;
        return `
          <article class="card">
            <div class="card-head">
              <h3>${escapeHtml(project.name)}</h3>
              <span class="pill">${taskCount} tasks</span>
            </div>
            <p class="muted">${escapeHtml(project.description || "No description")}</p>
            <p class="meta">Team: ${escapeHtml(members)}</p>
            ${state.user.role === "admin" ? `<button class="danger" data-delete-project="${project.id}" type="button">Delete project</button>` : ""}
          </article>
        `;
      })
      .join("") || `<p class="muted">No projects yet.</p>`;
}

function renderTeam() {
  $("#team-list").innerHTML = state.users
    .map(
      (user) => `
        <article class="card">
          <div class="card-head">
            <h3>${escapeHtml(user.name)}</h3>
            <span class="pill">${user.role}</span>
          </div>
          <p class="meta">${escapeHtml(user.email)}</p>
        </article>
      `
    )
    .join("");
}

function renderForms() {
  $("#project-members").innerHTML = state.users
    .map((user) => `<option value="${user.id}">${escapeHtml(user.name)} (${user.role})</option>`)
    .join("");

  $("#task-project").innerHTML = state.projects.map((project) => `<option value="${project.id}">${escapeHtml(project.name)}</option>`).join("");
  const selectedProject = state.projects[0];
  const assigneeIds = selectedProject ? selectedProject.memberIds : [];
  $("#task-assignee").innerHTML = assigneeIds
    .map((id) => {
      const user = userById(id);
      return `<option value="${user.id}">${escapeHtml(user.name)}</option>`;
    })
    .join("");
  $("#task-due").value = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
}

function renderAll() {
  renderStats();
  renderProjects();
  renderTasks();
  renderTeam();
  renderForms();
}

async function loadAll() {
  const [users, projects, tasks, dashboard] = await Promise.all([
    api("/api/users"),
    api("/api/projects"),
    api("/api/tasks"),
    api("/api/dashboard")
  ]);
  state.users = users.users;
  state.projects = projects.projects;
  state.tasks = tasks.tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  state.stats = dashboard.stats;
  renderAll();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

$("#login-tab").addEventListener("click", () => switchAuthMode("login"));
$("#signup-tab").addEventListener("click", () => switchAuthMode("signup"));

$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#auth-error").textContent = "";
  try {
    const body = {
      email: $("#email").value,
      password: $("#password").value
    };
    if (state.mode === "signup") body.name = $("#name").value;
    const data = await api(`/api/auth/${state.mode}`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    saveSession(data.token, data.user);
    showApp();
    await loadAll();
  } catch (error) {
    $("#auth-error").textContent = error.message;
  }
});

$("#logout").addEventListener("click", () => {
  clearSession();
  showAuth();
});

$$(".nav").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));

$("#project-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const memberIds = Array.from($("#project-members").selectedOptions).map((option) => option.value);
  await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      name: $("#project-name").value,
      description: $("#project-description").value,
      memberIds
    })
  });
  event.target.reset();
  await loadAll();
});

$("#task-project").addEventListener("change", () => {
  const project = projectById($("#task-project").value);
  $("#task-assignee").innerHTML = project.memberIds
    .map((id) => {
      const user = userById(id);
      return `<option value="${user.id}">${escapeHtml(user.name)}</option>`;
    })
    .join("");
});

$("#task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      projectId: $("#task-project").value,
      assignedTo: $("#task-assignee").value,
      title: $("#task-title").value,
      description: $("#task-description").value,
      dueDate: $("#task-due").value,
      priority: $("#task-priority").value
    })
  });
  event.target.reset();
  await loadAll();
});

document.addEventListener("change", async (event) => {
  const id = event.target.dataset.status;
  if (!id) return;
  await api(`/api/tasks/${id}`, {
    method: "PUT",
    body: JSON.stringify({ status: event.target.value })
  });
  await loadAll();
});

document.addEventListener("click", async (event) => {
  const taskId = event.target.dataset.deleteTask;
  const projectId = event.target.dataset.deleteProject;
  if (taskId) {
    await api(`/api/tasks/${taskId}`, { method: "DELETE" });
    await loadAll();
  }
  if (projectId) {
    await api(`/api/projects/${projectId}`, { method: "DELETE" });
    await loadAll();
  }
});

(async function init() {
  if (!state.token || !state.user) return showAuth();
  try {
    const data = await api("/api/me");
    state.user = data.user;
    showApp();
    await loadAll();
  } catch {
    clearSession();
    showAuth();
  }
})();
