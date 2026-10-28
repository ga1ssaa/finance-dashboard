"""Heroku Common Runtime contract: router-only ingress, overwritten proto, rightmost client IP.

Never enable Uvicorn --proxy-headers on this path. Forwarded-Host and the left
side of X-Forwarded-For are untrusted. This contract is not portable to another proxy.
"""
from ipaddress import ip_address
from urllib.parse import urlsplit
from starlette.responses import JSONResponse


class HerokuProxyMiddleware:
    def __init__(self, app, api_origin):
        self.app = app
        self.host = urlsplit(api_origin).hostname

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        def header(name):
            values = [value.decode("latin1") for key, value in scope["headers"] if key.lower() == name]
            return values[0] if len(values) == 1 else ""
        forwarded = header(b"x-forwarded-for")
        try:
            if (header(b"host") != self.host or header(b"x-forwarded-proto") != "https"
                or not forwarded or len(forwarded) > 4096 or len(forwarded.split(",")) > 32):
                raise ValueError()
            client = str(ip_address(forwarded.rsplit(",", 1)[-1].strip()))
        except ValueError:
            return await JSONResponse({"detail": "Secure Heroku proxy request required"}, status_code=400,
                                      headers={"Cache-Control": "no-store"})(scope, receive, send)
        scope = {**scope, "scheme": "https", "client": (client, 0)}
        async def secure_send(message):
            if message["type"] == "http.response.start":
                message["headers"] = [(key, value) for key, value in message.get("headers", [])
                                      if key.lower() not in {b"cache-control", b"strict-transport-security", b"x-content-type-options"}]
                message["headers"].extend([
                    (b"strict-transport-security", b"max-age=31536000"),
                    (b"x-content-type-options", b"nosniff"),
                    (b"cache-control", b"no-store"),
                ])
            await send(message)
        await self.app(scope, receive, secure_send)
