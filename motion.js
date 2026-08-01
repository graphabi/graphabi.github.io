(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const timersByScene = new WeakMap();

  const clearScene = (scene) => {
    (timersByScene.get(scene) || []).forEach(window.clearTimeout);
    timersByScene.set(scene, []);
  };

  const schedule = (scene, delay, action) => {
    const timers = timersByScene.get(scene) || [];
    timers.push(window.setTimeout(action, delay));
    timersByScene.set(scene, timers);
  };

  const announce = (scene, text) => {
    const phase = scene.querySelector("[data-scene-phase]");
    const live = scene.querySelector("[data-scene-live]");
    if (phase) phase.textContent = text;
    if (live) live.textContent = text;
  };

  const finish = (scene) => {
    scene.className = "pulse-scene is-complete";
    announce(scene, "Break found: researcher to verifier");
    const button = scene.querySelector("[data-replay]");
    if (button) button.disabled = false;
  };

  const play = (scene) => {
    clearScene(scene);
    if (reducedMotion.matches) {
      finish(scene);
      return;
    }
    const button = scene.querySelector("[data-replay]");
    if (button) button.disabled = true;
    scene.className = "pulse-scene is-playing";
    announce(scene, "Run begins: loading recorded nodes");
    schedule(scene, 180, () => { scene.classList.add("nodes-active"); announce(scene, "Flow: nodes activated"); });
    schedule(scene, 720, () => { scene.classList.add("baseline-active"); announce(scene, "Check: baseline contracts pass"); });
    schedule(scene, 1900, () => { scene.classList.remove("baseline-active"); scene.classList.add("candidate-active"); announce(scene, "Candidate swapped: schema remains valid"); });
    schedule(scene, 2550, () => { scene.classList.add("broken-active"); announce(scene, "Break: researcher to verifier"); });
    schedule(scene, 2870, () => { scene.classList.add("impact-active"); announce(scene, "Trace: downstream impact identified"); });
    schedule(scene, 3370, () => { scene.classList.add("witness-active"); announce(scene, "Explain: trace-backed witness revealed"); });
    schedule(scene, 3870, () => finish(scene));
  };

  document.querySelectorAll("[data-pulse-scene]").forEach((scene) => {
    const button = scene.querySelector("[data-replay]");
    if (button) button.addEventListener("click", () => play(scene));
    window.setTimeout(() => play(scene), 260);
  });

  const playground = document.querySelector("[data-playground]");
  if (playground) {
    let choice = "baseline";
    const result = playground.querySelector("[data-play-result]");
    const choices = [...playground.querySelectorAll("[data-play-choice]")];
    const setChoice = (value) => {
      choice = value;
      choices.forEach((button) => {
        const selected = button.dataset.playChoice === value;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
      playground.className = "playground";
      if (result) result.innerHTML = "<strong>Select an output and run the check.</strong><span>The graph will report the observed contract state here.</span>";
    };
    choices.forEach((button) => button.addEventListener("click", () => setChoice(button.dataset.playChoice)));
    const run = playground.querySelector("[data-play-run]");
    if (run) run.addEventListener("click", () => {
      playground.className = `playground is-running ${choice === "candidate" ? "is-candidate" : "is-baseline"}`;
      if (result) result.innerHTML = choice === "candidate"
        ? "<strong class=fail>BREAK: verified=true, opened_sources_count=0.</strong><span>The pulse stopped at researcher to verifier. The witness is the missing source access.</span>"
        : "<strong class=pass>PASS: verified=true, opened_sources_count=1.</strong><span>The pulse reached verifier with the supporting source recorded.</span>";
      if (reducedMotion.matches) playground.classList.add("is-settled");
    });
  }

  const modal = document.querySelector("[data-setup-modal]");
  if (modal) {
    const dialog = modal.querySelector(".setup-dialog");
    const openers = [...document.querySelectorAll("[data-open-setup]")];
    const closers = [...modal.querySelectorAll("[data-close-setup]")];
    const tabs = [...modal.querySelectorAll("[data-setup-option]")];
    const panels = [...modal.querySelectorAll("[data-setup-panel]")];
    let previousFocus;
    const focusables = () => [...modal.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
    const close = () => {
      modal.classList.remove("is-open");
      window.setTimeout(() => { modal.hidden = true; document.body.classList.remove("modal-open"); }, reducedMotion.matches ? 0 : 240);
      if (previousFocus) previousFocus.focus();
    };
    const open = () => {
      previousFocus = document.activeElement;
      modal.hidden = false;
      document.body.classList.add("modal-open");
      window.requestAnimationFrame(() => { modal.classList.add("is-open"); dialog.focus(); });
    };
    const select = (value) => {
      tabs.forEach((tab) => {
        const active = tab.dataset.setupOption === value;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
      });
      panels.forEach((panel) => { panel.hidden = panel.dataset.setupPanel !== value; panel.classList.toggle("is-active", panel.dataset.setupPanel === value); });
    };
    openers.forEach((button) => button.addEventListener("click", open));
    closers.forEach((button) => button.addEventListener("click", close));
    tabs.forEach((tab) => tab.addEventListener("click", () => select(tab.dataset.setupOption)));
    modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    modal.querySelectorAll("[data-copy-command]").forEach((button) => button.addEventListener("click", async () => {
      const panel = button.closest(".setup-panel");
      const command = panel.querySelector("[data-setup-command]").textContent;
      try { await navigator.clipboard.writeText(command); } catch (error) {
        const area = document.createElement("textarea"); area.value = command; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0"; document.body.appendChild(area); area.select(); document.execCommand("copy"); area.remove();
      }
      button.classList.add("copied");
      const feedback = panel.querySelector("[data-copy-feedback]");
      if (feedback) feedback.textContent = "Copied";
      window.setTimeout(() => { button.classList.remove("copied"); if (feedback) feedback.textContent = ""; }, 1600);
    }));
  }

  reducedMotion.addEventListener("change", () => document.querySelectorAll("[data-pulse-scene]").forEach(finish));
})();
