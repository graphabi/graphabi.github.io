/* =============================================================================
   GraphABI — product motion
   -----------------------------------------------------------------------------
   Everything here is causal. Motion exists to show where meaning flowed, what
   checked it, where it stopped, and what that reached. Nothing loops, and no
   state is expressed by motion alone: the final frame always carries the
   whole result in text and colour.
   ========================================================================== */

(() => {
  "use strict";

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

  /* ------------------------------------------------- edge measurement ---
     Pulses travel with transform, which needs the edge's pixel length.
     One ResizeObserver keeps the custom property honest across breakpoints. */

  const measured = $$(".graph-edge, .playground-edge");
  if (measured.length && "ResizeObserver" in window) {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target;
        el.style.setProperty("--edge-w", el.offsetWidth + "px");
        el.style.setProperty("--edge-h", el.offsetHeight + "px");
      }
    });
    measured.forEach((el) => ro.observe(el));
  }

  /* --------------------------------------------------- canonical replay --- */

  const timers = new WeakMap();

  const clear = (scene) => {
    (timers.get(scene) || []).forEach(clearTimeout);
    timers.set(scene, []);
  };

  const after = (scene, delay, fn) => {
    const list = timers.get(scene) || [];
    list.push(setTimeout(fn, delay));
    timers.set(scene, list);
  };

  const announce = (scene, text) => {
    const phase = $("[data-scene-phase]", scene);
    const live = $("[data-scene-live]", scene);
    if (phase) phase.textContent = text;
    if (live) live.textContent = text;
  };

  const finish = (scene) => {
    clear(scene);
    scene.className = "pulse-scene is-complete";
    announce(scene, "Break found · researcher → verifier");
    const button = $("[data-replay]", scene);
    if (button) button.disabled = false;
  };

  const play = (scene) => {
    clear(scene);
    if (reduced.matches) return finish(scene);

    const button = $("[data-replay]", scene);
    if (button) button.disabled = true;
    scene.className = "pulse-scene is-playing";
    announce(scene, "Loading recorded nodes");

    // Flow, check, break, trace, explain. The order is the product.
    // Hop length and blast stagger are mirrored in styles.css.
    after(scene, 160, () => { scene.classList.add("nodes-active"); announce(scene, "Flow · nodes resolved in topology order"); });
    after(scene, 700, () => { scene.classList.add("baseline-active"); announce(scene, "Check · baseline pulse crosses every edge"); });
    after(scene, 2060, () => { scene.classList.add("resetting"); });
    after(scene, 2400, () => {
      scene.classList.remove("baseline-active", "resetting");
      scene.classList.add("candidate-active");
      announce(scene, "Candidate swapped · schema still valid");
    });
    after(scene, 3340, () => { scene.classList.add("broken-active"); announce(scene, "Break · researcher → verifier"); });
    after(scene, 3760, () => { scene.classList.add("impact-active"); announce(scene, "Trace · downstream impact identified"); });
    after(scene, 4560, () => { scene.classList.add("witness-active"); announce(scene, "Explain · trace-backed witness recorded"); });
    after(scene, 5200, () => finish(scene));
  };

  $$("[data-pulse-scene]").forEach((scene) => {
    const button = $("[data-replay]", scene);
    if (button) button.addEventListener("click", () => play(scene));

    // Autoplay once, only when the scene is actually on screen, and never
    // move focus while it runs.
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          io.disconnect();
          setTimeout(() => play(scene), 240);
        });
      }, { threshold: 0.25 });
      io.observe(scene);
    } else {
      setTimeout(() => play(scene), 240);
    }
  });

  /* ------------------------------------------------------- playground --- */

  const playground = $("[data-playground]");
  if (playground) {
    const result = $("[data-play-result]", playground);
    const choices = $$("[data-play-choice]", playground);
    const thumb = $(".segment-thumb", playground);
    const run = $("[data-play-run]", playground);
    let choice = "baseline";

    const moveThumb = () => {
      const active = choices.find((b) => b.classList.contains("is-selected"));
      if (!active || !thumb) return;
      thumb.style.width = active.offsetWidth + "px";
      thumb.style.transform = `translateX(${active.offsetLeft - choices[0].offsetLeft}px)`;
    };

    const reset = () => {
      playground.className = "playground";
      if (result) {
        result.innerHTML =
          "<strong>Select an output and run the check.</strong>" +
          "<span>The graph will report the observed contract state here.</span>";
      }
    };

    const setChoice = (value) => {
      choice = value;
      choices.forEach((button) => {
        const on = button.dataset.playChoice === value;
        button.classList.toggle("is-selected", on);
        button.setAttribute("aria-pressed", String(on));
      });
      moveThumb();
      reset();
    };

    choices.forEach((b) => b.addEventListener("click", () => setChoice(b.dataset.playChoice)));
    requestAnimationFrame(moveThumb);
    window.addEventListener("resize", moveThumb, { passive: true });
    // Inter arriving late changes the label widths the thumb is sized from.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveThumb);

    if (run) {
      run.addEventListener("click", () => {
        // Restart cleanly so a second run replays rather than doing nothing.
        playground.className = "playground";
        void playground.offsetWidth;
        playground.className = `playground is-running ${choice === "candidate" ? "is-candidate" : "is-baseline"}`;
        if (!result) return;
        result.innerHTML = choice === "candidate"
          ? "<strong class='fail'>BREAKING · verified=true with opened_sources_count=0.</strong>" +
            "<span>The pulse stopped at researcher → verifier. The witness is the missing source access.</span>"
          : "<strong class='pass'>PASS · verified=true with opened_sources_count=1.</strong>" +
            "<span>The pulse reached verifier with the supporting source recorded.</span>";
      });
    }
  }

  /* ------------------------------------------------------------ modal --- */

  const modal = $("[data-setup-modal]");
  if (modal) {
    const dialog = $(".setup-dialog", modal);
    const tabs = $$("[data-setup-option]", modal);
    const panels = $$("[data-setup-panel]", modal);
    const rail = $(".tab-rail", modal);
    let previous = null;

    const focusable = () =>
      $$('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])', modal)
        .filter((el) => el.offsetParent !== null || el === dialog);

    const moveRail = () => {
      const active = tabs.find((t) => t.classList.contains("is-active"));
      if (!active || !rail) return;
      rail.style.width = active.offsetWidth + "px";
      rail.style.transform = `translateX(${active.offsetLeft}px)`;
    };

    const select = (value, focus) => {
      tabs.forEach((tab) => {
        const on = tab.dataset.setupOption === value;
        tab.classList.toggle("is-active", on);
        tab.setAttribute("aria-selected", String(on));
        tab.tabIndex = on ? 0 : -1;
        if (on && focus) tab.focus();
      });
      panels.forEach((panel) => {
        const on = panel.dataset.setupPanel === value;
        panel.hidden = !on;
        panel.classList.toggle("is-active", on);
      });
      moveRail();
    };

    // The dialog expands from whichever control opened it, so the panel reads
    // as that node unfolding rather than as a sheet arriving from nowhere.
    const open = (event) => {
      previous = document.activeElement;
      modal.hidden = false;
      document.body.classList.add("modal-open");

      const trigger = event && event.currentTarget;
      if (trigger && !reduced.matches) {
        const t = trigger.getBoundingClientRect();
        requestAnimationFrame(() => {
          const d = dialog.getBoundingClientRect();
          if (d.width && d.height) {
            const ox = ((t.left + t.width / 2 - d.left) / d.width) * 100;
            const oy = ((t.top + t.height / 2 - d.top) / d.height) * 100;
            dialog.style.transformOrigin =
              `${Math.max(-20, Math.min(120, ox))}% ${Math.max(-20, Math.min(120, oy))}%`;
          }
        });
      } else {
        dialog.style.transformOrigin = "";
      }

      requestAnimationFrame(() => {
        modal.classList.add("is-open");
        moveRail();
        dialog.focus();
      });
    };

    const close = () => {
      modal.classList.remove("is-open");
      const done = () => {
        modal.hidden = true;
        document.body.classList.remove("modal-open");
        if (previous && previous.isConnected) previous.focus();
      };
      reduced.matches ? done() : setTimeout(done, 240);
    };

    $$("[data-open-setup]").forEach((b) => b.addEventListener("click", open));
    $$("[data-close-setup]", modal).forEach((b) => b.addEventListener("click", close));
    tabs.forEach((tab) => tab.addEventListener("click", () => select(tab.dataset.setupOption)));

    modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); return close(); }

      // Roving tabs, as the tablist pattern expects.
      if (event.target.matches("[data-setup-option]") && /^Arrow(Left|Right)$/.test(event.key)) {
        event.preventDefault();
        const i = tabs.indexOf(event.target);
        const next = event.key === "ArrowRight" ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length;
        return select(tabs[next].dataset.setupOption, true);
      }

      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });

    window.addEventListener("resize", moveRail, { passive: true });
  }

  /* -------------------------------------------------------------- copy --- */

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (__) { ok = false; }
      area.remove();
      return ok;
    }
  };

  $$("[data-copy-command]").forEach((button) => {
    button.addEventListener("click", async () => {
      const panel = button.closest(".setup-panel");
      const source = $("[data-setup-command]", panel);
      const feedback = $("[data-copy-feedback]", panel);
      const ok = await copy(source.textContent.trim());
      button.classList.toggle("copied", ok);
      if (feedback) feedback.textContent = ok ? "Copied" : "Press Ctrl+C to copy";
      setTimeout(() => {
        button.classList.remove("copied");
        if (feedback) feedback.textContent = "";
      }, 1800);
    });
  });

  $$("[data-copy-inline]").forEach((button) => {
    const line = button.closest(".install-line");
    const source = $("[data-copy-source]", line);
    button.addEventListener("click", async () => {
      const ok = await copy(source.textContent.trim());
      button.classList.toggle("copied", ok);
      button.setAttribute("aria-label", ok ? "Command copied" : "Copy demo command");
      setTimeout(() => {
        button.classList.remove("copied");
        button.setAttribute("aria-label", "Copy demo command");
      }, 1800);
    });
  });

  /* -------------------------------------------------- scroll traversal ---
     Reaching a section is arriving at a node: the rail from the previous
     section draws down, then the node resolves. Once only, never reversed. */

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-reached");
        io.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -22% 0px", threshold: 0 });
    $$(".section").forEach((section) => io.observe(section));
  } else {
    $$(".section").forEach((section) => section.classList.add("is-reached"));
  }

  /* ------------------------------------------------------------ header --- */

  const header = $(".site-header");
  if (header) {
    const sentinel = document.createElement("div");
    sentinel.setAttribute("aria-hidden", "true");
    sentinel.style.cssText = "position:absolute;top:0;height:1px;width:1px";
    document.body.prepend(sentinel);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        ([entry]) => header.classList.toggle("is-stuck", !entry.isIntersecting),
        { threshold: 0 }
      ).observe(sentinel);
    }
  }

  reduced.addEventListener("change", () => {
    if (reduced.matches) $$("[data-pulse-scene]").forEach(finish);
  });
})();
