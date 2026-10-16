/*
 * GNOME Shell Extension: PiP on top
 * Developer: Rafostar
 */

import Meta from 'gi://Meta';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class PipOnTop extends Extension
{
  enable()
  {
    this._lastWorkspace = null;
    this._windowAddedId = 0;
    this._windowRemovedId = 0;

    this.settings = this.getSettings();
    this._settingsChangedId = this.settings.connect(
      'changed', this._onSettingsChanged.bind(this));

    this._switchWorkspaceId = global.window_manager.connect_after(
      'switch-workspace', this._onSwitchWorkspace.bind(this));
    this._onSwitchWorkspace();
  }

  disable()
  {
    this.settings.disconnect(this._settingsChangedId);
    this.settings = null;

    global.window_manager.disconnect(this._switchWorkspaceId);

    if (this._lastWorkspace) {
      this._lastWorkspace.disconnect(this._windowAddedId);
      this._lastWorkspace.disconnect(this._windowRemovedId);
    }

    this._lastWorkspace = null;
    this._settingsChangedId = 0;
    this._switchWorkspaceId = 0;
    this._windowAddedId = 0;
    this._windowRemovedId = 0;

    let actors = global.get_window_actors();
    if (actors) {
      for (let actor of actors) {
        let window = actor.meta_window;
        if (!window) continue;

        if (window._isPipAble) {
          if (window.above)
            window.unmake_above();
          if (window.on_all_workspaces)
            window.unstick();
        }

        this._onWindowRemoved(null, window);
      }
    }
  }

  _onSettingsChanged(settings, key)
  {
    switch (key) {
      case 'stick':
        /* Updates already present windows */
        this._onSwitchWorkspace();
        break;
      default:
        break;
    }
  }

  _onSwitchWorkspace()
  {
    let workspace = global.workspace_manager.get_active_workspace();
    let wsWindows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);

    if (this._lastWorkspace) {
      this._lastWorkspace.disconnect(this._windowAddedId);
      this._lastWorkspace.disconnect(this._windowRemovedId);
    }

    this._lastWorkspace = workspace;
    this._windowAddedId = this._lastWorkspace.connect(
      'window-added', this._onWindowAdded.bind(this));
    this._windowRemovedId = this._lastWorkspace.connect(
      'window-removed', this._onWindowRemoved.bind(this));

    /* Update state on already present windows */
    if (wsWindows) {
      for (let window of wsWindows)
        this._onWindowAdded(workspace, window);
    }
  }

  _onWindowAdded(workspace, window)
  {
    if (!window._notifyPipTitleId) {
      window._notifyPipTitleId = window.connect_after(
        'notify::title', this._queueCheckTitle.bind(this));
    }
    this._queueCheckTitle(window);
  }

  /* Never restack from inside window-added or a title change: an X11 window is
   * added to its workspace before Mutter has placed it in the stack, and
   * make_above() then trips "Window had stack position already" and aborts
   * the shell. Check once Mutter is done, before the next redraw. */
  _queueCheckTitle(window)
  {
    if (window._pipCheckQueued)
      return;
    window._pipCheckQueued = true;

    global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
      window._pipCheckQueued = false;
      /* Disabled, or the window unmanaged, in the meantime */
      if (this.settings && window.get_compositor_private())
        this._checkTitle(window);
      return false;
    });
  }

  _onWindowRemoved(workspace, window)
  {
    if (window._notifyPipTitleId) {
      window.disconnect(window._notifyPipTitleId);
      window._notifyPipTitleId = null;
    }
    if (window._isPipAble)
      window._isPipAble = null;
  }

  /* Chromium's Document PiP (Spotify's mini player and the like), titled
   * after the current track. Every other window Chrome draws itself is titled
   * "<page> - Google Chrome" (or "- Chromium"), but a title alone also caught
   * windows titled just "Google Chrome" (the profile picker) and Chrome's own
   * GTK dialogs (Print), which are pinned on top for good under X11. So: a
   * dialog or a window attached to a parent is never PiP, and under X11, where
   * Chrome names its windows' roles, Document PiP is a "pop-up" (normal windows
   * are "browser"). Wayland has no roles; the title test alone decides there.
   * Video PiP is titled "Picture in picture" and caught by name above. Web
   * apps run under their own wm_class, so they are not caught here. */
  _isChromiumPip(window)
  {
    const wmClass = (window.wm_class || '').toLowerCase();
    if (!['google-chrome', 'chromium', 'chromium-browser'].includes(wmClass))
      return false;

    if (window.get_window_type() !== Meta.WindowType.NORMAL || window.get_transient_for())
      return false;

    const title = window.title;
    if (/(^| - )(Google Chrome|Chromium)$/.test(title) || title.startsWith('DevTools'))
      return false;

    const role = window.get_role();
    return !role || role === 'pop-up';
  }

  _checkTitle(window)
  {
    if (!window.title)
      return;

    /* Check both translated and untranslated string for
     * users that prefer running applications in English */
    let isPipWin = (window.title == 'Picture-in-Picture'
      || window.title == _('Picture-in-Picture')
      || window.title == 'Picture in picture'
      || window.title == 'Picture-in-picture'
      || window.title.endsWith(' - PiP')
      /* Telegram support */
      || window.title == 'TelegramDesktop'
      /* Yandex.Browser support YouTube */
      || window.title.endsWith(' - YouTube')
      || this._isChromiumPip(window));

    if (isPipWin || window._isPipAble) {
      let un = (isPipWin) ? '' : 'un';

      window._isPipAble = true;
      window[`${un}make_above`]();

      /* Change stick if enabled or unstick PipAble windows */
      un = (isPipWin && this.settings.get_boolean('stick')) ? '' : 'un';
      window[`${un}stick`]();
    }
  }
}
