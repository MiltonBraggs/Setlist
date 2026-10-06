"""Non-blocking UDP transport. Live's API is not thread-safe, so sockets are polled
from the control surface tick instead of a background thread."""

import errno
import json
import socket

SCRIPT_PORT = 39100  # we listen here
SERVER_PORT = 39101  # the Setlist app listens here
# Keep datagrams well below the 64 KB UDP limit; strings are sliced by characters,
# so a slice of 15000 chars is at most 60000 bytes of UTF-8.
CHUNK_CHARS = 15000


class UdpLink(object):
    def __init__(self, log):
        self._log = log
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.setblocking(False)
        self._sock.bind(("127.0.0.1", SCRIPT_PORT))
        self._server = ("127.0.0.1", SERVER_PORT)
        self._chunk_id = 0

    def close(self):
        try:
            self._sock.close()
        except Exception:
            pass

    def send(self, message):
        data = json.dumps(message, separators=(",", ":"))
        if len(data) <= CHUNK_CHARS:
            self._send_raw(data)
            return
        self._chunk_id = (self._chunk_id + 1) % 1000000
        parts = [data[i:i + CHUNK_CHARS] for i in range(0, len(data), CHUNK_CHARS)]
        for index, part in enumerate(parts):
            self._send_raw(json.dumps({
                "type": "chunk",
                "id": self._chunk_id,
                "i": index,
                "n": len(parts),
                "data": part,
            }, separators=(",", ":")))

    def _send_raw(self, text):
        try:
            self._sock.sendto(text.encode("utf-8"), self._server)
        except socket.error as e:
            # Nobody listening yet (ECONNREFUSED / WSAECONNRESET on Windows) is fine.
            if e.errno not in (errno.ECONNREFUSED, errno.EWOULDBLOCK, 10054):
                self._log("send failed: %s" % e)

    def receive(self):
        """Return all pending messages (decoded JSON objects)."""
        messages = []
        while True:
            try:
                data, _addr = self._sock.recvfrom(65536)
            except socket.error as e:
                # 10035 = WSAEWOULDBLOCK, 10054 = WSAECONNRESET (ICMP port unreachable)
                if e.errno in (errno.EAGAIN, errno.EWOULDBLOCK, 10035, 10054):
                    break
                self._log("receive failed: %s" % e)
                break
            try:
                messages.append(json.loads(data.decode("utf-8")))
            except ValueError:
                self._log("bad message: %r" % data[:200])
        return messages
