"""Give Carbonyl a real terminal without creating a desktop window.

Own one child; suppress terminal paint sequences and relay only its stderr and
CDP announcement. This helper is for macOS/Linux; native Windows needs ConPTY.
"""
import fcntl
import os
import pty
import re
import selectors
import signal
import struct
import subprocess
import sys
import termios

master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 160, 0, 0))
env = dict(os.environ, TERM='xterm-256color')
child = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=subprocess.PIPE, env=env)
os.close(slave)
print(f'POC_BROWSER_PID={child.pid}', file=sys.stderr, flush=True)

def stop(signum, frame):
    if child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=2)
    raise SystemExit(128 + signum)

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
selector = selectors.DefaultSelector()
selector.register(master, selectors.EVENT_READ, 'terminal')
selector.register(child.stderr, selectors.EVENT_READ, 'stderr')
paint = b''
announced = False
try:
    while child.poll() is None:
        for key, _ in selector.select(timeout=0.2):
            try:
                chunk = os.read(key.fd, 8192)
            except OSError:
                chunk = b''
            if not chunk:
                selector.unregister(key.fileobj)
                continue
            if key.data == 'stderr':
                sys.stderr.buffer.write(chunk)
                sys.stderr.buffer.flush()
            else:
                paint = (paint + chunk)[-8192:]
                endpoint = re.search(rb'DevTools listening on (ws://127\.0\.0\.1:\d+/devtools/browser/[A-Za-z0-9-]+)', paint)
                if endpoint and not announced:
                    announced = True
                    print(endpoint.group(0).decode(), file=sys.stderr, flush=True)
    sys.exit(child.returncode)
finally:
    selector.close()
    os.close(master)
    child.stderr.close()
    if child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=2)
