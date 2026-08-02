# Security policy

Analyst executes model-generated SQL against a data warehouse and, when
explicitly enabled, arbitrary Python. It is a program whose whole job is running
untrusted-ish code against trusted data, so we would rather hear about problems
early and awkwardly than late and politely.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private vulnerability reporting on
this repository (Security → Report a vulnerability), which is the fastest route
to the maintainers.

Please include what you would want if you were on the receiving end: what you
did, what happened, what you expected, and — if you have one — the smallest
query, cell or request that reproduces it.

**What to expect:** acknowledgement within 3 working days, an assessment with a
severity and a rough timeline within 10, and credit in the release notes unless
you would rather not be named. If a report turns out to be a design limitation
we already document (see below), we will say so plainly rather than quietly
close it.

## Known and documented limitations

These are not vulnerabilities — they are the current design, stated so nobody
has to discover them the hard way. Reports that restate them will be closed with
a pointer here; reports that *escape* them are very much in scope.

**There is no authentication or authorization by default.** Every endpoint is
open. Caller identity comes from a request header trusted as sent. Analyst
targets single-user local use and binds to loopback by default. A shared-token
mode exists (`-auth-token`) for deployments behind a proxy; it grants full
access and is not a permission system.

**Notebook Python cells execute arbitrary code.** Disabled by default. When
enabled, the runner applies a wall-clock timeout, kills the process group,
strips the environment, and applies memory/CPU/process limits where the OS
supports it. That is *resource* isolation, not a security boundary: it does not
restrict network access, nor filesystem reads outside the working directory.
On macOS, `RLIMIT_AS` is not implemented, so there is no memory cap there —
the runner reports which limits the kernel actually accepted rather than
assuming its configuration took effect.

**Model-generated SQL runs against your warehouse.** It is constrained to
read-only and screened by a guard that allowlists what a query may reference.
Use least-privilege credentials anyway. If you find SQL that reaches data or
resources the guard should have refused — especially anything touching the
filesystem, the network, or engine settings — that **is** a vulnerability;
please report it.

**Prompt injection through warehouse data is a live threat model.** Questions
are natural language and the data being queried is not necessarily trustworthy.
Column values containing instructions influencing generated SQL is a real
concern we are actively interested in.

## Scope

**In scope:** the Analyst backend, frontend, and the connector/provider
extension surfaces in this repository.

**Out of scope:** vulnerabilities in third-party model providers or their
client tools; DuckDB itself (report upstream, and tell us so we can pin or
mitigate); anything requiring an attacker to already have local shell access as
the user running the server.

## Deployment guidance

If you run Analyst beyond your own machine — which the current design does not
recommend — at minimum: keep it behind an authenticating reverse proxy, leave
Python cells off, give the warehouse connection read-only least-privilege
credentials, and treat the SQLite store as sensitive (it holds every question,
answer and source DSN).
