#!/usr/bin/env python3
import pty
import os
import sys
import subprocess
import select
import signal
import fcntl
import termios
import struct

def create_pty_session(shell_command, cwd):
    """Create a real PTY session and bridge it to stdin/stdout"""
    
    # Create PTY
    master, slave = pty.openpty()
    
    # Start the shell process with the real PTY
    env = os.environ.copy()
    env['TERM'] = 'xterm-256color'
    env['COLORTERM'] = 'truecolor'
    env['PWD'] = cwd
    
    process = subprocess.Popen(
        shell_command,
        stdin=slave,
        stdout=slave,
        stderr=slave,
        cwd=cwd,
        env=env,
        preexec_fn=os.setsid
    )
    
    # Close slave in parent process
    os.close(slave)
    
    try:
        while process.poll() is None:
            # Use select to handle both input and output
            ready, _, _ = select.select([sys.stdin, master], [], [], 0.1)
            
            for fd in ready:
                if fd == sys.stdin:
                    # Read from stdin and handle special commands
                    try:
                        data = os.read(sys.stdin.fileno(), 1024)
                        if not data:
                            continue
                        if data.startswith(b'###RESIZE###'):
                            try:
                                payload = data[len('###RESIZE###'):].decode().strip()
                                cols, rows = [int(x) for x in payload.split(',')]
                                fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('hhhh', rows, cols, 0, 0))
                                os.kill(process.pid, signal.SIGWINCH)
                            except Exception:
                                pass
                            continue
                        os.write(master, data)
                    except OSError:
                        break
                        
                elif fd == master:
                    # Read from PTY and write to stdout
                    try:
                        data = os.read(master, 1024)
                        if data:
                            sys.stdout.buffer.write(data)
                            sys.stdout.flush()
                    except OSError:
                        break
                        
    except KeyboardInterrupt:
        # Forward Ctrl+C to the process
        os.kill(process.pid, signal.SIGINT)
    
    finally:
        os.close(master)
        process.terminate()
        process.wait()

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: pty_bridge.py <shell> <cwd> [command...]")
        sys.exit(1)
    
    shell = sys.argv[1]
    cwd = sys.argv[2]
    command = " ".join(sys.argv[3:]) if len(sys.argv) > 3 else ""
    
    if command:
        shell_command = [shell, "-l", "-c", command]
    else:
        shell_command = [shell, "-l"]
    
    create_pty_session(shell_command, cwd)