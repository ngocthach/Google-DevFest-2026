"""Avoid broken IPv6 routes to the Gemini Live endpoint on this machine.

Set GEMINI_FORCE_IPV4=0 to use the operating system's normal resolver.
Only the Gemini hostname and AF_UNSPEC lookups are changed.
"""
import os
import socket

def configure_gemini_network():
    if os.getenv('GEMINI_FORCE_IPV4', '1') == '0':
        return
    original = socket.getaddrinfo
    if getattr(original, '_gemini_ipv4', False):
        return
    def resolve(host, port, family=0, type=0, proto=0, flags=0):
        if isinstance(host, str) and host.rstrip('.').lower() == 'generativelanguage.googleapis.com' and family in (0, socket.AF_UNSPEC):
            family = socket.AF_INET
        return original(host, port, family, type, proto, flags)
    resolve._gemini_ipv4 = True
    socket.getaddrinfo = resolve
