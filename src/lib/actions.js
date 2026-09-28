export class ActionController {
  constructor(root, actions) {
    this.root = root;
    this.actions = actions;
    this.handleClick = (event) => {
      const control = event.target.closest("[data-action]");
      if (!control || !this.root.contains(control)) return;
      const action = this.actions[control.dataset.action];
      if (action) action(control, event);
    };
    this.handleChange = (event) => {
      const control = event.target.closest("[data-change-action]");
      if (!control || !this.root.contains(control)) return;
      const action = this.actions[control.dataset.changeAction];
      if (action) action(control, event);
    };
    root.addEventListener("click", this.handleClick);
    root.addEventListener("change", this.handleChange);
  }

  destroy() {
    this.root.removeEventListener("click", this.handleClick);
    this.root.removeEventListener("change", this.handleChange);
  }
}

