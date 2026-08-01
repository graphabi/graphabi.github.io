(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const timersByScene = new WeakMap();

  const clearScene = (scene) => {
    const timers = timersByScene.get(scene) || [];
    timers.forEach(window.clearTimeout);
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
    announce(scene, "Break found · researcher → verifier");
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
    announce(scene, "Run begins · loading recorded nodes");

    schedule(scene, 180, () => {
      scene.classList.add("nodes-active");
      announce(scene, "Flow · nodes activated");
    });
    schedule(scene, 720, () => {
      scene.classList.add("baseline-active");
      announce(scene, "Check · baseline contracts pass");
    });
    schedule(scene, 1900, () => {
      scene.classList.remove("baseline-active");
      scene.classList.add("candidate-active");
      announce(scene, "Candidate swapped · schema remains valid");
    });
    schedule(scene, 2550, () => {
      scene.classList.add("broken-active");
      announce(scene, "Break · researcher → verifier");
    });
    schedule(scene, 2870, () => {
      scene.classList.add("impact-active");
      announce(scene, "Trace · downstream impact identified");
    });
    schedule(scene, 3370, () => {
      scene.classList.add("witness-active");
      announce(scene, "Explain · trace-backed witness revealed");
    });
    schedule(scene, 3870, () => finish(scene));
  };

  const scenes = [...document.querySelectorAll("[data-pulse-scene]")];
  scenes.forEach((scene) => {
    const button = scene.querySelector("[data-replay]");
    if (button) button.addEventListener("click", () => play(scene));
  });

  if (!reducedMotion.matches && "IntersectionObserver" in window) {
    document.body.classList.add("motion-enabled");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("entered");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8%", threshold: 0.12 },
    );
    document.querySelectorAll("[data-enter]").forEach((element) => observer.observe(element));
  }

  reducedMotion.addEventListener("change", () => {
    scenes.forEach((scene) => finish(scene));
    document.body.classList.remove("motion-enabled");
    document.querySelectorAll("[data-enter]").forEach((element) => element.classList.add("entered"));
  });

  window.setTimeout(() => scenes.forEach((scene) => play(scene)), 260);
})();
