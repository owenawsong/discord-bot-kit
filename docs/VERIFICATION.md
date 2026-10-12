# Release preparation evidence

Verified locally on Windows with Node 24.13.0. CI is configured for Node 22/24 on Windows/Linux; remote CI results must be checked after pushing.

| Check | Outcome |
| --- | --- |
| TypeScript build | Passed |
| Library tests | 40 passed, 0 failed |
| Bundled ticket scenarios | 11 passed, 0 failed |
| Bundled signup scenarios | 14 passed, 0 failed |
| npm dependency audit | 0 reported vulnerabilities at preparation time |
| Packed install into new ticket/signup scaffolds | Both matching scenarios and bundled recipe checks passed |
| Browser slash → modal → ticket | Passed with actual handler output |
| Browser unauthorized close | GW_PERMISSION_DENIED; ticket remained open |
| Browser moderator close | Ticket changed to closed |
| Browser scenario tab | 11/11 passed |
| Browser select interaction | Validated preference response observed |
| Browser expired arrival | GW_ACK_TIMEOUT observed |
| Browser slash argument form | Typed title/capacity create the actual signup event |
| Browser signup capacity | First join succeeds; another member receives GW_EVENT_FULL without adding a participant |
| Narrow layout | Document/body width 390px at a 390px viewport; no horizontal overflow in lab and launch checklist |
| MCP | stdio initialization, tool listing, local simulation and recipe checks passed in a child process |
| Recovery permissions | Explicit member overwrite type tested; one damaged record does not abort others |
| Live Discord integration | Not performed; requires an authenticated test guild |

`assets/scenarios.png` is an actual BrowserOS capture of the local scenario runner. Browser screenshots were intermittent; no mock screenshot was substituted. The workshop server uses loopback and contains only simulated fixtures.

This evidence validates the listed local behavior. It does not establish Discord API fidelity, production readiness, cross-machine browser compatibility or performance at scale. See the live test procedure and explicit limits in the README.
