"""Read-only Windows/X11 test observer. Records counts, never titles or content."""
import ctypes
import json
import os
from pathlib import Path
import sys
import time

pids_file, stop_file = map(Path, sys.argv[1:3])

if sys.platform == "win32":
    from ctypes import wintypes as W
    user = ctypes.WinDLL("user32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    callback_type = ctypes.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)
    user.EnumWindows.argtypes = [callback_type, W.LPARAM]
    user.EnumWindows.restype = W.BOOL
    user.GetWindowThreadProcessId.argtypes = [W.HWND, ctypes.POINTER(W.DWORD)]
    user.GetWindowThreadProcessId.restype = W.DWORD
    user.IsWindowVisible.argtypes = [W.HWND]
    user.IsWindowVisible.restype = W.BOOL
    user.GetForegroundWindow.restype = W.HWND
    kernel.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
    kernel.OpenProcess.restype = W.HANDLE
    kernel.GetExitCodeProcess.argtypes = [W.HANDLE, ctypes.POINTER(W.DWORD)]
    kernel.GetExitCodeProcess.restype = W.BOOL
    kernel.CloseHandle.argtypes = [W.HANDLE]

    def owner(window):
        value = W.DWORD()
        user.GetWindowThreadProcessId(window, ctypes.byref(value))
        return value.value

    def alive(pid):
        handle = kernel.OpenProcess(0x1000, False, pid)  # query limited information
        if not handle:
            return False
        try:
            code = W.DWORD()
            if not kernel.GetExitCodeProcess(handle, ctypes.byref(code)):
                raise ctypes.WinError(ctypes.get_last_error())
            return code.value == 259  # STILL_ACTIVE; never send a signal
        finally:
            kernel.CloseHandle(handle)

    def snapshot(pids):
        windows = []

        @callback_type
        def collect(window, _):
            if owner(window) in pids:
                windows.append(bool(user.IsWindowVisible(window)))
            return True

        if not user.EnumWindows(collect, 0):
            raise ctypes.WinError(ctypes.get_last_error())
        return len(windows), sum(windows), owner(user.GetForegroundWindow()) in pids

elif sys.platform.startswith("linux"):
    from Xlib import X, display, error
    connection = display.Display()
    root = connection.screen().root
    pid_atom = connection.intern_atom("_NET_WM_PID")
    active_atom = connection.intern_atom("_NET_ACTIVE_WINDOW")

    def alive(pid):
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False

    def owner(window):
        prop = window.get_full_property(pid_atom, X.AnyPropertyType)
        return int(prop.value[0]) if prop is not None and len(prop.value) else 0

    def snapshot(pids):
        windows = []
        # Include unmanaged windows and clients reparented inside WM frames.
        pending = [(window, 0) for window in root.query_tree().children]
        while pending:
            window, depth = pending.pop()
            try:
                if owner(window) in pids:
                    windows.append(window.get_attributes().map_state == X.IsViewable)
                if depth < 2:
                    pending.extend((child, depth + 1) for child in window.query_tree().children)
            except error.BadWindow:
                pass  # It closed between enumeration and reading its attributes.
        active = root.get_full_property(active_atom, X.AnyPropertyType)
        foreground = False
        if active is not None and len(active.value) and active.value[0]:
            try:
                foreground = owner(connection.create_resource_object("window", int(active.value[0]))) in pids
            except error.BadWindow:
                pass
        return len(windows), sum(windows), foreground
else:
    raise RuntimeError("Use the Swift observer on macOS.")

stats = dict(platform=sys.platform, intervalMs=20, samples=0, ownedProcessSamples=0,
             observedProcessCount=0, foregroundSamples=0, maxOwnedWindows=0,
             maxOnscreenWindows=0, enumerationFailures=0, maxSampleGapMs=0)
observed = set()
previous = time.monotonic()
print("ready", flush=True)
while not stop_file.exists():
    now = time.monotonic()
    stats["maxSampleGapMs"] = max(stats["maxSampleGapMs"], (now - previous) * 1000)
    previous = now
    pids = {int(value) for value in pids_file.read_text(encoding="utf8").splitlines() if value.isdigit()}
    try:
        live = {pid for pid in pids if alive(pid)}
        observed.update(live)
        stats["ownedProcessSamples"] += bool(live)
        total, visible, foreground = snapshot(live)
        stats["maxOwnedWindows"] = max(stats["maxOwnedWindows"], total)
        stats["maxOnscreenWindows"] = max(stats["maxOnscreenWindows"], visible)
        stats["foregroundSamples"] += foreground
    except Exception as exc:
        stats["enumerationFailures"] += 1
        print(type(exc).__name__, file=sys.stderr, flush=True)
    stats["samples"] += 1
    time.sleep(0.02)
stats["observedProcessCount"] = len(observed)
print(json.dumps(stats), flush=True)
