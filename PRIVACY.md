# Privacy Policy — ibge-br-mcp

**Effective date:** 2026-08-08 · **Service:** `https://ibge.sidneybissoli.com` (remote MCP server)

This service provides read-only access to Brazilian public statistics and
geographic data from IBGE (Instituto Brasileiro de Geografia e Estatística).
It requires no account, no login, and no API key.

## What we collect

- **Nothing that identifies you.** The server does not log query content, tool
  parameters, request bodies, or any user data.
- **Aggregate usage metrics only:** event type (request, tool call, tool error,
  auth failure, rate-limited), tool or route name, and daily counts. These
  aggregates contain no IP addresses and no query content, and are publicly
  visible at `/metrics`.
- **MCP session id and client name:** on each `initialize` the server issues
  a random session id (UUID v4) and the client echoes it on later requests. It
  is kept only in the aggregate usage telemetry, to link the messages of one
  handshake; it is not stored server-side and identifies neither a person nor
  a device. The name of the client software declared in the handshake
  (`clientInfo.name`, normalised) is recorded on the handshake line only.
- **Rate limiting** uses the client IP in ephemeral in-process memory only
  (token bucket). It is never persisted or logged by the application.

## Infrastructure

The service runs on Cloudflare Workers. Cloudflare, as hosting provider, may
process connection metadata (including IP addresses) per its own
[privacy policy](https://www.cloudflare.com/privacypolicy/).

## Upstream requests

Your queries are translated into requests to the public IBGE APIs
(`servicodados.ibge.gov.br` and `geoservicos.ibge.gov.br`). No user-identifying
information is forwarded upstream.

## Data license

Statistical and geographic data returned by this service comes from IBGE and
is Brazilian public open data under Lei 12.527/2011 (Lei de Acesso à
Informação) and Decreto 8.777/2016 (Política de Dados Abertos do Poder
Executivo Federal). Every response carries a provenance block (source URL,
data vintage, retrieval date, license). This service is not endorsed by IBGE.

## Contact

sbissoli76@gmail.com
