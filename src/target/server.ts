import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = Number(process.env.TARGET_PORT ?? 4173);

const html = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Northstar Member Service</title>
    <style>
      :root { color-scheme: light; font-family: Arial, sans-serif; }
      body { margin: 0; background: #d8dde4; color: #15243a; }
      header { background: #163d6b; color: white; padding: 12px 24px; border-bottom: 5px solid #f2bd2d; }
      header h1 { margin: 0; font-size: 22px; }
      header p { margin: 4px 0 0; font-size: 12px; }
      main { width: min(940px, calc(100% - 32px)); margin: 24px auto; background: white; border: 1px solid #7f8a99; box-shadow: 0 2px 9px #0002; min-height: 520px; }
      .bar { background: #e8edf3; border-bottom: 1px solid #9aa5b2; padding: 8px 14px; font-weight: bold; }
      .content { padding: 22px; }
      table.layout { width: 100%; border-collapse: collapse; }
      table.layout td { padding: 8px; vertical-align: top; }
      label { display: block; font-weight: bold; margin-bottom: 6px; }
      input, select { padding: 8px; border: 1px solid #687589; min-width: 260px; font: inherit; }
      button, .link-button { background: #174e87; color: white; border: 1px solid #0a315b; padding: 8px 14px; font-weight: bold; cursor: pointer; }
      button.secondary { background: #687589; }
      .notice { border: 1px solid #9b6500; background: #fff4cf; padding: 12px; margin: 12px 0; }
      .error { border-color: #9d1c1c; background: #fde7e7; color: #6b1111; }
      .results { width: 100%; border-collapse: collapse; margin-top: 18px; }
      .results th, .results td { border: 1px solid #7f8a99; padding: 9px; text-align: left; }
      .results th { background: #e8edf3; }
      .amount { font-size: 30px; font-weight: bold; color: #154d2b; }
      .muted { color: #536174; font-size: 13px; }
      .hidden { display: none !important; }
      dialog { border: 2px solid #9d1c1c; padding: 0; width: 420px; }
      dialog h2 { margin: 0; padding: 12px; background: #9d1c1c; color: white; }
      dialog div { padding: 18px; }
      footer { padding: 12px 24px; color: #4b596b; font-size: 12px; text-align: center; }
    </style>
  </head>
  <body>
    <header>
      <h1>Northstar Core Services</h1>
      <p>Member Operations Console | Training Tenant</p>
    </header>
    <main>
      <div class="bar">Member Inquiry &gt; Savings Lookup</div>
      <section class="content" id="search-panel">
        <h2>Find a member</h2>
        <p class="muted">Enter a training member number. No production data is available in this environment.</p>
        <form name="member-inquiry">
          <table class="layout">
            <tr>
              <td style="width: 34%"><label for="member-number">Member number</label></td>
              <td><input id="member-number" name="memberNumber" autocomplete="off" inputmode="numeric"></td>
            </tr>
            <tr>
              <td></td>
              <td><button type="submit">Search member records</button></td>
            </tr>
          </table>
        </form>
        <div id="message" role="status" aria-live="polite"></div>
        <div id="results"></div>
      </section>
      <section class="content hidden" id="detail-panel">
        <button class="secondary" type="button" id="back-button">Back to results</button>
        <h2>Member profile</h2>
        <table class="results">
          <tr><th>Member number</th><td id="detail-id"></td></tr>
          <tr><th>Name</th><td id="detail-name"></td></tr>
          <tr><th>Account type</th><td>Share Savings</td></tr>
          <tr><th>Current savings balance</th><td><span class="amount" id="detail-balance"></span></td></tr>
        </table>
        <p id="checkpoint" role="status">Member savings profile loaded successfully.</p>
      </section>
    </main>
    <footer>Training system. All names and balances are synthetic.</footer>
    <dialog id="session-dialog">
      <h2>Session expired</h2>
      <div>
        <p>Your training session expired. Return to sign in before continuing.</p>
        <button type="button" id="dismiss-session">Return to sign in</button>
      </div>
    </dialog>
    <script>
      const members = {
        "10001": { name: "Alex Morgan", balance: "$4,281.17" },
        "10002": { name: "Jordan Lee", balance: "$915.40" }
      };
      const form = document.forms["member-inquiry"];
      const input = form.elements.memberNumber;
      const message = document.querySelector("#message");
      const results = document.querySelector("#results");
      const searchPanel = document.querySelector("#search-panel");
      const detailPanel = document.querySelector("#detail-panel");
      const sessionDialog = document.querySelector("#session-dialog");
      const scenario = new URLSearchParams(location.search).get("scenario");

      function showMessage(text, isError = false) {
        message.className = text ? "notice" + (isError ? " error" : "") : "";
        message.textContent = text;
      }

      function showResults(id, member) {
        results.innerHTML = "<table class='results'><thead><tr><th>Member</th><th>Name</th><th>Action</th></tr></thead><tbody><tr><td>" + id + "</td><td>" + member.name + "</td><td><button type='button' name='openProfile'>Open member profile</button></td></tr></tbody></table>";
        results.querySelector("button").addEventListener("click", () => {
          document.querySelector("#detail-id").textContent = id;
          document.querySelector("#detail-name").textContent = member.name;
          document.querySelector("#detail-balance").textContent = member.balance;
          searchPanel.classList.add("hidden");
          detailPanel.classList.remove("hidden");
        });
      }

      form.addEventListener("submit", event => {
        event.preventDefault();
        const id = input.value.trim();
        results.innerHTML = "";
        showMessage("");
        if (!/^\d{5}$/.test(id)) {
          showMessage("Validation error: member number must contain exactly five digits.", true);
          return;
        }
        if (
          (id === "80000" || scenario === "session-timeout-once") &&
          sessionStorage.getItem("sessionRestored") !== "true"
        ) {
          sessionDialog.showModal();
          return;
        }
        if (id === "90000") {
          showMessage("Permission denied: your role cannot view this member.", true);
          return;
        }
        const member = members[id];
        if (!member) {
          showMessage("No member found for number " + id + ".", false);
          return;
        }
        showMessage("One member record found.");
        showResults(id, member);
      });

      document.querySelector("#back-button").addEventListener("click", () => {
        detailPanel.classList.add("hidden");
        searchPanel.classList.remove("hidden");
      });
      document.querySelector("#dismiss-session").addEventListener("click", () => {
        sessionDialog.close();
        sessionStorage.setItem("sessionRestored", "true");
        showMessage("Training session restored. Retry the lookup.");
      });
    </script>
  </body>
</html>`;

export function startTargetServer(port = DEFAULT_PORT): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      if (url.pathname === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      if (url.pathname !== "/" && url.pathname !== "/app") {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("Not found");
        return;
      }
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'self' 'unsafe-inline'",
      });
      response.end(html);
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

const isEntryPoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntryPoint) {
  const server = await startTargetServer();
  console.log(`Northstar training app: http://127.0.0.1:${DEFAULT_PORT}/app`);
  const close = () => server.close(() => process.exit(0));
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
