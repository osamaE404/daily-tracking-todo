export const completionPercent = (done, total) => Math.round((done / total) * 100);

export const hasCollapsedAncestor = (row, byId) => {
  let parent = byId.get(row.dataset.parent);

  while (parent) {
    if (parent.getAttribute("aria-expanded") === "false") return true;
    parent = byId.get(parent.dataset.parent);
  }

  return false;
};

const tree = typeof document === "undefined" ? null : document.querySelector("[data-tree]");
const planner = typeof document === "undefined" ? null : document.querySelector("[data-planner-demo]");

if (planner) {
  const item = (title, meta, options = {}) => ({ title, meta, ...options });
  const views = {
    today: { kicker: "Today", title: "Back in motion", items: [
      item("Prepare client delivery", "Today at 16:00", { progress: "3 / 12", priority: "red" }),
      item("Confirm requirements", "Completed", { done: true, child: true }),
      item("Review implementation", "Today at 13:30", { priority: "amber", child: true }),
      item("Package the handoff", "Tomorrow", { child: true }),
      item("Evening walk", "30 minute habit", { progress: "8 days" }),
    ] },
    week: { kicker: "This week", title: "Choose the week", items: [
      item("Client delivery", "Monday at 16:00", { progress: "12 steps", priority: "red" }),
      item("Review implementation", "Tuesday", { progress: "4 steps", priority: "amber" }),
      item("Migration rehearsal", "Thursday at 10:00"),
      item("Client handoff", "Friday at 15:00"),
      item("Weekly reset", "Friday afternoon", { progress: "20 min" }),
    ] },
    projects: { kicker: "Projects", title: "Work with full depth", items: [
      item("Release client portal", "Active project", { progress: "20%", priority: "red" }),
      item("Application", "5 open tasks", { child: true }),
      item("Billing workflow", "2 open tasks", { priority: "amber", child: true }),
      item("Launch", "2 open tasks", { child: true }),
      item("Personal systems", "Planning"),
    ] },
    habits: { kicker: "Habits", title: "Small promises kept", items: [
      item("Morning planning", "Completed today", { progress: "14 days", done: true }),
      item("Evening walk", "30 minutes", { progress: "8 days" }),
      item("Read", "20 minutes", { progress: "5 days" }),
      item("Stretch", "10 minutes", { progress: "3 days" }),
      item("Prepare tomorrow", "Before sleep"),
    ] },
    focus: { kicker: "Focus", title: "One thing at a time", items: [
      item("Review implementation", "Ready for a focus block", { progress: "25 min", priority: "amber" }),
      item("Silence notifications", "Focus preparation", { done: true, child: true }),
      item("Open implementation notes", "Focus preparation", { done: true, child: true }),
      item("Record the next step", "After the timer", { child: true }),
      item("Focus history", "Today", { progress: "50 min" }),
    ] },
  };
  const nav = [...planner.querySelectorAll("[data-planner-view]")];
  const tasks = [...planner.querySelectorAll("[data-planner-task]")];
  const focus = planner.querySelector("[data-focus-timer]");
  let activeView = "today";
  let remaining = 25 * 60;
  let focusInterval;

  const renderPlanner = () => {
    const { kicker, title, items } = views[activeView];
    planner.querySelector("[data-planner-kicker]").textContent = kicker;
    planner.querySelector("[data-planner-title]").textContent = title;
    planner.querySelector("[data-planner-count]").textContent = `${items.filter(({ done }) => done).length} of ${items.length}`;

    tasks.forEach((task, index) => {
      const { title: name, meta, progress = "", priority = "", done = false, child = false } = items[index];
      task.className = `task${child ? " child" : ""}${done ? " complete" : ""}${priority ? ` priority-${priority}` : ""}`;
      task.querySelector("b").textContent = name;
      task.querySelector("small").textContent = meta;
      task.querySelector(".task-progress").textContent = progress;
      task.querySelector(".checkbox").textContent = done ? "✓" : "";
      task.setAttribute("aria-pressed", String(done));
      task.setAttribute("aria-label", `Mark ${name} ${done ? "incomplete" : "complete"}`);
    });
  };

  nav.forEach((button) => button.addEventListener("click", () => {
    activeView = button.dataset.plannerView;
    nav.forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    renderPlanner();
  }));

  tasks.forEach((task, index) => task.addEventListener("click", () => {
    const selected = views[activeView].items[index];
    selected.done = !selected.done;
    renderPlanner();
  }));

  const renderTimer = () => {
    const minutes = Math.floor(remaining / 60);
    planner.querySelector("[data-focus-time]").textContent = `${minutes}:${String(remaining % 60).padStart(2, "0")}`;
  };

  focus.addEventListener("click", () => {
    const running = focus.getAttribute("aria-pressed") !== "true";
    focus.setAttribute("aria-pressed", String(running));
    focus.classList.toggle("running", running);
    planner.querySelector("[data-focus-label]").textContent = running ? "Pause focus" : "Resume focus";
    clearInterval(focusInterval);
    if (running) focusInterval = setInterval(() => {
      remaining = Math.max(0, remaining - 1);
      renderTimer();
      if (!remaining) focus.click();
    }, 1000);
  });

  if (matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)").matches) {
    planner.addEventListener("pointermove", (event) => {
      const bounds = planner.getBoundingClientRect();
      planner.style.setProperty("--tilt-x", `${((event.clientY - bounds.top) / bounds.height - 0.5) * -5}deg`);
      planner.style.setProperty("--tilt-y", `${((event.clientX - bounds.left) / bounds.width - 0.5) * 7}deg`);
    });
    planner.addEventListener("pointerleave", () => {
      planner.style.removeProperty("--tilt-x");
      planner.style.removeProperty("--tilt-y");
    });
  }

  renderPlanner();
}

if (tree) {
  const rows = [...tree.querySelectorAll(".tree-row")];
  const byId = new Map(rows.map((row) => [row.dataset.id, row]));
  const detail = {
    title: tree.querySelector("[data-detail-title]"),
    description: tree.querySelector("[data-detail-description]"),
    due: tree.querySelector("[data-detail-due]"),
    priority: tree.querySelector("[data-detail-priority]"),
    state: tree.querySelector("[data-detail-state]"),
    reminder: tree.querySelector("[data-detail-reminder]"),
    note: tree.querySelector("[data-detail-note]"),
    check: tree.querySelector(".detail-check"),
  };

  let selected = tree.querySelector(".tree-row.selected");

  const renderVisibility = () => {
    for (const row of rows) {
      row.hidden = hasCollapsedAncestor(row, byId);
    }
  };

  const renderProgress = () => {
    const done = rows.filter((row) => row.classList.contains("done")).length;
    tree.querySelector("[data-progress-percent]").textContent = `${completionPercent(done, rows.length)}%`;
    tree.querySelector("[data-progress-count]").textContent = `${done} of ${rows.length} complete`;
  };

  const renderDetail = () => {
    const done = selected.classList.contains("done");
    detail.title.textContent = selected.dataset.title;
    detail.description.textContent = selected.dataset.description;
    detail.due.textContent = selected.dataset.due;
    detail.priority.textContent = selected.dataset.priority;
    detail.state.textContent = done ? "Complete" : "Open";
    detail.reminder.textContent = selected.dataset.reminder;
    detail.note.textContent = selected.dataset.note;
    detail.check.setAttribute("aria-pressed", String(done));
    detail.check.setAttribute("aria-label", `Mark ${selected.dataset.title} ${done ? "incomplete" : "complete"}`);
    detail.check.querySelector(".checkbox").textContent = done ? "✓" : "";
  };

  const toggleDone = (row) => {
    const done = row.classList.toggle("done");
    const check = row.querySelector(".tree-check");
    check.setAttribute("aria-pressed", String(done));
    check.setAttribute("aria-label", `Mark ${row.dataset.title} ${done ? "incomplete" : "complete"}`);
    check.querySelector(".checkbox").textContent = done ? "✓" : "";
    renderProgress();
    if (row === selected) renderDetail();
  };

  for (const row of rows) {
    row.querySelector(".tree-toggle")?.addEventListener("click", (event) => {
      const expanded = row.getAttribute("aria-expanded") !== "false";
      row.setAttribute("aria-expanded", String(!expanded));
      row.classList.toggle("open", !expanded);
      event.currentTarget.setAttribute("aria-expanded", String(!expanded));
      event.currentTarget.setAttribute("aria-label", `${expanded ? "Expand" : "Collapse"} ${row.dataset.title}`);
      event.currentTarget.textContent = expanded ? "+" : "−";
      renderVisibility();
    });

    row.querySelector(".tree-check").addEventListener("click", () => toggleDone(row));
    row.querySelector(".tree-label").addEventListener("click", () => {
      selected.classList.remove("selected");
      selected.setAttribute("aria-selected", "false");
      selected = row;
      selected.classList.add("selected");
      selected.setAttribute("aria-selected", "true");
      renderDetail();
    });
  }

  detail.check.addEventListener("click", () => toggleDone(selected));
  renderVisibility();
  renderProgress();
  renderDetail();
}
